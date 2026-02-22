# LLM News Sanitizer

A Chrome extension that filters manipulative and mentally draining content from news articles. It extracts the page text, runs it through an LLM, and overlays a clean version — stripped of emotional manipulation, clickbait, and unsubstantiated claims — right on top of the original page.

Works with **remote APIs** (OpenAI, Anthropic, Groq, etc.) and **local models** — anything that exposes an OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp server, etc.).

## How It Works

1. Click the extension icon on any news article.
2. The article text is extracted via Mozilla Readability.
3. The text is sent to the configured LLM with a prompt that detects manipulative techniques and produces a neutral summary.
4. The result streams into a modal overlay on top of the page.

The extension identifies clickbait, emotional pressure, fear-mongering, false urgency, leading questions, loaded framing, and unsubstantiated claims. The summary replaces doom-framing with actionable perspective.

## Features

- **Streaming output** — results appear as they are generated
- **Manipulation warnings** — names each technique detected with concrete examples
- **Verbosity control** — Short / Medium / Detailed summaries
- **Fact-checking** — optional web search integration to verify claims (marks facts as Verified / Unverified / Misleading / False)
- **Multi-language** — responds in English, Deutsch, Français, Español, Русский, 中文, 日本語, and more
- **Custom prompts** — adjust the analysis instructions to your needs
- **Shadow DOM modal** — isolated from the host page styles

## Installation

```bash
git clone git@github.com:LemToUp/llm-sanitizer.git
cd llm-sanitizer
npm install
npm run build
```

Then load the `dist/` folder as an unpacked extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

For development with hot-reload:

```bash
npm run dev
```

## Configuration

Open the extension settings: right-click the extension icon → **Options**, or go to `chrome://extensions` → LLM News Sanitizer → **Details** → **Extension options**.

### Using a remote API (OpenAI, Groq, etc.)

| Setting | Value |
|---------|-------|
| Provider | OpenAI-compatible (Agents SDK) |
| API URL | `https://api.openai.com/v1` (or your provider's URL) |
| API Key | Your API key |
| Model | `gpt-4o`, `claude-3-haiku`, etc. |

### Using a local model 

1. LM studio: https://lmstudio.ai/

2. Configure the extension:

| Setting | Value |
|---------|-------|
| Provider | OpenAI-compatible (Agents SDK) |
| API URL | `http://localhost:11434/v1` |
| API Key | *(leave empty)* |
| Model | `llama3.2` |

### Using a local model (LM Studio)

1. Install [LM Studio](https://lmstudio.ai), download a model, and start the local server.

2. Configure the extension:

| Setting | Value |
|---------|-------|
| Provider | OpenAI-compatible (Agents SDK) |
| API URL | `http://localhost:1234/v1` |
| API Key | *(leave empty)* |
| Model | *(the model loaded in LM Studio)* |

### Using Chrome Summarizer (Gemini Nano)

Select **Chrome Summarizer (Gemini Nano)** as the provider. No API URL or key required — the model runs on-device. Availability depends on Chrome version and hardware.

### Other settings

- **Context length** — maximum token window for the model. Leave empty to auto-detect from the API, or set manually to override.
- **Response language** — force the model to respond in a specific language regardless of the article's language. Defaults to your browser language.
- **Summarization context** — the system prompt that guides analysis. The default prompt focuses on manipulation detection and neutral summarization; edit it to fit your needs.

## License

GNU GPL v3
