# Architecture — LLM News Sanitizer

A Chrome extension (Manifest V3) that sanitizes news articles using LLMs:
it extracts text from a page, sends it to a language model, and displays
a version stripped of manipulative language in a modal overlay on top of the page.

---

## Directory Structure

```
BrowsExt/
├── manifest.json                  # Manifest V3 — extension entry point
├── package.json                   # npm dependencies and scripts (vite, readability, @openai/agents)
├── vite.config.js                 # Build via Vite + @crxjs/vite-plugin
│
├── icons/
│   ├── icon16.png                 # Extension icon 16×16
│   ├── icon48.png                 # Extension icon 48×48
│   └── icon128.png                # Extension icon 128×128
│
├── src/
│   ├── background/
│   │   └── index.js               # Service Worker — sanitization orchestrator
│   │
│   ├── content/
│   │   ├── index.js               # Content Script — message router
│   │   ├── extractor.js           # Article extraction (Mozilla Readability)
│   │   ├── modal.js               # Modal window (Shadow DOM, streaming)
│   │   └── modal.css              # Modal styles
│   │
│   ├── options/
│   │   ├── index.html             # Settings page HTML
│   │   ├── index.js               # Settings page logic
│   │   └── style.css              # Settings page styles
│   │
│   ├── providers/
│   │   ├── index.js               # Provider registry + createProvider() factory
│   │   ├── provider.js            # Abstract base class Provider
│   │   ├── openai-agents.js       # OpenAI-compatible provider (@openai/agents SDK)
│   │   └── chrome-summarizer.js   # Chrome Summarizer API (Gemini Nano)
│   │
│   ├── tools/
│   │   └── web-search.js          # Web search tool for fact-checking
│   │
│   └── shared/
│       ├── messages.js            # Message type constants (MSG) and port names
│       ├── constants.js           # CHARS_PER_TOKEN and other shared constants
│       ├── defaults.js            # Default prompt, verbosity levels, languages
│       ├── split-text.js          # Recursive text chunking utility
│       └── abort-utils.js         # AbortSignal utilities
│
└── dist/                          # Build output directory
```

---

## Components and Their Roles

### 1. Background Service Worker (`src/background/index.js`)

Central orchestrator. Triggered by clicking the extension icon.

**`sanitizeTab(tab)` lifecycle:**

1. Checks that the URL is not protected (`chrome://`, `edge://`)
2. Injects content script if needed (`ensureContentScript`)
3. Loads settings from `chrome.storage.local`
4. Requests content extraction from the content script (`MSG.GET_CONTENT`)
5. Opens the modal and establishes a keepalive port
6. Builds tools (web search, if configured)
7. Composes the final prompt (base + verbosity + factcheck + language)
8. Creates a provider via the factory and calls `provider.call()`
9. Streams deltas back to the content script (`MSG.UPDATE_CONTENT`)

**Keepalive mechanism:**
- Prevents SW termination during long-running operations
- The modal establishes `chrome.runtime.connect()`, SW holds the port
- Port disconnect = generation cancelled (`AbortController.abort()`)

**Tab lifecycle management:**
- `tabAbortControllers` — Map `tabId → AbortController`
- Tab close/reload automatically aborts the operation

### 2. Content Script (`src/content/index.js`)

Message router between the background and the page DOM.

| Message              | Action                                           |
|----------------------|-------------------------------------------------|
| `MSG.PING`           | Responds `true` (health check)                  |
| `MSG.GET_CONTENT`    | Calls `extractor.js`, returns article text       |
| `MSG.SHOW_MODAL`     | Shows/recreates the modal window                |
| `MSG.SET_STATUS`     | Updates the status bar in the modal             |
| `MSG.UPDATE_CONTENT` | Appends a streaming delta to the modal          |

### 3. Extractor (`src/content/extractor.js`)

Uses **Mozilla Readability** to extract the main article content.
Returns `{ title, textContent }`.

### 4. Modal (`src/content/modal.js`)

Overlay modal window on top of the page.

- **Shadow DOM** — style isolation from the host page
- **Streaming** — text appears as it is generated (`updateContent(delta)`)
- **Settings** — collapsible panel with verbosity toggle
- **Status bar** — progress indicator or loading animation
- **Keepalive port** — keeps SW alive; closing the modal = abort
- **Keyboard** — Escape to close

### 5. Options Page (`src/options/`)

Extension settings page:
- Provider selection (OpenAI-compatible / Chrome Summarizer)
- API URL, key, model
- Context length
- Response language
- Custom prompt
- Web search API keys (Brave, Tavily, SerpAPI, Google)

All settings are persisted in `chrome.storage.local`.

---

## Provider System

### Abstract class `Provider` (`src/providers/provider.js`)

```
static id            — unique key ('openai-agents', 'chrome-summarizer')
static label         — display name
static checkAvailability() → { available, reason? }
call({ text, prompt, onStatus, onUpdate, signal }) → { content }
destroy()            — release resources
```

**Callback contract:**
- `onStatus(text, progress)` — status update (progress: 0–1 or null for indeterminate)
- `onUpdate(delta)` — incremental text chunk (streaming)

### OpenAI Agents Provider (`src/providers/openai-agents.js`)

- Uses the `@openai/agents` SDK
- Works with any OpenAI-compatible API (configurable baseUrl)
- Supports streaming, long text chunking, tools (web search)
- Splits text by `contextLength` and processes chunks sequentially

### Chrome Summarizer Provider (`src/providers/chrome-summarizer.js`)

- Uses the Chrome Summarizer API (Gemini Nano, on-device model)
- Recursive summarization for texts that exceed the context window
- Requires no API keys

### Registry and factory (`src/providers/index.js`)

```js
providers = { [id]: ProviderClass, ... }
createProvider(id, settings) → Provider instance
DEFAULT_PROVIDER = 'openai-agents'
```

---

## Web Search & Fact-Checking (`src/tools/web-search.js`)

A tool for the OpenAI Agents SDK that lets the LLM verify facts via web search.

**Supported search providers** (in priority order):
1. **Brave Search** — key `braveApiKey`
2. **Tavily** — key `tavilyApiKey`
3. **SerpAPI** — key `serpApiKey`
4. **Google Custom Search** — keys `googleApiKey` + `googleCseId`

Returns formatted search results for LLM verification.

When a search provider is configured, `FACT_CHECK_INSTRUCTION` is appended to the prompt,
instructing the LLM to tag facts as `[Verified]`, `[Unverified]`, `[Misleading]`, or `[False]`.

---

## Data Flow

### Main sanitization flow

```
User clicks the extension icon
         │
         ▼
┌─────────────────────────────────┐
│  Background Service Worker      │
│  sanitizeTab()                  │
│                                 │
│  1. ensureContentScript()  ────────►  Content Script (PING)
│  2. chrome.storage.local.get()  │
│  3. GET_CONTENT  ──────────────────►  Extractor (Readability)
│                  ◄─────────────────  { title, textContent }
│  4. SHOW_MODAL  ───────────────────►  Modal.show() + keepalive port
│                  ◄─────────────────  Port connected
│  5. resolveSearchProvider()     │
│  6. createProvider() + call()   │
│         │                       │
│         ▼                       │
│  ┌───────────────┐              │
│  │   Provider     │              │
│  │  (streaming)   │──── onUpdate(delta) ──►  MSG.UPDATE_CONTENT ──► Modal.updateContent()
│  │               │──── onStatus(text)  ──►  MSG.SET_STATUS     ──► Modal.setStatus()
│  └───────────────┘              │
└─────────────────────────────────┘
```

### Message passing

| Direction                     | Mechanism                          |
|-------------------------------|------------------------------------|
| Background → Content Script   | `chrome.tabs.sendMessage(tabId)`   |
| Content Script → Background   | `chrome.runtime.sendMessage()` / return value |
| Keepalive                     | `chrome.runtime.connect()` (long-lived port) |
| Settings storage              | `chrome.storage.local`             |

### Long text processing

1. Text is extracted via Readability
2. `split-text.js` recursively chunks text (paragraphs → lines → sentences → words)
3. Chunks are processed sequentially
4. Each chunk is streamed incrementally
5. For Chrome Summarizer — recursive summarization when chunks don't fit

---

## Error Handling

- **Tab close/reload** → `AbortController.abort()` cancels all operations
- **Port disconnect** (modal closed) → also triggers abort
- **Network errors** → displayed in the modal with an error icon
- **Protected URLs** → silent return, no action
- **Icon badge** → red "ERR" badge on errors

---

## Build & Dependencies

### Build
- **Vite** + **@crxjs/vite-plugin** — builds the extension from manifest.json
- `npm run dev` — dev mode with HMR
- `npm run build` — production build to `dist/`

### Key dependencies
| Package                | Role                                         |
|------------------------|----------------------------------------------|
| `@mozilla/readability` | Article content extraction from DOM          |
| `@openai/agents`       | SDK for OpenAI-compatible APIs with agents   |
| `zod`                  | Schema validation (tool parameters)          |
| `@crxjs/vite-plugin`   | Vite plugin for Chrome extensions            |

### Permissions (manifest.json)
| Permission  | Purpose                                          |
|-------------|--------------------------------------------------|
| `activeTab` | Access to the current tab on click               |
| `storage`   | Persist settings in `chrome.storage.local`       |
| `scripting` | Dynamic content script injection                 |

---

## Design Patterns

| Pattern             | Where used                                        |
|---------------------|--------------------------------------------------|
| Provider (Strategy) | Abstract class + concrete LLM implementations    |
| Factory             | `createProvider(id, settings)` by ID             |
| Observer            | `onStatus`, `onUpdate` callbacks for streaming   |
| Shadow DOM          | Modal style isolation from the host page         |
| Abort Pattern       | `AbortController` for operation cancellation     |
| Message Passing     | Chrome extension messaging API between layers    |
| Keepalive Port      | Long-lived port to keep the Service Worker alive |
