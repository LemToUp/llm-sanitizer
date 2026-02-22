// Background service worker for content sanitization

import {
  DEFAULT_PROMPT,
  DEFAULT_VERBOSITY,
  FACT_CHECK_INSTRUCTION,
  getLanguageInstruction,
  getVerbosityInstruction,
} from "../shared/defaults.js";
import { createProvider, DEFAULT_PROVIDER } from "../providers/index.js";
import { MSG, KEEPALIVE_PORT } from "../shared/messages.js";
import {
  SEARCH_SETTINGS_KEYS,
  resolveSearchProvider,
  createWebSearchTool,
} from "../tools/web-search.js";
import contentScriptPath from "../content/index.js?script";

/** TabId -> { resolve, port }; used so SW stays alive during long streaming. */
const keepalivePending = new Map();

/** TabId -> AbortController; abort when tab is closed or reloaded. */
const tabAbortControllers = new Map();

/** Keepalive timeout in milliseconds */
const KEEPALIVE_TIMEOUT_MS = 3000;

/** Script injection delay in milliseconds */
const SCRIPT_INJECTION_DELAY_MS = 100;

/** Error badge configuration */
const ERROR_BADGE = {
  text: "ERR",
  color: "#FF4444",
};

/** Protected URL prefixes that cannot run extensions */
const PROTECTED_URL_PREFIXES = ["chrome://", "edge://"];

/**
 * Set up lifecycle listeners for tab management.
 */
function setupLifecycleListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    const ctrl = tabAbortControllers.get(tabId);
    if (ctrl) {
      ctrl.abort();
      tabAbortControllers.delete(tabId);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      const ctrl = tabAbortControllers.get(tabId);
      if (ctrl) {
        ctrl.abort();
        tabAbortControllers.delete(tabId);
      }
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== KEEPALIVE_PORT) return;
    const tabId = port.sender?.tab?.id;
    if (tabId == null) return;
    const entry = keepalivePending.get(tabId);
    if (entry) {
      entry.resolve(port);
      keepalivePending.delete(tabId);
    }
  });
}

/**
 * Wait for keepalive port connection from content script.
 *
 * @param {number} tabId - Tab ID to wait for
 * @returns {Promise<chrome.runtime.Port|null>} Port or null if timeout
 */
async function waitForKeepalive(tabId) {
  const keepalivePromise = new Promise((resolve) => {
    keepalivePending.set(tabId, { resolve });
  });

  await chrome.tabs.sendMessage(tabId, {
    type: MSG.SHOW_MODAL,
    payload: { content: "", keepAlive: true },
  });

  const port = await Promise.race([
    keepalivePromise,
    new Promise((resolve) =>
      setTimeout(() => resolve(null), KEEPALIVE_TIMEOUT_MS),
    ),
  ]);

  if (!port) {
    keepalivePending.delete(tabId);
    return null;
  }

  // Abort generation when the modal is closed (port disconnected by content script),
  // or when the page is closed / reloaded (port auto-disconnected).
  port.onDisconnect.addListener(() => {
    const ctrl = tabAbortControllers.get(tabId);
    if (ctrl) {
      ctrl.abort();
      tabAbortControllers.delete(tabId);
    }
  });

  return port;
}

/**
 * Ensures the content script is injected and responding in the given tab.
 *
 * @param {number} tabId - Tab ID to check/inject
 * @returns {Promise<boolean>}
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.PING });
    return true;
  } catch (err) {
    console.log("Content script not found, injecting...");
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScriptPath],
    });
    await new Promise((resolve) =>
      setTimeout(resolve, SCRIPT_INJECTION_DELAY_MS),
    );
    return true;
  }
}

/**
 * Main sanitization orchestration for a tab.
 *
 * @param {chrome.tabs.Tab} tab - Tab to sanitize
 */
async function sanitizeTab(tab) {
  const tabId = tab.id;
  const abortController = new AbortController();
  tabAbortControllers.set(tabId, abortController);

  const sendStatus = (text, progress) => {
    chrome.tabs
      .sendMessage(tabId, { type: MSG.SET_STATUS, payload: { text, progress } })
      .catch(() => {});
  };

  let keepalivePort = null;

  try {
    console.log("Starting sanitization for tab:", tabId);

    // Check for protected URLs
    if (
      !tab.url ||
      PROTECTED_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))
    ) {
      console.warn("Cannot run extension on protected browser page");
      return;
    }

    // 1. Ensure content script is injected
    await ensureContentScript(tabId);

    // 2. Get settings
    const settings = await chrome.storage.local.get([
      "provider",
      "prompt",
      "language",
      "verbosity",
      "baseUrl",
      "contextLength",
      "apiKey",
      "model",
      ...SEARCH_SETTINGS_KEYS,
    ]);

    const providerId = settings.provider || DEFAULT_PROVIDER;
    const verbosity = settings.verbosity || DEFAULT_VERBOSITY;
    const basePrompt = settings.prompt || DEFAULT_PROMPT;
    const browserLang = chrome.i18n.getUILanguage?.() || "";
    const langInstruction = getLanguageInstruction(
      settings.language ?? "",
      browserLang,
    );
    const verbosityInstruction = getVerbosityInstruction(verbosity);

    // 3. Extract content from page
    const article = await chrome.tabs.sendMessage(tabId, {
      type: MSG.GET_CONTENT,
    });

    if (!article || !article.textContent) {
      console.error("No content found on page");
      return;
    }

    // 4. Open modal and wait for keepalive port
    keepalivePort = await waitForKeepalive(tabId);

    // 5. Build tools (web search if configured) and finalize prompt
    const tools = [];
    const searchMatch = resolveSearchProvider(settings);
    if (searchMatch) {
      tools.push(
        createWebSearchTool(
          searchMatch.provider.id,
          searchMatch.apiKey,
          searchMatch.extra,
        ),
      );
      console.log(`Web search enabled: ${searchMatch.provider.label}`);
    }

    const factCheckBlock = searchMatch ? FACT_CHECK_INSTRUCTION : "";
    const prompt = [
      langInstruction,
      basePrompt,
      verbosityInstruction,
      factCheckBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
    console.log("[DEBUG] Final prompt:\n", prompt);

    // 6. Create provider and call LLM
    const provider = createProvider(providerId, {
      baseUrl: settings.baseUrl,
      contextLength: settings.contextLength,
      apiKey: settings.apiKey,
      model: settings.model,
      verbosity,
      tools,
    });

    try {
      await provider.call({
        text: article.textContent,
        prompt,
        signal: abortController.signal,
        onStatus: sendStatus,
        onUpdate: (delta) => {
          chrome.tabs
            .sendMessage(tabId, {
              type: MSG.UPDATE_CONTENT,
              payload: { delta },
            })
            .catch(() => {});
        },
      });
    } finally {
      tabAbortControllers.delete(tabId);
      provider.destroy();
      if (keepalivePort) {
        try {
          keepalivePort.disconnect();
        } catch (_) {}
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      return;
    }
    console.error("Sanitize error:", err);

    const message = err?.message ?? String(err);

    await chrome.action.setBadgeText({ text: ERROR_BADGE.text, tabId });
    await chrome.action.setBadgeBackgroundColor({
      color: ERROR_BADGE.color,
      tabId,
    });
    await chrome.action.setTitle({
      title: `Error: ${message}`,
      tabId,
    });

    sendStatus(`Error: ${message}`, null);

    await chrome.tabs.sendMessage(tabId, {
      type: MSG.SHOW_MODAL,
      payload: { content: `Error: ${message}`, isError: true },
    });
  } finally {
    tabAbortControllers.delete(tabId);
  }
}

// Initialize lifecycle listeners
setupLifecycleListeners();

// Handle extension icon clicks
chrome.action.onClicked.addListener(sanitizeTab);
