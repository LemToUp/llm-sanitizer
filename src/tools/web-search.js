import { tool } from '@openai/agents';
import { z } from 'zod';

/**
 * Search provider definitions, ordered by priority.
 * The first provider with a configured API key will be used.
 */
export const SEARCH_PROVIDERS = [
    {
        id: 'brave',
        label: 'Brave Search',
        settingsKey: 'searchKeyBrave',
        placeholder: 'BSA...',
        freeQuota: '2 000 req/month',
        docsUrl: 'https://brave.com/search/api/',
    },
    {
        id: 'tavily',
        label: 'Tavily',
        settingsKey: 'searchKeyTavily',
        placeholder: 'tvly-...',
        freeQuota: '1 000 req/month',
        docsUrl: 'https://tavily.com/',
    },
    {
        id: 'serpapi',
        label: 'SerpAPI',
        settingsKey: 'searchKeySerpapi',
        placeholder: '',
        freeQuota: '100 req/month',
        docsUrl: 'https://serpapi.com/',
    },
    {
        id: 'google',
        label: 'Google Custom Search',
        settingsKey: 'searchKeyGoogle',
        placeholder: '',
        freeQuota: '100 req/day',
        docsUrl: 'https://developers.google.com/custom-search/v1/overview',
        /** Google CSE also requires a search engine ID */
        extraKeys: [{ settingsKey: 'searchGoogleCx', label: 'Search Engine ID', placeholder: '' }],
    },
];

/** All storage keys used by search providers */
export const SEARCH_SETTINGS_KEYS = SEARCH_PROVIDERS.flatMap(p => [
    p.settingsKey,
    ...(p.extraKeys?.map(k => k.settingsKey) ?? []),
]);

/**
 * Resolve the active search provider from settings.
 * Returns the first provider whose API key is configured, or null.
 *
 * @param {Record<string, string>} settings - Settings from chrome.storage
 * @returns {{ provider: object, apiKey: string, extra?: Record<string, string> } | null}
 */
export function resolveSearchProvider(settings) {
    for (const provider of SEARCH_PROVIDERS) {
        const apiKey = settings[provider.settingsKey];
        if (!apiKey) continue;

        // Check extra keys (e.g. Google CX)
        if (provider.extraKeys) {
            const extra = {};
            let allPresent = true;
            for (const ek of provider.extraKeys) {
                const val = settings[ek.settingsKey];
                if (!val) { allPresent = false; break; }
                extra[ek.settingsKey] = val;
            }
            if (!allPresent) continue;
            return { provider, apiKey, extra };
        }

        return { provider, apiKey };
    }
    return null;
}

/**
 * Create a web search tool for the OpenAI Agents SDK.
 *
 * @param {string} providerId - Search provider id (brave, tavily, serpapi, google)
 * @param {string} apiKey - API key for the search provider
 * @param {Record<string, string>} [extra] - Extra config (e.g. Google CX)
 * @returns {import('@openai/agents').Tool}
 */
export function createWebSearchTool(providerId, apiKey, extra = {}) {
    const searchFn = SEARCH_FUNCTIONS[providerId];
    if (!searchFn) throw new Error(`Unknown search provider: ${providerId}`);

    return tool({
        name: 'web_search',
        description:
            'Search the web to verify claims, check facts, or find current information about a topic. '
            + 'Use this when the article makes claims that should be verified against external sources.',
        parameters: z.object({
            query: z.string().describe('Search query to look up'),
        }),
        async execute({ query }) {
            try {
                return await searchFn(query, apiKey, extra);
            } catch (err) {
                return `Search failed: ${err.message}`;
            }
        },
    });
}

// ── Search provider implementations ──

const MAX_RESULTS = 5;

const SEARCH_FUNCTIONS = {
    brave: searchBrave,
    tavily: searchTavily,
    serpapi: searchSerpapi,
    google: searchGoogle,
};

/**
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
async function searchBrave(query, apiKey) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(MAX_RESULTS));

    const res = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': apiKey,
        },
    });

    if (!res.ok) throw new Error(`Brave API ${res.status}: ${res.statusText}`);
    const data = await res.json();

    const results = data.web?.results ?? [];
    if (!results.length) return 'No results found.';

    return results
        .slice(0, MAX_RESULTS)
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.description}\n   ${r.url}`)
        .join('\n\n');
}

/**
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
async function searchTavily(query, apiKey) {
    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: MAX_RESULTS,
            include_answer: true,
        }),
    });

    if (!res.ok) throw new Error(`Tavily API ${res.status}: ${res.statusText}`);
    const data = await res.json();

    const parts = [];
    if (data.answer) {
        parts.push(`Summary: ${data.answer}`);
    }

    const results = data.results ?? [];
    if (results.length) {
        parts.push(
            results
                .slice(0, MAX_RESULTS)
                .map((r, i) => `${i + 1}. ${r.title}\n   ${r.content?.slice(0, 200) ?? ''}\n   ${r.url}`)
                .join('\n\n')
        );
    }

    return parts.join('\n\n') || 'No results found.';
}

/**
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
async function searchSerpapi(query, apiKey) {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(MAX_RESULTS));

    const res = await fetch(url);

    if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${res.statusText}`);
    const data = await res.json();

    const results = data.organic_results ?? [];
    if (!results.length) return 'No results found.';

    return results
        .slice(0, MAX_RESULTS)
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet ?? ''}\n   ${r.link}`)
        .join('\n\n');
}

/**
 * @param {string} query
 * @param {string} apiKey
 * @param {Record<string, string>} extra
 * @returns {Promise<string>}
 */
async function searchGoogle(query, apiKey, extra) {
    const cx = extra.searchGoogleCx;
    if (!cx) throw new Error('Google Custom Search Engine ID (cx) is not configured.');

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('q', query);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('num', String(MAX_RESULTS));

    const res = await fetch(url);

    if (!res.ok) throw new Error(`Google CSE ${res.status}: ${res.statusText}`);
    const data = await res.json();

    const results = data.items ?? [];
    if (!results.length) return 'No results found.';

    return results
        .slice(0, MAX_RESULTS)
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet ?? ''}\n   ${r.link}`)
        .join('\n\n');
}
