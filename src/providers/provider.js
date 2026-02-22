/**
 * Base class for LLM providers.
 *
 * Every provider must implement:
 *  - static id       — unique string key (e.g. 'chrome-rewriter')
 *  - static label    — human-readable name shown in settings
 *  - static checkAvailability() → { available, reason? }
 *  - call({ text, prompt, onStatus?, onUpdate?, signal? }) → { content }
 *  - destroy()
 *
 * Callbacks passed to call():
 *  - onStatus(text: string, progress: number|null)
 *      Status message (e.g. "Downloading model…").
 *      progress is 0–1 for determinate, null for indeterminate.
 *  - onUpdate(delta: string)
 *      Incremental chunk of output text (streaming).
 */
export class Provider {
    /** @type {string} Unique provider key */
    static id = '';

    /** @type {string} Display name */
    static label = '';

    /**
     * Check whether this provider can be used in the current environment.
     * @returns {Promise<{ available: boolean, reason?: string }>}
     */
    static async checkAvailability() {
        return { available: false, reason: 'Not implemented' };
    }

    /**
     * @param {Record<string, unknown>} settings — provider-specific settings
     */
    constructor(settings) {
        if (new.target === Provider) {
            throw new Error('Provider is abstract — use a concrete subclass');
        }
        this.settings = settings;
    }

    /**
     * Send text to the LLM and stream back the result.
     * @param {object}   params
     * @param {string}   params.text     — source text to process
     * @param {string}   params.prompt   — system instructions / context
     * @param {function} [params.onStatus] — status callback
     * @param {function} [params.onUpdate] — streaming delta callback
     * @param {AbortSignal} [params.signal] — abort when tab is closed/reloaded
     * @returns {Promise<{ content: string }>}
     */
    async call({ text, prompt, onStatus, onUpdate, signal }) {
        throw new Error('call() must be implemented by subclass');
    }

    /** Release any resources held by this provider instance. */
    destroy() {}
}
