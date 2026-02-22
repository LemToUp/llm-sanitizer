import { Provider } from './provider.js';
import { Agent, Runner, OpenAIChatCompletionsModel } from '@openai/agents';
import OpenAI from 'openai';
import { splitText } from '../shared/split-text.js';
import { raceReadWithSignal } from '../shared/abort-utils.js';
import { CHARS_PER_TOKEN } from '../shared/constants.js';

/** Reserve for response + overhead (tokens). */
const RESPONSE_BUFFER_TOKENS = 1024;
/** Minimum tokens left for content so chunks are never empty. */
const MIN_CONTENT_TOKENS = 256;
/** Timeout for a single request (prompt processing + streaming). LM Studio can take 1–2 min on first token. */
const REQUEST_TIMEOUT_MS = 300000;
/** Max wait per chunk; if no completion by then, show timeout (avoids infinite "Part 1 of N..."). */
const CHUNK_TIMEOUT_MS = 120000;
/** Max retry depth for context overflow errors. */
const MAX_RETRY_DEPTH = 2;

export class OpenAIAgentsProvider extends Provider {
    static id = 'openai-agents';
    static label = 'OpenAI-compatible (Agents SDK)';

    static async checkAvailability() {
        // Always available if the package is bundled.
        // Actual connectivity is validated at call time.
        return { available: true };
    }

    /**
     * @param {{
     *   baseUrl?: string,
     *   apiKey?: string,
     *   model?: string,
     *   contextLength?: number,
     *   tools?: import('@openai/agents').Tool[],
     * }} settings
     */
    constructor(settings = {}) {
        super(settings);
    }

    /**
     * Attempt to detect context length from the API.
     * @param {OpenAI} client - OpenAI client instance
     * @param {string} model - Model name
     * @returns {Promise<number|null>} Context length in tokens, or null if unavailable
     */
    async _detectContextLength(client, model) {
        if (!model) return null;
        try {
            const info = await client.models.retrieve(model);
            // Different APIs use different field names
            return info.context_window || info.context_length || null;
        } catch {
            // Silently fall back if API doesn't support model info
            return null;
        }
    }

    /**
     * Stream a single chunk through the agent.
     * @param {string} chunk - Text chunk to process
     * @param {Runner} runner - Agent runner instance
     * @param {Agent} agent - Agent instance
     * @param {function} onUpdate - Callback for streaming updates
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<string>} Generated text for this chunk
     */
    async _streamChunk(chunk, runner, agent, onUpdate, signal) {
        let chunkText = '';
        await withTimeout(
            CHUNK_TIMEOUT_MS,
            (async () => {
                const result = await runner.run(agent, chunk, { stream: true });
                const reader = result.toTextStream().getReader();
                try {
                    while (true) {
                        const readResult = await raceReadWithSignal(reader, signal);
                        if (readResult.done) break;
                        chunkText += readResult.value;
                        if (onUpdate) onUpdate(readResult.value);
                    }
                } catch (e) {
                    reader.cancel().catch(() => {});
                    throw e;
                }
                await result.completed;
            })(),
            'Request timed out. Server may be overloaded or the model is too slow.',
        );
        return chunkText;
    }

    /**
     * Process a chunk with automatic retry on context overflow.
     * @param {string} chunk - Text chunk to process
     * @param {number} maxChunkChars - Maximum chunk size in characters
     * @param {Runner} runner - Agent runner instance
     * @param {Agent} agent - Agent instance
     * @param {function} onUpdate - Callback for streaming updates
     * @param {AbortSignal} signal - Abort signal
     * @param {number} retryDepth - Current retry depth
     * @returns {Promise<string>} Generated text
     */
    async _processChunkWithRetry(chunk, maxChunkChars, runner, agent, onUpdate, signal, retryDepth = 0) {
        try {
            return await this._streamChunk(chunk, runner, agent, onUpdate, signal);
        } catch (err) {
            // If it's a context error and we haven't exceeded retry depth, split and retry
            if (isContextError(err) && retryDepth < MAX_RETRY_DEPTH) {
                console.log(`Context overflow detected, re-splitting chunk (depth ${retryDepth + 1})...`);
                
                // Split the chunk in half
                const subChunks = splitText(chunk, Math.floor(maxChunkChars / 2));
                
                let fullText = '';
                for (const subChunk of subChunks) {
                    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
                    const subText = await this._processChunkWithRetry(
                        subChunk,
                        maxChunkChars,
                        runner,
                        agent,
                        onUpdate,
                        signal,
                        retryDepth + 1
                    );
                    fullText += subText;
                }
                return fullText;
            }
            // Otherwise, rethrow the error
            throw err;
        }
    }

    async call({ text, prompt, onStatus, onUpdate, signal }) {
        if (onStatus) onStatus('Connecting to LLM...', null);

        const fetchOpts = signal
            ? (input, init) => fetch(input, { ...init, signal: init?.signal ?? signal })
            : undefined;

        const client = new OpenAI({
            baseURL: this.settings.baseUrl || 'http://localhost:11434/v1',
            apiKey: this.settings.apiKey || 'sk-no-key-required',
            dangerouslyAllowBrowser: true,
            timeout: REQUEST_TIMEOUT_MS,
            ...(fetchOpts && { fetch: fetchOpts }),
        });

        const model = this.settings.model;

        const runner = new Runner({
            modelProvider: {
                getModel: (name) => new OpenAIChatCompletionsModel(client, name || model),
            },
        });

        const tools = this.settings.tools || [];

        const agent = new Agent({
            name: 'Sanitizer',
            instructions: prompt,
            ...(model && { model }),
            ...(tools.length && { tools }),
        });

        // Priority chain: user setting > API auto-detection > default (4096)
        let ctx;
        if (this.settings.contextLength) {
            ctx = this.settings.contextLength;
        } else {
            const detected = await this._detectContextLength(client, model);
            ctx = detected || 4096;
            if (detected) {
                console.log(`Auto-detected context length: ${detected} tokens`);
            }
        }
        ctx = Math.max(512, ctx);

        const promptTokensEst = Math.ceil((prompt?.length ?? 0) / CHARS_PER_TOKEN);
        const reserveTokens = Math.min(
            ctx - MIN_CONTENT_TOKENS,
            promptTokensEst + RESPONSE_BUFFER_TOKENS,
        );
        const maxChunkTokens = Math.max(MIN_CONTENT_TOKENS, ctx - reserveTokens);
        const maxChunkChars = maxChunkTokens * CHARS_PER_TOKEN;
        const chunks = splitText(text, maxChunkChars);

        if (onStatus) {
            onStatus(chunks.length > 1 ? `Processing ${chunks.length} parts...` : 'Processing article...', null);
        }

        let fullText = '';

        try {
            for (let i = 0; i < chunks.length; i++) {
                if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
                if (chunks.length > 1 && onStatus) {
                    onStatus(`Part ${i + 1} of ${chunks.length}...`, i / chunks.length);
                }

                const chunkText = await this._processChunkWithRetry(
                    chunks[i],
                    maxChunkChars,
                    runner,
                    agent,
                    onUpdate,
                    signal
                );
                fullText += chunkText;
            }
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            const msg = formatErrorMessage(err);
            if (onStatus) onStatus(`Error: ${msg}`, null);
            throw new Error(msg);
        }

        return { content: fullText };
    }
}

/**
 * Reject if the promise does not settle within ms.
 * @param {number} ms
 * @param {Promise<void>} promise
 * @param {string} timeoutMessage
 * @returns {Promise<void>}
 */
function withTimeout(ms, promise, timeoutMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(timeoutMessage)), ms),
        ),
    ]);
}

/**
 * Check if an error is a context length overflow error.
 * @param {unknown} err - Error to check
 * @returns {boolean}
 */
function isContextError(err) {
    const m = err?.message ?? String(err);
    return /context size|context length|context window|n_ctx|exceeded|too many tokens|input too long|maximum context/i.test(m);
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function formatErrorMessage(err) {
    if (err?.name === 'AbortError') {
        return 'Cancelled (tab closed or reloaded).';
    }
    const m = err?.message ?? String(err);
    if (/timeout|timed out|ETIMEDOUT|abort/i.test(m)) {
        return 'Request timed out. Try increasing timeout or reducing context length.';
    }
    if (isContextError(err)) {
        return 'Context size exceeded. Reduce "Context length" in settings or shorten the prompt.';
    }
    if (/fetch|network|failed to fetch|Connection|ECONNREFUSED|ECONNRESET/i.test(m)) {
        return 'Network error. Check API URL and that the server is running.';
    }
    return m;
}
