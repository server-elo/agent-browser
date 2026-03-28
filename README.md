# Agent Browser

AI-powered browser automation. Tell the AI what to do in natural language, it controls Chrome using CDP.

80 tools covering: navigation, clicking, typing, scrolling, screenshots, accessibility tree, network interception, cookie management, file uploads, geolocation spoofing, stealth mode, PDF export, and more.

## Quick Start

```bash
# Install Bun (if needed)
curl -fsSL https://bun.sh/install | bash

# Clone
git clone https://github.com/server-elo/agent-browser.git
cd agent-browser

# Run with Ollama (free, local)
ollama serve  # start Ollama in another terminal
ollama pull llama3.1
bun run ai-browser.ts

# Run with LM Studio (free, local)
AI_API_BASE=http://localhost:1234/v1 AI_MODEL=local-model bun run ai-browser.ts

# Run with OpenAI
AI_API_KEY=sk-... AI_MODEL=gpt-4o bun run ai-browser.ts

# Run with Groq (free tier)
AI_API_KEY=gsk_... AI_API_BASE=https://api.groq.com/openai/v1 AI_MODEL=llama-3.3-70b-versatile bun run ai-browser.ts
```

## Usage

Chrome opens, then type what you want:

```
you> go to google and search for AI agents
you> click the first result
you> scroll down and take a screenshot
you> go to linkedin and send 5 connection requests
you> enable stealth mode
you> block all ads
you> save this page as PDF
you> set location to Berlin
you> quit
```

## How It Works

1. Opens Chrome with CDP (Chrome DevTools Protocol)
2. Sends your request to any OpenAI-compatible LLM
3. LLM decides which tools to call
4. Tools execute CDP commands against Chrome
5. Results go back to LLM for next step

## 80 Tools

### Navigation
`navigate`, `back`, `forward`, `reload`

### Mouse
`click`, `double_click`, `right_click`, `hover`, `drag`, `click_at`

### Keyboard
`type_text`, `press_key`, `hotkey`

### Scroll
`scroll`, `scroll_to_element`

### Text-Based Interaction
`click_text`, `find_by_text`, `click_nth`, `get_page_text`, `find_by_aria`

### DOM
`get_page_info`, `get_elements`, `get_element_info`, `get_form_fields`, `fill_form`, `select_option`, `check_checkbox`, `get_html`, `remove_element`

### Screenshots & PDF
`screenshot`, `save_pdf`

### Viewport & Emulation
`set_viewport`, `set_dark_mode`, `enable_touch`, `set_geolocation`

### Tabs
`list_tabs`, `new_tab`, `close_tab`, `switch_tab`, `close_all`

### Cookies & Storage
`get_cookies`, `set_cookie`, `clear_cookies`, `cdp_get_cookies`, `cdp_set_cookie`, `cdp_clear_cookies`, `get_storage`, `set_storage`

### Network
`block_urls`, `mock_response`, `set_request_headers`

### Console & Errors
`get_console_logs`, `get_page_errors`

### JavaScript
`evaluate_js`, `call_function_on`

### Wait
`wait`, `wait_for_element`, `wait_for_text`, `wait_for_navigation`

### Accessibility
`get_accessibility_tree`, `find_by_role`, `find_by_name`

### Automation
`enable_stealth`, `add_preload_script`, `inject_console_bridge`, `inject_script`, `auto_dismiss_dialogs`, `handle_dialog`

### Downloads & Uploads
`set_download_path`, `upload_file`

### Permissions
`grant_permissions`

### Native macOS
`native_click`, `native_type`, `native_key`, `native_hotkey`, `native_screenshot`

### Safari
`safari_open`, `safari_eval`, `safari_screenshot`, `safari_close`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_API_KEY` | (none) | API key (not needed for Ollama/LM Studio) |
| `AI_API_BASE` | `http://localhost:11434/v1` | LLM API endpoint |
| `AI_MODEL` | `llama3.1` | Model name |
| `BUN_CHROME_PATH` | (auto-detect) | Custom Chrome path |

## Requirements

- [Bun](https://bun.sh) runtime
- Chrome, Chromium, or Edge installed
- Any OpenAI-compatible LLM (Ollama, LM Studio, OpenAI, Groq, etc.)

## License

MIT
