export const DEFAULT_PROMPT = `Your response MUST have two clearly separated sections in this exact order.

First section: a manipulation warning.
Scan the headline and article for manipulative techniques: clickbait, emotional pressure, fear-mongering, false urgency, leading questions, loaded framing, unsubstantiated claims presented as facts.

If any are found, start your response with a short warning block:
- Name each technique detected and give a concrete example from the text.
- If the headline exaggerates, contradicts, or misrepresents the article body — say so directly.
- State the actual scale: real numbers vs. what is implied.

If the article is factual and neutral, start with a single line stating that no manipulative techniques were detected.

Second section: a neutral summary.
After the warning, provide a neutral summary:
- Verifiable facts, data, and attributed quotes only.
- Core argument and event structure.
- Proper context: comparisons, historical baselines, and proportionality.

Tone:
- Calm and neutral. Do not amplify anxiety, outrage, or helplessness.
- If the topic is distressing, briefly note what is within and outside the reader's control.
- Replace doom-framing with actionable perspective: what happened, who is affected, what (if anything) the reader can do.

Exclude:
- Emotional appeals and sensationalist framing.
- Unsubstantiated claims without attribution.
- Off-topic promotional content and SEO filler.`;

/** Verbosity levels for summary detail. */
export const VERBOSITY = {
    SHORT: 'short',
    MEDIUM: 'medium',
    DETAILED: 'detailed',
};

export const DEFAULT_VERBOSITY = VERBOSITY.MEDIUM;

export const VERBOSITY_OPTIONS = [
    { id: VERBOSITY.SHORT, label: 'Short' },
    { id: VERBOSITY.MEDIUM, label: 'Medium' },
    { id: VERBOSITY.DETAILED, label: 'Detailed' },
];

/**
 * Returns a prompt instruction for the given verbosity level.
 * @param {string} verbosity - One of VERBOSITY values
 * @returns {string}
 */
export function getVerbosityInstruction(verbosity) {
    switch (verbosity) {
        case VERBOSITY.SHORT:
            return 'Provide a brief, concise summary with only the key facts. Keep it as short as possible.';
        case VERBOSITY.DETAILED:
            return 'Provide a comprehensive, detailed summary covering all important points, arguments, and evidence.';
        case VERBOSITY.MEDIUM:
        default:
            return 'Provide a balanced summary with the main facts and arguments at moderate length.';
    }
}

/**
 * Prompt extension for when web search (fact-checking) is available.
 */
export const FACT_CHECK_INSTRUCTION = `You have access to a web_search tool. Use it to:
- Verify key claims, statistics, and quotes mentioned in the article.
- Check if the described event actually happened and whether the scale matches reality.
- Look up context the article omits (e.g. base rates, historical precedent, official statements).

After verifying, clearly mark in your summary:
- [Verified] — facts confirmed by external sources.
- [Unverified] — claims you could not confirm.
- [Misleading] — claims that are technically true but presented in a deceptive way.
- [False] — claims directly contradicted by reliable sources.

Do not search for every sentence — focus on the most consequential and suspicious claims.`;

/** Theme options for modal appearance. */
export const THEME = {
    DARK: 'dark',
    LIGHT: 'light',
};

export const DEFAULT_THEME = THEME.DARK;

export const THEME_OPTIONS = [
    { id: THEME.LIGHT, label: 'Light', icon: '☀' },
    { id: THEME.DARK, label: 'Dark', icon: '☾' },
];

/** Language options for response language. Empty string = browser UI language. */
export const LANGUAGE_OPTIONS = [
    { code: '', label: 'Browser default' },
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'uk', label: 'Українська' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt', label: 'Português' },
    { code: 'pl', label: 'Polski' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
];

const LANGUAGE_NAMES = Object.fromEntries(
    LANGUAGE_OPTIONS.filter((o) => o.code).map((o) => [o.code, o.label]),
);

/**
 * Returns instruction to respond in the given language, or empty string if unknown.
 * @param {string} code — language code (e.g. 'en', 'ru'); use '' for browser default.
 * @param {string} [browserCode] — when code is '', use this (e.g. from chrome.i18n.getUILanguage()).
 * @returns {string}
 */
export function getLanguageInstruction(code, browserCode = '') {
    const c = code || (browserCode && browserCode.split('-')[0]) || '';
    if (!c) return '';
    const name = LANGUAGE_NAMES[c];
    return name
        ? `IMPORTANT: You MUST respond in "${name}" language regardless of the article's language.`
        : '';
}
