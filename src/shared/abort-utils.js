/**
 * Shared utilities for handling AbortSignal in async operations.
 */

/**
 * Race a promise against an abort signal.
 * Rejects with AbortError if the signal aborts before the promise settles.
 * 
 * @param {Promise<T>} promise - The promise to race
 * @param {AbortSignal|undefined} signal - Optional abort signal
 * @returns {Promise<T>}
 * @template T
 */
export function raceWithSignal(promise, signal) {
    if (!signal) return promise;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        }),
    ]);
}

/**
 * Throw an AbortError if the signal is aborted.
 * 
 * @param {AbortSignal|undefined} signal - Optional abort signal
 * @throws {DOMException} AbortError if signal is aborted
 */
export function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException('Cancelled', 'AbortError');
    }
}

/**
 * Read one chunk from a stream reader, racing against an abort signal.
 * Rejects with AbortError if the signal aborts before the read completes.
 * 
 * @param {ReadableStreamDefaultReader} reader - The stream reader
 * @param {AbortSignal|undefined} signal - Optional abort signal
 * @returns {Promise<ReadableStreamReadResult>}
 */
export function raceReadWithSignal(reader, signal) {
    if (!signal) return reader.read();
    return Promise.race([
        reader.read(),
        new Promise((_, reject) => {
            if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        }),
    ]);
}
