import { Provider } from './provider.js';
import { splitText } from '../shared/split-text.js';
import { raceWithSignal, throwIfAborted } from '../shared/abort-utils.js';
import { CHARS_PER_TOKEN } from '../shared/constants.js';
import { VERBOSITY } from '../shared/defaults.js';

/** Fallback token quota when the API doesn't expose inputQuota. */
const DEFAULT_TOKEN_QUOTA = 4000;

/** Map verbosity levels to Chrome Summarizer length parameter. */
const VERBOSITY_TO_LENGTH = {
    [VERBOSITY.SHORT]: 'short',
    [VERBOSITY.MEDIUM]: 'medium',
    [VERBOSITY.DETAILED]: 'long',
};

export class ChromeSummarizerProvider extends Provider {
    static id = 'chrome-summarizer';
    static label = 'Chrome Summarizer (Gemini Nano)';

    static async checkAvailability() {
        if (!('Summarizer' in self)) {
            return {
                available: false,
                reason: 'Summarizer API is not available. '
                    + 'Requires Chrome 138+ with the required flags or an active origin trial token.',
            };
        }

        const availability = await Summarizer.availability();
        if (availability === 'unavailable') {
            return {
                available: false,
                reason: 'Summarizer model is unavailable on this device. '
                    + 'Check hardware requirements at chrome://flags.',
            };
        }

        return { available: true };
    }

    /** @param {{ contextLength?: number }} settings */
    constructor(settings = {}) {
        super(settings);
        this._summarizer = null;
    }

    async call({ text, prompt, onStatus, onUpdate, signal }) {
        const { available, reason } = await ChromeSummarizerProvider.checkAvailability();
        if (!available) throw new Error(reason);

        const availability = await Summarizer.availability();
        throwIfAborted(signal);

        if (availability === 'downloadable' && onStatus) {
            onStatus('Downloading AI model...', null);
        }

        const summaryLength = VERBOSITY_TO_LENGTH[this.settings.verbosity] || 'long';

        this._summarizer = await raceWithSignal(Summarizer.create({
            sharedContext: prompt
                || 'A news article from the web that may contain manipulative or biased language.',
            type: 'tl;dr',
            format: 'markdown',
            length: summaryLength,
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    console.log(`Model download: ${(e.loaded * 100).toFixed(0)}%`);
                    if (onStatus) onStatus('Downloading AI model...', e.loaded);
                });
            },
        }), signal);
        throwIfAborted(signal);

        if (onStatus) onStatus('Analyzing article...', null);

        // Determine max chunk size in characters based on available token quota
        const tokenQuota = this.settings.contextLength
            || this._summarizer.inputQuota
            || DEFAULT_TOKEN_QUOTA;
        const maxChars = tokenQuota * CHARS_PER_TOKEN;

        const chunks = splitText(text, maxChars);
        console.log(
            `Split text (${text.length} chars) into ${chunks.length} chunk(s) `
            + `(quota: ${tokenQuota} tokens, maxChars: ${maxChars})`,
        );

        if (chunks.length === 1) {
            return this._streamSummary(chunks[0], onStatus, onUpdate, signal);
        }

        const summaries = [];
        for (let i = 0; i < chunks.length; i++) {
            throwIfAborted(signal);
            if (onStatus) {
                onStatus(
                    `Summarizing part ${i + 1} of ${chunks.length}...`,
                    i / chunks.length,
                );
            }
            const summary = await raceWithSignal(this._summarizer.summarize(chunks[i]), signal);
            summaries.push(summary);
        }

        throwIfAborted(signal);
        const combined = await this._recursiveSummarize(summaries, maxChars, onStatus, signal);
        throwIfAborted(signal);
        return this._streamSummary(combined, onStatus, onUpdate, signal);
    }

    /**
     * Recursively summarize an array of summaries until they fit
     * in a single context window.
     */
    async _recursiveSummarize(summaries, maxChars, onStatus, signal) {
        throwIfAborted(signal);
        const combined = summaries.join('\n');

        if (combined.length <= maxChars) {
            return combined;
        }

        if (onStatus) onStatus('Reducing summaries further...', null);

        const chunks = splitText(combined, maxChars);
        const reduced = [];

        for (let i = 0; i < chunks.length; i++) {
            throwIfAborted(signal);
            if (onStatus) {
                onStatus(
                    `Re-summarizing part ${i + 1} of ${chunks.length}...`,
                    i / chunks.length,
                );
            }
            const summary = await raceWithSignal(this._summarizer.summarize(chunks[i]), signal);
            reduced.push(summary);
        }

        return this._recursiveSummarize(reduced, maxChars, onStatus, signal);
    }

    async _streamSummary(text, onStatus, onUpdate, signal) {
        if (onStatus) onStatus('Generating final summary...', null);

        let fullText = '';
        const stream = this._summarizer.summarizeStreaming(text);

        for await (const chunk of stream) {
            throwIfAborted(signal);
            fullText += chunk;
            if (onUpdate) onUpdate(chunk);
        }

        return { content: fullText };
    }

    destroy() {
        if (this._summarizer) {
            this._summarizer.destroy();
            this._summarizer = null;
        }
    }
}
