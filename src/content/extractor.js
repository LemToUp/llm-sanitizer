import { Readability } from '@mozilla/readability';

/**
 * Extract article content from the current page using Mozilla Readability.
 * 
 * @returns {{ title: string, textContent: string }}
 * @throws {Error} If the page content cannot be parsed
 */
export function extractContent() {
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (!article) {
        throw new Error('Could not parse article content');
    }

    return {
        title: article.title,
        textContent: article.textContent
    };
}
