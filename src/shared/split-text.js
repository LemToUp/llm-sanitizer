/**
 * Recursive text splitter.
 *
 * Splits text into chunks that fit within maxChars,
 * breaking on natural boundaries (paragraphs → lines → sentences → words).
 * Falls back to a hard character split as a last resort.
 */

const SEPARATORS = ['\n\n', '\n', '. ', ' '];

export function splitText(text, maxChars) {
    if (text.length <= maxChars) return [text];
    return _splitRecursive(text, maxChars, 0);
}

function _splitRecursive(text, maxChars, sepIdx) {
    if (text.length <= maxChars) return [text];

    // Hard character split as last resort
    if (sepIdx >= SEPARATORS.length) {
        const chunks = [];
        for (let i = 0; i < text.length; i += maxChars) {
            chunks.push(text.slice(i, i + maxChars));
        }
        return chunks;
    }

    const sep = SEPARATORS[sepIdx];
    const parts = text.split(sep);

    // If splitting didn't help, try the next separator
    if (parts.length <= 1) {
        return _splitRecursive(text, maxChars, sepIdx + 1);
    }

    // Merge parts into chunks that fit within maxChars
    const chunks = [];
    let current = '';

    for (const part of parts) {
        const candidate = current ? current + sep + part : part;
        if (candidate.length <= maxChars) {
            current = candidate;
        } else {
            if (current) chunks.push(current);
            current = part;
        }
    }
    if (current) chunks.push(current);

    // Recursively split any chunk that is still too large
    return chunks.flatMap(chunk =>
        chunk.length > maxChars
            ? _splitRecursive(chunk, maxChars, sepIdx + 1)
            : [chunk],
    );
}
