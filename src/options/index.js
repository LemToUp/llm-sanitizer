import { DEFAULT_PROMPT, LANGUAGE_OPTIONS } from '../shared/defaults.js';
import { DEFAULT_PROVIDER } from '../providers/index.js';
import { SEARCH_PROVIDERS, SEARCH_SETTINGS_KEYS } from '../tools/web-search.js';

document.addEventListener('DOMContentLoaded', async () => {
    const providerSelect = document.getElementById('provider');
    const baseUrlInput = document.getElementById('base-url');
    const apiKeyInput = document.getElementById('api-key');
    const modelInput = document.getElementById('model');
    const contextLengthInput = document.getElementById('context-length');
    const languageSelect = document.getElementById('response-language');
    const promptInput = document.getElementById('active-prompt');
    const saveBtn = document.getElementById('save-settings');
    const statusDiv = document.getElementById('status');

    // Populate language options
    LANGUAGE_OPTIONS.forEach(({ code, label }) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = label;
        languageSelect.appendChild(opt);
    });

    // ── Build search provider key fields dynamically ──
    const searchContainer = document.getElementById('search-keys-container');
    const searchInputs = searchContainer ? buildSearchFields(searchContainer) : {};

    // Toggle OpenAI-specific fields based on provider selection
    function updateProviderFields() {
        const isOpenAI = providerSelect.value === 'openai-agents';
        document.querySelectorAll('.openai-only').forEach(el => {
            el.style.display = isOpenAI ? '' : 'none';
        });
    }

    providerSelect.addEventListener('change', updateProviderFields);

    // Load saved settings
    const settings = await chrome.storage.local.get([
        'provider', 'prompt', 'baseUrl', 'apiKey', 'model',
        'contextLength', 'language',
        ...SEARCH_SETTINGS_KEYS,
    ]);

    providerSelect.value = settings.provider || DEFAULT_PROVIDER;
    if (settings.baseUrl) baseUrlInput.value = settings.baseUrl;
    if (settings.apiKey) apiKeyInput.value = settings.apiKey;
    if (settings.model) modelInput.value = settings.model;
    if (settings.contextLength) contextLengthInput.value = settings.contextLength;
    
    // Set language (default to browser language if not set)
    if (settings.language !== undefined) {
        languageSelect.value = settings.language;
    } else {
        const browserCode = navigator.language?.split('-')[0] || '';
        const hasOption = LANGUAGE_OPTIONS.some((o) => o.code === browserCode);
        languageSelect.value = hasOption ? browserCode : '';
    }
    
    promptInput.value = settings.prompt || DEFAULT_PROMPT;

    // Load search keys into inputs
    for (const [key, input] of Object.entries(searchInputs)) {
        if (settings[key]) input.value = settings[key];
    }
    updateSearchBadges(searchInputs);

    // Update field visibility based on loaded provider
    updateProviderFields();

    // Save Settings
    saveBtn.addEventListener('click', async () => {
        const provider = providerSelect.value;
        const baseUrl = baseUrlInput.value.trim() || undefined;
        const apiKey = apiKeyInput.value.trim() || undefined;
        const model = modelInput.value.trim() || undefined;
        const contextLength = parseInt(contextLengthInput.value, 10) || undefined;
        const language = languageSelect.value;
        const prompt = promptInput.value.trim() || undefined;

        // Collect search keys
        const searchData = {};
        for (const [key, input] of Object.entries(searchInputs)) {
            searchData[key] = input.value.trim() || undefined;
        }

        await chrome.storage.local.set({
            provider,
            baseUrl,
            apiKey,
            model,
            contextLength,
            language,
            prompt,
            ...searchData,
        });

        statusDiv.textContent = 'Settings saved successfully!';
        statusDiv.classList.add('visible');

        saveBtn.disabled = true;
        setTimeout(() => {
            statusDiv.classList.remove('visible');
            saveBtn.disabled = false;
        }, 2000);
    });
});

/**
 * Build search provider input fields from SEARCH_PROVIDERS config.
 * @param {HTMLElement} container - Container element
 * @returns {Record<string, HTMLInputElement>} Map of settingsKey -> input element
 */
function buildSearchFields(container) {
    const inputs = {};
    const list = document.createElement('div');
    list.className = 'search-providers-list';

    for (let i = 0; i < SEARCH_PROVIDERS.length; i++) {
        const sp = SEARCH_PROVIDERS[i];
        const group = document.createElement('div');
        group.className = 'search-provider';

        // Header with label, badge, free quota
        const header = document.createElement('div');
        header.className = 'search-provider-header';

        const label = document.createElement('label');
        label.setAttribute('for', sp.settingsKey);
        label.textContent = `${i + 1}. ${sp.label}`;

        const meta = document.createElement('div');
        meta.className = 'search-provider-meta';

        const badge = document.createElement('span');
        badge.className = 'search-badge';
        badge.dataset.provider = sp.id;
        badge.textContent = '\u2014'; // em-dash placeholder
        badge.style.display = 'none';
        meta.appendChild(badge);

        const quota = document.createElement('span');
        quota.className = 'search-quota';
        quota.textContent = `Free: ${sp.freeQuota}`;
        meta.appendChild(quota);

        header.appendChild(label);
        header.appendChild(meta);
        group.appendChild(header);

        // Input fields
        const fieldsDiv = document.createElement('div');
        fieldsDiv.className = 'search-fields' + (sp.extraKeys?.length ? ' has-extra' : '');

        const input = document.createElement('input');
        input.type = 'password';
        input.id = sp.settingsKey;
        input.placeholder = sp.placeholder || 'API key';
        input.addEventListener('input', () => updateSearchBadges(inputs));
        fieldsDiv.appendChild(input);
        inputs[sp.settingsKey] = input;

        // Extra keys (e.g. Google CX)
        if (sp.extraKeys) {
            for (const ek of sp.extraKeys) {
                const extraInput = document.createElement('input');
                extraInput.type = 'text';
                extraInput.id = ek.settingsKey;
                extraInput.placeholder = ek.label;
                extraInput.addEventListener('input', () => updateSearchBadges(inputs));
                fieldsDiv.appendChild(extraInput);
                inputs[ek.settingsKey] = extraInput;
            }
        }

        group.appendChild(fieldsDiv);
        list.appendChild(group);
    }

    container.appendChild(list);
    return inputs;
}

/**
 * Update "Active" badge on the first provider with a key.
 * @param {Record<string, HTMLInputElement>} inputs
 */
function updateSearchBadges(inputs) {
    let activeFound = false;

    for (const sp of SEARCH_PROVIDERS) {
        const badge = document.querySelector(`.search-badge[data-provider="${sp.id}"]`);
        if (!badge) continue;

        const hasKey = !!inputs[sp.settingsKey]?.value.trim();
        let hasAllExtra = true;
        if (sp.extraKeys) {
            for (const ek of sp.extraKeys) {
                if (!inputs[ek.settingsKey]?.value.trim()) {
                    hasAllExtra = false;
                    break;
                }
            }
        }

        const isComplete = hasKey && hasAllExtra;

        if (isComplete && !activeFound) {
            badge.textContent = 'Active';
            badge.classList.add('active');
            badge.style.display = '';
            activeFound = true;
        } else if (isComplete) {
            badge.textContent = 'Standby';
            badge.classList.remove('active');
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }
}
