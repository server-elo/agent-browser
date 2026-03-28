#!/usr/bin/env bun
/**
 * Agent Browser — AI-powered browser automation via CDP
 *
 * Works with any OpenAI-compatible LLM: Ollama, LM Studio, OpenAI, Anthropic, Groq, etc.
 *
 * Usage:
 *   # Ollama (free, local)
 *   AI_API_BASE=http://localhost:11434/v1 AI_MODEL=llama3.1 bun run ai-browser.ts
 *
 *   # LM Studio (free, local)
 *   AI_API_BASE=http://localhost:1234/v1 AI_MODEL=local-model bun run ai-browser.ts
 *
 *   # OpenAI
 *   AI_API_KEY=sk-... bun run ai-browser.ts
 *
 *   # Anthropic (via OpenAI-compatible proxy)
 *   AI_API_KEY=sk-ant-... AI_API_BASE=https://api.anthropic.com/v1 AI_MODEL=claude-sonnet-4-20250514 bun run ai-browser.ts
 *
 *   # Groq (free tier)
 *   AI_API_KEY=gsk_... AI_API_BASE=https://api.groq.com/openai/v1 AI_MODEL=llama-3.3-70b-versatile bun run ai-browser.ts
 *
 *   # Any OpenAI-compatible endpoint
 *   AI_API_KEY=your-key AI_API_BASE=https://your-endpoint/v1 AI_MODEL=your-model bun run ai-browser.ts
 *
 * Then just type what you want:
 *   > go to google and search for elo ai
 *   > click the first result
 *   > scroll down and take a screenshot
 *   > make 5 connections on linkedin
 *
 * @author Lorenc
 * @license MIT
 */

export {};

const API_KEY = process.env.AI_API_KEY || "";
const API_BASE = process.env.AI_API_BASE || "http://localhost:11434/v1";
const AI_MODEL = process.env.AI_MODEL || "llama3.1";

if (!API_KEY && !API_BASE.includes("localhost")) {
  console.log("Agent Browser — AI-powered browser automation\n");
  console.log("Set your LLM provider:\n");
  console.log("  # Ollama (free, local — default)");
  console.log("  ollama serve  # start Ollama first");
  console.log("  bun run ai-browser.ts\n");
  console.log("  # LM Studio (free, local)");
  console.log("  AI_API_BASE=http://localhost:1234/v1 AI_MODEL=local-model bun run ai-browser.ts\n");
  console.log("  # OpenAI");
  console.log("  AI_API_KEY=sk-... AI_MODEL=gpt-4o bun run ai-browser.ts\n");
  console.log("  # Groq (free)");
  console.log("  AI_API_KEY=gsk_... AI_API_BASE=https://api.groq.com/openai/v1 AI_MODEL=llama-3.3-70b-versatile bun run ai-browser.ts\n");
  process.exit(1);
}

// ============================================================================
// Chrome Launch
// ============================================================================

const CHROME_PATHS = [
  process.env.BUN_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean) as string[];

let chromePath: string | null = null;
for (const p of CHROME_PATHS) {
  if (await Bun.file(p).exists()) { chromePath = p; break; }
}
if (!chromePath) { console.log("Chrome not found."); process.exit(1); }

const port = 9222 + Math.floor(Math.random() * 1000);
const dataDir = `/tmp/bun-ai-browser-${process.pid}`;
const startUrl = process.argv[2] || "https://google.com";

console.log("Launching Chrome...");
const chrome = Bun.spawn([
  chromePath,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${dataDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--window-size=1280,800",
  startUrl,
], { stdout: "ignore", stderr: "ignore" });

await Bun.sleep(2500);

// ============================================================================
// CDP Connection
// ============================================================================

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()) as any;
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });

let msgId = 1;
let sessionId: string | null = null;
const pending = new Map<number, { resolve: Function; reject: Function }>();
const consoleLogs: { level: string; text: string; time: number }[] = [];
const pageErrors: { message: string; time: number }[] = [];
let currentUrl = "";
let pageLoaded = false;
let viewportWidth = 1280;
let viewportHeight = 800;
let safariSessionId: string | null = null;
let safariDriver: ReturnType<typeof Bun.spawn> | null = null;

ws.onmessage = (e) => {
  let msg: any;
  try { msg = JSON.parse(String(e.data)); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result ?? {});
  } else if (msg.method === "Runtime.consoleAPICalled") {
    // Binary (core_056.c FUN_10072466c) parses each arg by type: string/number/boolean/undefined/bigint/symbol
    const args = (msg.params?.args ?? []).map((a: any) => {
      switch (a.type) {
        case "string": return a.value;
        case "number": return String(a.value);
        case "boolean": return String(a.value);
        case "undefined": return "undefined";
        case "bigint": return a.description ?? a.unserializableValue ?? "bigint";
        case "symbol": return a.description ?? "Symbol()";
        default: return a.description ?? a.value ?? String(a.value ?? "");
      }
    }).join(" ");
    consoleLogs.push({ level: msg.params?.type ?? "log", text: args, time: Date.now() });
    if (consoleLogs.length > 200) consoleLogs.shift();
  } else if (msg.method === "Runtime.exceptionThrown") {
    pageErrors.push({ message: msg.params?.exceptionDetails?.text ?? "Unknown error", time: Date.now() });
  } else if (msg.method === "Page.frameNavigated") {
    // Track URL changes (01-cdp-session.c: extracts frame.url, updates stored URL)
    const url = msg.params?.frame?.url;
    if (url) currentUrl = url;
  } else if (msg.method === "Page.loadEventFired") {
    // Binary auto-evaluates "document.title" after load (core_056.c:8982)
    pageLoaded = true;
    // Fire-and-forget title extraction (binary uses returnByValue=true, no awaitPromise)
    const titleId = msgId++;
    const titleMsg: any = { id: titleId, method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } };
    if (sessionId) titleMsg.sessionId = sessionId;
    ws.send(JSON.stringify(titleMsg));
  } else if (msg.method === "Fetch.requestPaused") {
    // Handle blocked URLs and mocked responses
    const reqId = msg.params?.requestId;
    const reqUrl = msg.params?.request?.url ?? "";
    const mocks = (globalThis as any).__mockResponses ?? {};
    const blocks = (globalThis as any).__blockPatterns ?? [];
    const extraHeaders = (globalThis as any).__extraHeaders;
    // Check mocks first
    let handled = false;
    for (const [pattern, mock] of Object.entries(mocks) as any) {
      if (reqUrl.includes(pattern.replace(/\*/g, ""))) {
        const body = Buffer.from(mock.body).toString("base64");
        cdp("Fetch.fulfillRequest", { requestId: reqId, responseCode: mock.status,
          responseHeaders: [{ name: "Content-Type", value: mock.contentType }], body });
        handled = true; break;
      }
    }
    if (!handled && blocks.length > 0) {
      for (const p of blocks) {
        if (reqUrl.includes(p.replace(/\*/g, ""))) {
          cdp("Fetch.failRequest", { requestId: reqId, errorReason: "BlockedByClient" });
          handled = true; break;
        }
      }
    }
    if (!handled) {
      const headers = extraHeaders ? Object.entries(extraHeaders).map(([k, v]) => ({ name: k, value: v as string })) : undefined;
      cdp("Fetch.continueRequest", { requestId: reqId, headers });
    }
  } else if (msg.method === "Page.javascriptDialogOpening") {
    // Auto-handle dialogs if enabled
    console.log(`  [dialog] ${msg.params?.type}: "${msg.params?.message}"`);
  } else if (msg.method === "Target.detachedFromTarget") {
    // Tab crashed or closed (01-cdp-session.c: "page detached (crashed or closed)")
    const sid = msg.params?.sessionId;
    if (sid === sessionId) {
      console.log("  [event] Page detached (crashed or closed)");
      sessionId = null;
    }
  }
};

// Binary pending operation guards (project_map.json func_16094)
// "navigation already pending", "evaluate already pending", "screenshot already pending", "input operation already pending"
let pendingOperation: string | null = null;

async function cdp(method: string, params?: any): Promise<any> {
  const id = msgId++;
  const msg: any = { id, method };
  if (params) msg.params = params;
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, 15000);
  });
}

// Attach to page
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as any[];
const page = targets.find((t: any) => t.type === "page");
if (page) {
  const attach = await cdp("Target.attachToTarget", { targetId: page.id, flatten: true });
  sessionId = attach.sessionId;
  await cdp("Page.enable");
  await cdp("Runtime.enable");
}

// ============================================================================
// Browser Tools (what the LLM can call)
// ============================================================================

const tools = [
  // === Navigation (01-cdp-session.c: Page.navigate, Page.navigateToHistoryEntry, Page.reload) ===
  { name: "navigate", description: "Navigate to a URL", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "back", description: "Go back in browser history", input_schema: { type: "object", properties: {} } },
  { name: "forward", description: "Go forward in browser history", input_schema: { type: "object", properties: {} } },
  { name: "reload", description: "Reload the current page", input_schema: { type: "object", properties: {} } },

  // === Mouse (02-input-automation.c: Input.dispatchMouseEvent) ===
  { name: "click", description: "Click an element by CSS selector", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "double_click", description: "Double-click an element", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "right_click", description: "Right-click an element (context menu)", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "hover", description: "Move mouse over an element without clicking", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "drag", description: "Drag from one element to another", input_schema: { type: "object", properties: { from_selector: { type: "string" }, to_selector: { type: "string" } }, required: ["from_selector", "to_selector"] } },
  { name: "click_at", description: "Click at specific x,y coordinates on the page", input_schema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, button: { type: "string", enum: ["left", "right", "middle"] } }, required: ["x", "y"] } },

  // === Keyboard (02-input-automation.c: Input.dispatchKeyEvent, Input.insertText) ===
  { name: "type_text", description: "Click an element and type text into it (clears existing text first)", input_schema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" }, append: { type: "boolean", description: "If true, don't clear existing text" } }, required: ["selector", "text"] } },
  { name: "press_key", description: "Press a key (Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace, Delete, Space, etc)", input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "hotkey", description: "Press a key combination (e.g. Ctrl+A, Cmd+C, Ctrl+Shift+I)", input_schema: { type: "object", properties: { modifiers: { type: "array", items: { type: "string", enum: ["Control", "Alt", "Shift", "Meta"] } }, key: { type: "string" } }, required: ["modifiers", "key"] } },

  // === Scroll (02-input-automation.c: Input.dispatchMouseEvent mouseWheel) ===
  { name: "scroll", description: "Scroll the page up/down/left/right", input_schema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "number", description: "Pixels to scroll (default 400)" } }, required: ["direction"] } },
  { name: "scroll_to_element", description: "Scroll until a specific element is visible", input_schema: { type: "object", properties: { selector: { type: "string" }, block: { type: "string", enum: ["start", "center", "end", "nearest"] } }, required: ["selector"] } },

  // === Viewport (02-input-automation.c: Emulation.setDeviceMetricsOverride) ===
  { name: "set_viewport", description: "Set browser viewport size and device emulation", input_schema: { type: "object", properties: { width: { type: "number" }, height: { type: "number" }, device_scale: { type: "number", description: "Device pixel ratio (1, 2, 3)" }, mobile: { type: "boolean" } }, required: ["width", "height"] } },

  // === Screenshot (07-screenshot.c: Page.captureScreenshot) ===
  { name: "screenshot", description: "Take a screenshot and save to /tmp/", input_schema: { type: "object", properties: { name: { type: "string", description: "Filename without extension" }, full_page: { type: "boolean" } } } },

  // === DOM (05-dom-interaction.c: Runtime.evaluate with querySelector) ===
  { name: "get_page_info", description: "Get current page title, URL, and visible text content", input_schema: { type: "object", properties: { max_length: { type: "number", description: "Max text length (default 3000)" } } } },
  { name: "get_elements", description: "List interactive elements (links, buttons, inputs, selects) with CSS selectors", input_schema: { type: "object", properties: { limit: { type: "number", description: "Max elements (default 30)" }, filter: { type: "string", description: "CSS selector to filter (e.g. 'input', 'a', 'button')" } } } },
  { name: "get_element_info", description: "Get detailed info about a specific element (position, size, text, attributes)", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "get_form_fields", description: "List all form fields on the page with their current values", input_schema: { type: "object", properties: {} } },
  { name: "fill_form", description: "Fill multiple form fields at once", input_schema: { type: "object", properties: { fields: { type: "array", items: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } } } } }, required: ["fields"] } },
  { name: "select_option", description: "Select an option from a <select> dropdown", input_schema: { type: "object", properties: { selector: { type: "string" }, value: { type: "string", description: "Option value or visible text" } }, required: ["selector", "value"] } },
  { name: "check_checkbox", description: "Check or uncheck a checkbox", input_schema: { type: "object", properties: { selector: { type: "string" }, checked: { type: "boolean" } }, required: ["selector", "checked"] } },

  // === Text-based interaction (for sites with dynamic/obfuscated classes like LinkedIn) ===
  { name: "click_text", description: "Click a button, link, or element by its visible text content (exact or partial match)", input_schema: { type: "object", properties: { text: { type: "string", description: "Visible text to find and click" }, tag: { type: "string", description: "Optional tag filter: button, a, span, div (default: any)" }, index: { type: "number", description: "Which match to click if multiple (0-based, default 0)" } }, required: ["text"] } },
  { name: "find_by_text", description: "Find all elements containing specific text, returns their tag, text, position, and a unique index for clicking", input_schema: { type: "object", properties: { text: { type: "string", description: "Text to search for (case-insensitive partial match)" }, tag: { type: "string", description: "Optional tag filter" }, limit: { type: "number" } }, required: ["text"] } },
  { name: "click_nth", description: "Click the Nth element from a previous find_by_text or get_elements result by index", input_schema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] } },
  { name: "get_page_text", description: "Get all visible text on the page (useful for understanding page content)", input_schema: { type: "object", properties: { max_length: { type: "number" } } } },
  { name: "find_by_aria", description: "Find elements by aria-label, role, or placeholder text", input_schema: { type: "object", properties: { aria_label: { type: "string" }, role: { type: "string" }, placeholder: { type: "string" } } } },

  // === Tabs (02-input-automation.c: Target.createTarget, Target.closeTarget) ===
  { name: "list_tabs", description: "List all open browser tabs", input_schema: { type: "object", properties: {} } },
  { name: "new_tab", description: "Open a new tab (optionally with URL)", input_schema: { type: "object", properties: { url: { type: "string" } } } },
  { name: "close_tab", description: "Close current or specific tab", input_schema: { type: "object", properties: { index: { type: "number", description: "Tab index to close (default: current)" } } } },
  { name: "switch_tab", description: "Switch to a tab by index", input_schema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] } },

  // === Cookies (10-cookie-system.c) ===
  { name: "get_cookies", description: "Get all cookies for the current page", input_schema: { type: "object", properties: {} } },
  { name: "set_cookie", description: "Set a cookie", input_schema: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, domain: { type: "string" }, path: { type: "string" }, httpOnly: { type: "boolean" }, secure: { type: "boolean" } }, required: ["name", "value"] } },
  { name: "clear_cookies", description: "Clear all cookies", input_schema: { type: "object", properties: {} } },

  // === Storage ===
  { name: "get_storage", description: "Get localStorage or sessionStorage contents", input_schema: { type: "object", properties: { type: { type: "string", enum: ["local", "session"] }, key: { type: "string", description: "Specific key (omit for all)" } }, required: ["type"] } },
  { name: "set_storage", description: "Set a localStorage or sessionStorage value", input_schema: { type: "object", properties: { type: { type: "string", enum: ["local", "session"] }, key: { type: "string" }, value: { type: "string" } }, required: ["type", "key", "value"] } },

  // === Console & Network (08-cdp-events.c: Runtime.consoleAPICalled) ===
  { name: "get_console_logs", description: "Get captured console.log/warn/error messages from the page", input_schema: { type: "object", properties: { clear: { type: "boolean" } } } },
  { name: "get_page_errors", description: "Get JavaScript errors from the page", input_schema: { type: "object", properties: {} } },

  // === JavaScript (08-cdp-events.c: Runtime.evaluate, string_046.c: Runtime.callFunctionOn) ===
  { name: "evaluate_js", description: "Run JavaScript in the page and return the result", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "call_function_on", description: "Call a function on a specific remote object by ID (binary string_046.c:5750)", input_schema: { type: "object", properties: { code: { type: "string", description: "Function declaration string" }, objectId: { type: "string", description: "Remote object ID from a previous evaluate" } }, required: ["code", "objectId"] } },

  // === Wait (05-dom-interaction.c: actionability check) ===
  { name: "wait", description: "Wait for milliseconds", input_schema: { type: "object", properties: { ms: { type: "number" } }, required: ["ms"] } },
  { name: "wait_for_element", description: "Wait until an element appears on the page", input_schema: { type: "object", properties: { selector: { type: "string" }, timeout_ms: { type: "number", description: "Max wait (default 5000)" } }, required: ["selector"] } },
  { name: "wait_for_text", description: "Wait until specific text appears on the page", input_schema: { type: "object", properties: { text: { type: "string" }, timeout_ms: { type: "number" } }, required: ["text"] } },
  { name: "wait_for_navigation", description: "Wait for page navigation to complete", input_schema: { type: "object", properties: { timeout_ms: { type: "number" } } } },

  // === Native macOS (06-native-events.c: CGEvent mouse/keyboard via osascript) ===
  { name: "native_click", description: "Click at screen coordinates using macOS native mouse (works outside browser, any app)", input_schema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] } },
  { name: "native_type", description: "Type text using macOS native keyboard (works outside browser)", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "native_key", description: "Press a key using macOS native keyboard (return, tab, escape, space, delete)", input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "native_hotkey", description: "Press a keyboard shortcut using macOS native (e.g. command+c, command+v)", input_schema: { type: "object", properties: { modifier: { type: "string", enum: ["command", "control", "option", "shift"] }, key: { type: "string" } }, required: ["modifier", "key"] } },
  { name: "native_screenshot", description: "Take a macOS native screenshot (captures any app, not just browser)", input_schema: { type: "object", properties: { name: { type: "string" } } } },

  // === Safari WebDriver (12-safari-webautomation.c) ===
  { name: "safari_open", description: "Open a URL in Safari using WebDriver (requires safaridriver)", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "safari_eval", description: "Execute JavaScript in Safari", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "safari_screenshot", description: "Take a screenshot in Safari", input_schema: { type: "object", properties: {} } },
  { name: "safari_close", description: "Close the Safari WebDriver session", input_schema: { type: "object", properties: {} } },

  // === Inject scripts (09-hmr-reload.c, 14-devserver-scripts.c, 03-backend-config.c) ===
  { name: "inject_console_bridge", description: "Inject console.log/warn/error capture bridge into the page (03-backend-config.c pattern)", input_schema: { type: "object", properties: {} } },
  { name: "inject_script", description: "Inject a <script> tag into the page", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },

  // === WebView lifecycle (project_map.json func_16062, func_16094) ===
  { name: "close_all", description: "Close all browser tabs/targets (binary func_16062 closeAll)", input_schema: { type: "object", properties: {} } },

  // === ADVANCED CDP DOMAINS (not in binary but Chrome supports them) ===

  // Network interception (Fetch domain)
  { name: "block_urls", description: "Block requests matching URL patterns (ads, trackers, etc)", input_schema: { type: "object", properties: { patterns: { type: "array", items: { type: "string" }, description: "URL glob patterns to block, e.g. ['*://ads.*/*', '*.doubleclick.net/*']" } }, required: ["patterns"] } },
  { name: "mock_response", description: "Intercept a URL and return a fake response", input_schema: { type: "object", properties: { url_pattern: { type: "string" }, status: { type: "number" }, body: { type: "string" }, content_type: { type: "string" } }, required: ["url_pattern", "status", "body"] } },
  { name: "set_request_headers", description: "Add/modify headers on all outgoing requests", input_schema: { type: "object", properties: { headers: { type: "object", description: "Key-value header pairs, e.g. {Authorization: 'Bearer token'}" } }, required: ["headers"] } },

  // CDP Cookie API (proper HttpOnly support)
  { name: "cdp_get_cookies", description: "Get all cookies via CDP (includes HttpOnly cookies invisible to document.cookie)", input_schema: { type: "object", properties: { urls: { type: "array", items: { type: "string" } } } } },
  { name: "cdp_set_cookie", description: "Set a cookie via CDP (supports HttpOnly, Secure, SameSite)", input_schema: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, domain: { type: "string" }, path: { type: "string" }, httpOnly: { type: "boolean" }, secure: { type: "boolean" }, sameSite: { type: "string", enum: ["Strict", "Lax", "None"] }, expires: { type: "number", description: "Unix timestamp in seconds" } }, required: ["name", "value"] } },
  { name: "cdp_clear_cookies", description: "Clear ALL browser cookies via CDP", input_schema: { type: "object", properties: {} } },

  // Accessibility tree
  { name: "get_accessibility_tree", description: "Get the full accessibility tree (roles, names, descriptions — like a screen reader sees)", input_schema: { type: "object", properties: { depth: { type: "number", description: "Max depth (default 5)" } } } },
  { name: "find_by_role", description: "Find elements by ARIA role (button, link, textbox, heading, etc)", input_schema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] } },
  { name: "find_by_name", description: "Find elements by accessible name (what a screen reader would announce)", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },

  // PDF generation
  { name: "save_pdf", description: "Save the current page as a PDF file", input_schema: { type: "object", properties: { path: { type: "string" }, landscape: { type: "boolean" }, print_background: { type: "boolean" } } } },

  // Dialog handling
  { name: "handle_dialog", description: "Accept or dismiss JavaScript alert/confirm/prompt dialogs", input_schema: { type: "object", properties: { accept: { type: "boolean" }, prompt_text: { type: "string" } }, required: ["accept"] } },
  { name: "auto_dismiss_dialogs", description: "Automatically dismiss all future dialogs", input_schema: { type: "object", properties: {} } },

  // Download control
  { name: "set_download_path", description: "Set where downloads are saved (and allow them)", input_schema: { type: "object", properties: { path: { type: "string", description: "Absolute path to download directory" } }, required: ["path"] } },

  // Preload scripts (stealth mode, polyfills)
  { name: "add_preload_script", description: "Inject JavaScript that runs BEFORE every page load (stealth mode, polyfills, etc)", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "enable_stealth", description: "Hide automation detection (webdriver flag, chrome.runtime, etc)", input_schema: { type: "object", properties: {} } },

  // Permission management
  { name: "grant_permissions", description: "Grant browser permissions (camera, microphone, geolocation, clipboard, notifications)", input_schema: { type: "object", properties: { permissions: { type: "array", items: { type: "string" }, description: "e.g. ['geolocation', 'videoCapture', 'audioCapture', 'clipboardReadWrite', 'notifications']" }, origin: { type: "string" } }, required: ["permissions"] } },

  // File upload
  { name: "upload_file", description: "Set files on a file input element", input_schema: { type: "object", properties: { selector: { type: "string" }, files: { type: "array", items: { type: "string" }, description: "Array of absolute file paths" } }, required: ["selector", "files"] } },

  // Geolocation
  { name: "set_geolocation", description: "Spoof the device location", input_schema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" }, accuracy: { type: "number" } }, required: ["latitude", "longitude"] } },

  // Emulation
  { name: "set_dark_mode", description: "Enable/disable dark mode (prefers-color-scheme)", input_schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] } },
  { name: "enable_touch", description: "Enable touch emulation (mobile-like touch events)", input_schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] } },

  // DOM domain (direct CDP DOM access)
  { name: "get_html", description: "Get the HTML of an element via CDP DOM domain", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "remove_element", description: "Remove an element from the page", input_schema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
];

// ============================================================================
// HIGH-LEVEL click(selector) — io/io.c:748 pattern
// Combines scrollIntoView + actionability + mousePressed/Released in ONE call
// Default timeout: 30000ms (binary default)
// ============================================================================

async function highLevelClick(selector: string, timeout = 30000): Promise<[number, number] | null> {
  // Binary guards (io/io.c:783 + project_map func_16094)
  if (!selector) throw new Error("must not be empty");
  if (pendingOperation) throw new Error(`${pendingOperation} already pending`);
  pendingOperation = "click";
  try {
  const sel = selector.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const r = await cdp("Runtime.evaluate", {
    expression: `(async (sel, timeout) => {
// scrollIntoView first (io/io.c → network_001.c:7021)
const el0 = document.querySelector(sel);
if (el0) el0.scrollIntoView({ block: "center", behavior: "instant" });
// actionability check (io/io.c → network_001.c:6908)
const deadline = performance.now() + timeout;
let last;
for (;;) {
  const el = document.querySelector(sel);
  if (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      if (last && last.l === r.left && last.t === r.top && last.w === r.width && last.h === r.height) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) return [cx, cy];
      }
      last = { l: r.left, t: r.top, w: r.width, h: r.height };
    } else last = undefined;
  } else last = undefined;
  if (performance.now() > deadline) return null;
  await new Promise(f => requestAnimationFrame(f));
}
})("${sel}", ${timeout})`,
    returnByValue: true,
    awaitPromise: true,
  });
  const coords = r?.result?.value;
  if (!coords) { pendingOperation = null; return null; }
  const [cx, cy] = coords;
  // mousePressed fire-and-forget + mouseReleased await (core_056.c:8122-8148)
  cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1, modifiers: 0 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1, modifiers: 0 });
  pendingOperation = null;
  return [cx, cy];
  } finally { pendingOperation = null; }
}

// HIGH-LEVEL click by visible text — uses same pattern but finds by text first
async function highLevelClickText(text: string, tag = "*", index = 0): Promise<[number, number] | null> {
  const searchText = JSON.stringify(text.toLowerCase());
  const r = await cdp("Runtime.evaluate", {
    expression: `(()=>{
const search=${searchText};
const all=Array.from(document.querySelectorAll("${tag}")).filter(el=>{
  const r=el.getBoundingClientRect();
  if(r.width===0||r.height===0)return false;
  const t=(el.textContent||"").trim().toLowerCase();
  if(t.length>300||el.children.length>5)return false;
  return t===search||t.includes(search);
}).sort((a,b)=>{
  const at=(a.textContent||"").trim().toLowerCase();
  const bt=(b.textContent||"").trim().toLowerCase();
  if(at===search&&bt!==search)return -1;
  if(bt===search&&at!==search)return 1;
  return at.length-bt.length;
});
const el=all[${index}];
if(!el)return null;
el.scrollIntoView({block:"center",behavior:"instant"});
return true;
})()`,
    returnByValue: true,
  });
  if (!r?.result?.value) return null;

  // Now use actionability check on the scrolled-to element
  await Bun.sleep(300); // Let scroll settle
  const r2 = await cdp("Runtime.evaluate", {
    expression: `(async()=>{
const search=${searchText};
const all=Array.from(document.querySelectorAll("${tag}")).filter(el=>{
  const r=el.getBoundingClientRect();
  if(r.width===0||r.height===0)return false;
  const t=(el.textContent||"").trim().toLowerCase();
  if(t.length>300||el.children.length>5)return false;
  return t===search||t.includes(search);
}).sort((a,b)=>{
  const at=(a.textContent||"").trim().toLowerCase();
  const bt=(b.textContent||"").trim().toLowerCase();
  if(at===search&&bt!==search)return -1;
  if(bt===search&&at!==search)return 1;
  return at.length-bt.length;
});
const el=all[${index}];
if(!el)return null;
const deadline=performance.now()+5000;
let last;
for(;;){
  const r=el.getBoundingClientRect();
  const cx=r.left+r.width/2,cy=r.top+r.height/2;
  if(r.width>0&&r.height>0&&cx>=0&&cy>=0&&cx<innerWidth&&cy<innerHeight){
    if(last&&last.l===r.left&&last.t===r.top&&last.w===r.width&&last.h===r.height){
      const hit=document.elementFromPoint(cx,cy);
      if(hit===el||el.contains(hit))return {x:cx,y:cy,text:el.textContent.trim().slice(0,80),tag:el.tagName};
    }
    last={l:r.left,t:r.top,w:r.width,h:r.height};
  }else last=undefined;
  if(performance.now()>deadline)return null;
  await new Promise(f=>requestAnimationFrame(f));
}
})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  const v = r2?.result?.value;
  if (!v) return null;
  // mousePressed + mouseReleased
  cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: v.x, y: v.y, button: "left", clickCount: 1, modifiers: 0 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: v.x, y: v.y, button: "left", clickCount: 1, modifiers: 0 });
  return [v.x, v.y];
}

// Legacy findElement wrapper (uses highLevelClick pattern without clicking)
async function findElement(selector: string): Promise<{ x: number; y: number } | null> {
  const sel = selector.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const r = await cdp("Runtime.evaluate", {
    expression: `(async (sel, timeout) => {
const el0 = document.querySelector(sel);
if (el0) el0.scrollIntoView({ block: "center", behavior: "instant" });
const deadline = performance.now() + timeout;
let last;
for (;;) {
  const el = document.querySelector(sel);
  if (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      if (last && last.l === r.left && last.t === r.top && last.w === r.width && last.h === r.height) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) return { x: cx, y: cy };
      }
      last = { l: r.left, t: r.top, w: r.width, h: r.height };
    } else last = undefined;
  } else last = undefined;
  if (performance.now() > deadline) return null;
  await new Promise(f => requestAnimationFrame(f));
}
})("${sel}", 5000)`,
    returnByValue: true,
    awaitPromise: true,
  });
  return r?.result?.value ?? null;
}

// Helper: escape selector for use in JS template
function esc(sel: string) { return sel.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$"); }

// Helper: click at coords
async function clickAt(x: number, y: number, button = "left", clickCount = 1) {
  // Binary: mousePressed is FIRE-AND-FORGET (FUN_1007229f0), mouseReleased is AWAITED (FUN_1007274fc)
  cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount, modifiers: 0 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount, modifiers: 0 });
}

// Key code lookup
const KEY_MAP: Record<string, number> = {
  Enter: 13, Tab: 9, Escape: 27, Space: 32, Backspace: 8, Delete: 46,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
  F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

const MOD_MAP: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

async function executeTool(name: string, input: any): Promise<string> {
  switch (name) {

    // === Navigation ===
    case "navigate": {
      // Binary guards: "navigation already pending" + "invalid URL" (project_map func_16082)
      if (pendingOperation) return `${pendingOperation} already pending`;
      let url = input.url;
      if (!url.includes("://") && !url.startsWith("data:")) url = "https://" + url;
      try { new URL(url); } catch { return `invalid URL: ${url}`; }
      pendingOperation = "navigation";
      try {
        const navResult = await cdp("Page.navigate", { url });
        // Binary checks errorText in state 5 (core_056.c:7754)
        if (navResult?.errorText) return `Navigation error: ${navResult.errorText}`;
        await Bun.sleep(2000);
        const r = await cdp("Runtime.evaluate", { expression: "JSON.stringify({title:document.title,url:location.href})", returnByValue: true });
        return `Navigated to: ${r?.result?.value}`;
      } finally { pendingOperation = null; }
    }
    case "back": {
      const h = await cdp("Page.getNavigationHistory");
      if (h?.currentIndex > 0) { await cdp("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id }); await Bun.sleep(1000); return "Went back"; }
      return "No history";
    }
    case "forward": {
      const h = await cdp("Page.getNavigationHistory");
      if (h?.currentIndex < h?.entries?.length - 1) { await cdp("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex + 1].id }); await Bun.sleep(1000); return "Went forward"; }
      return "No forward history";
    }
    case "reload": { await cdp("Page.reload"); await Bun.sleep(1500); return "Reloaded"; }

    // === Mouse (using high-level click from io/io.c:748) ===
    case "click": {
      const coords = await highLevelClick(input.selector);
      if (!coords) return `Element not found or not actionable: ${input.selector}`;
      return `Clicked ${input.selector} at (${coords[0].toFixed(0)}, ${coords[1].toFixed(0)})`;
    }
    case "double_click": {
      const c = await findElement(input.selector);
      if (!c) return `Element not found: ${input.selector}`;
      await clickAt(c.x, c.y, "left", 2); await Bun.sleep(500);
      return `Double-clicked ${input.selector}`;
    }
    case "right_click": {
      const c = await findElement(input.selector);
      if (!c) return `Element not found: ${input.selector}`;
      await clickAt(c.x, c.y, "right"); await Bun.sleep(500);
      return `Right-clicked ${input.selector}`;
    }
    case "hover": {
      const c = await findElement(input.selector);
      if (!c) return `Element not found: ${input.selector}`;
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
      return `Hovered over ${input.selector}`;
    }
    case "drag": {
      const from = await findElement(input.from_selector);
      const to = await findElement(input.to_selector);
      if (!from) return `From element not found: ${input.from_selector}`;
      if (!to) return `To element not found: ${input.to_selector}`;
      // Binary: mousePressed is fire-and-forget (FUN_1007229f0)
      cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= 10; i++) {
        const x = from.x + (to.x - from.x) * i / 10;
        const y = from.y + (to.y - from.y) * i / 10;
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left" });
      }
      await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left" });
      return `Dragged from ${input.from_selector} to ${input.to_selector}`;
    }
    case "click_at": {
      await clickAt(input.x, input.y, input.button || "left");
      return `Clicked at (${input.x}, ${input.y})`;
    }

    // === Keyboard ===
    case "type_text": {
      // High-level: click element first (io/io.c:748 pattern), then type (string_006.c:21860 pattern)
      const coords = await highLevelClick(input.selector);
      if (!coords) return `Element not found: ${input.selector}`;
      await Bun.sleep(200);
      if (!input.append) {
        await cdp("Runtime.evaluate", { expression: `document.querySelector("${esc(input.selector)}").value = ""` }).catch(() => {});
      }
      // Binary type(text) — string_006.c:21860 → Input.insertText
      await cdp("Input.insertText", { text: input.text });
      return `Typed "${input.text}" into ${input.selector}`;
    }
    case "press_key": {
      const key = input.key;
      const code = KEY_MAP[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, windowsVirtualKeyCode: code });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
      await Bun.sleep(300);
      return `Pressed ${key}`;
    }
    case "hotkey": {
      const modBits = (input.modifiers as string[]).reduce((a: number, m: string) => a | (MOD_MAP[m] || 0), 0);
      const code = KEY_MAP[input.key] ?? (input.key.length === 1 ? input.key.toUpperCase().charCodeAt(0) : 0);
      await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: input.key, windowsVirtualKeyCode: code, modifiers: modBits });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: input.key, windowsVirtualKeyCode: code, modifiers: modBits });
      return `Pressed ${input.modifiers.join("+")}+${input.key}`;
    }

    // === Scroll ===
    case "scroll": {
      const dx = input.direction === "left" ? -(input.amount || 400) : input.direction === "right" ? (input.amount || 400) : 0;
      const dy = input.direction === "up" ? -(input.amount || 400) : input.direction === "down" ? (input.amount || 400) : 0;
      // Binary pattern: scroll at viewport center (rust_core_000.c:5264 — reads width/height from browser state at +0x20/+0x24)
      // We read actual viewport from page to match, since user might have resized window
      const vp = await cdp("Runtime.evaluate", { expression: "JSON.stringify({w:innerWidth,h:innerHeight})", returnByValue: true });
      let cx = Math.round(viewportWidth / 2);
      let cy = Math.round(viewportHeight / 2);
      try {
        const parsed = JSON.parse(vp?.result?.value);
        cx = Math.round(parsed.w / 2);
        cy = Math.round(parsed.h / 2);
        viewportWidth = parsed.w;
        viewportHeight = parsed.h;
      } catch {}
      await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: dx, deltaY: dy });
      return `Scrolled ${input.direction} ${Math.abs(dx || dy)}px at center (${cx},${cy})`;
    }
    case "scroll_to_element": {
      // Binary scrollTo(selector) — io/io.c:920 pattern (polls until element found, then scrolls)
      const block = input.block || "center";
      const sel = input.selector.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await cdp("Runtime.evaluate", {
        expression: `(async (sel, timeout, block) => {
const deadline = performance.now() + timeout;
for (;;) {
  const el = document.querySelector(sel);
  if (el) { el.scrollIntoView({ block, behavior: "instant" }); return; }
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "'";
  await new Promise(f => requestAnimationFrame(f));
}
})("${sel}", 5000, "${block}")`,
        returnByValue: true,
        awaitPromise: true,
      });
      return `Scrolled to ${input.selector} (${block})`;
    }

    // === Viewport ===
    case "set_viewport": {
      // Binary pattern: always sends all 4 params (rust_core_000.c:5324-5328)
      viewportWidth = input.width;
      viewportHeight = input.height;
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: input.width, height: input.height,
        deviceScaleFactor: input.device_scale || 1,
        mobile: input.mobile || false,
      });
      return `Viewport set to ${input.width}x${input.height} (scale: ${input.device_scale || 1}, mobile: ${input.mobile || false})`;
    }

    // === Screenshot ===
    case "screenshot": {
      const r = await cdp("Page.captureScreenshot", { format: "png" });
      if (r?.data) {
        const fname = input.name || `screenshot-${Date.now()}`;
        const path = `/tmp/${fname}.png`;
        await Bun.write(path, Buffer.from(r.data, "base64"));
        return `Screenshot saved: ${path}`;
      }
      return "Screenshot failed";
    }

    // === DOM ===
    case "get_page_info": {
      const max = input.max_length || 3000;
      const r = await cdp("Runtime.evaluate", {
        expression: `JSON.stringify({title:document.title,url:location.href,text:(document.body?.innerText?.slice(0,${max})||"")})`,
        returnByValue: true,
      });
      return r?.result?.value ?? "Could not get page info";
    }
    case "get_elements": {
      const limit = input.limit || 30;
      const filter = input.filter || 'a,button,input,textarea,select,[role="button"],[role="link"],[onclick],[href]';
      const r = await cdp("Runtime.evaluate", {
        expression: `JSON.stringify((() => {
          const els=[];
          document.querySelectorAll('${filter}').forEach((el,i)=>{
            if(i>=${limit})return;
            const r=el.getBoundingClientRect();
            if(r.width===0||r.height===0)return;
            const tag=el.tagName.toLowerCase();
            const text=(el.textContent||el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('value')||'').trim().slice(0,80);
            const id=el.id?'#'+el.id:'';
            const nm=el.getAttribute('name')?'[name="'+el.getAttribute('name')+'"]':'';
            const tp=el.getAttribute('type')?'[type="'+el.getAttribute('type')+'"]':'';
            const href=el.getAttribute('href')?.slice(0,60)||'';
            let sel=tag+id+nm+tp;
            if(!id&&!nm){const cls=Array.from(el.classList).slice(0,2).map(c=>'.'+c).join('');sel=tag+cls+tp;}
            els.push({selector:sel,text,tag,href,x:Math.round(r.x),y:Math.round(r.y)});
          });
          return els;
        })())`,
        returnByValue: true,
      });
      return r?.result?.value ?? "Could not list elements";
    }
    case "get_element_info": {
      const r = await cdp("Runtime.evaluate", {
        expression: `JSON.stringify((() => {
          const el=document.querySelector(\`${esc(input.selector)}\`);
          if(!el)return null;
          const r=el.getBoundingClientRect();
          return {tag:el.tagName,id:el.id,classes:el.className,text:el.textContent?.slice(0,200),value:el.value,
            x:r.x,y:r.y,width:r.width,height:r.height,visible:r.width>0&&r.height>0,
            attrs:Object.fromEntries(Array.from(el.attributes).map(a=>[a.name,a.value?.slice(0,100)]))};
        })())`,
        returnByValue: true,
      });
      const v = r?.result?.value;
      return v ? (typeof v === "string" ? v : JSON.stringify(v)) : `Not found: ${input.selector}`;
    }
    case "get_form_fields": {
      const r = await cdp("Runtime.evaluate", {
        expression: `JSON.stringify(Array.from(document.querySelectorAll('input,textarea,select')).map(el=>{
          const r=el.getBoundingClientRect();
          return {tag:el.tagName.toLowerCase(),type:el.type,name:el.name,id:el.id,value:el.value?.slice(0,100),
            placeholder:el.placeholder,selector:el.id?'#'+el.id:el.name?'[name="'+el.name+'"]':el.tagName.toLowerCase(),
            x:Math.round(r.x),y:Math.round(r.y),visible:r.width>0&&r.height>0};
        }))`,
        returnByValue: true,
      });
      return r?.result?.value ?? "No form fields";
    }
    case "fill_form": {
      const results: string[] = [];
      for (const field of input.fields) {
        const c = await findElement(field.selector);
        if (!c) { results.push(`Not found: ${field.selector}`); continue; }
        await clickAt(c.x, c.y); await Bun.sleep(100);
        await cdp("Runtime.evaluate", { expression: `document.querySelector(\`${esc(field.selector)}\`).value=""` });
        await cdp("Input.insertText", { text: field.value });
        results.push(`${field.selector} = "${field.value}"`);
      }
      return `Filled: ${results.join(", ")}`;
    }
    case "select_option": {
      const selVal = input.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await cdp("Runtime.evaluate", {
        expression: `(()=>{const s=document.querySelector(\`${esc(input.selector)}\`);if(!s||!s.options)return 'not a select';
          for(const o of s.options){if(o.value==='${selVal}'||o.textContent.trim()==='${selVal}'){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return 'ok';}}return 'option not found'})()`,
        returnByValue: true,
      });
      return `Selected "${input.value}" in ${input.selector}`;
    }
    case "check_checkbox": {
      await cdp("Runtime.evaluate", {
        expression: `(()=>{const el=document.querySelector(\`${esc(input.selector)}\`);if(el){el.checked=${input.checked};el.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return `${input.checked ? "Checked" : "Unchecked"} ${input.selector}`;
    }

    // === Tabs ===
    case "list_tabs": {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as any[];
      return JSON.stringify(tabs.map((t: any, i: number) => ({ index: i, title: t.title, url: t.url, id: t.id })));
    }
    case "new_tab": {
      // Binary pattern: Target.createTarget with about:blank + newWindow=true + width/height (rust_core_000.c:4719-4724)
      const r = await cdp("Target.createTarget", { url: "about:blank", newWindow: true, width: viewportWidth, height: viewportHeight });
      if (input.url) {
        // Then navigate separately (binary does this as a second step: rust_core_000.c:4738)
        const attach = await cdp("Target.attachToTarget", { targetId: r.targetId, flatten: true });
        sessionId = attach.sessionId;
        await cdp("Page.enable"); await cdp("Runtime.enable");
        let url = input.url;
        if (!url.includes("://") && !url.startsWith("data:")) url = "https://" + url;
        await cdp("Page.navigate", { url });
        await Bun.sleep(1500);
      }
      return `New tab opened: ${r?.targetId}${input.url ? ` → ${input.url}` : ""}`;
    }
    case "close_tab": {
      if (input.index !== undefined) {
        const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as any[];
        if (tabs[input.index]) {
          await cdp("Target.closeTarget", { targetId: tabs[input.index].id });
          return `Closed tab ${input.index}`;
        }
        return `Tab ${input.index} not found`;
      }
      if (page?.id) { await cdp("Target.closeTarget", { targetId: page.id }); return "Closed current tab"; }
      return "No tab to close";
    }
    case "switch_tab": {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as any[];
      if (tabs[input.index]) {
        const t = tabs[input.index];
        const attach = await cdp("Target.attachToTarget", { targetId: t.id, flatten: true });
        sessionId = attach.sessionId;
        await cdp("Page.enable"); await cdp("Runtime.enable");
        return `Switched to tab ${input.index}: ${t.title}`;
      }
      return `Tab ${input.index} not found`;
    }

    // === Cookies ===
    case "get_cookies": {
      const r = await cdp("Runtime.evaluate", { expression: "document.cookie", returnByValue: true });
      return `Cookies: ${r?.result?.value || "(none)"}`;
    }
    case "set_cookie": {
      let expr = `document.cookie="${input.name}=${input.value}`;
      if (input.path) expr += `;path=${input.path}`;
      if (input.domain) expr += `;domain=${input.domain}`;
      if (input.secure) expr += `;secure`;
      if (input.httpOnly) expr += `;httpOnly`;
      expr += `"`;
      await cdp("Runtime.evaluate", { expression: expr });
      return `Cookie set: ${input.name}=${input.value}`;
    }
    case "clear_cookies": {
      await cdp("Runtime.evaluate", {
        expression: `document.cookie.split(";").forEach(c=>{document.cookie=c.trim().split("=")[0]+"=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"})`,
      });
      return "Cookies cleared";
    }

    // === Storage ===
    case "get_storage": {
      const store = input.type === "session" ? "sessionStorage" : "localStorage";
      if (input.key) {
        const r = await cdp("Runtime.evaluate", { expression: `${store}.getItem("${esc(input.key)}")`, returnByValue: true });
        return `${store}["${input.key}"] = ${JSON.stringify(r?.result?.value)}`;
      }
      const r = await cdp("Runtime.evaluate", { expression: `JSON.stringify((()=>{const o={};for(let i=0;i<${store}.length;i++){const k=${store}.key(i);o[k]=${store}.getItem(k);}return o})())`, returnByValue: true });
      return r?.result?.value ?? `${store} is empty`;
    }
    case "set_storage": {
      const store = input.type === "session" ? "sessionStorage" : "localStorage";
      await cdp("Runtime.evaluate", { expression: `${store}.setItem("${esc(input.key)}","${esc(input.value)}")` });
      return `${store}["${input.key}"] = "${input.value}"`;
    }

    // === Console & Errors ===
    case "get_console_logs": {
      const logs = [...consoleLogs];
      if (input.clear) consoleLogs.length = 0;
      return logs.length > 0 ? JSON.stringify(logs) : "No console logs captured";
    }
    case "get_page_errors": {
      return pageErrors.length > 0 ? JSON.stringify(pageErrors) : "No page errors";
    }

    // === JavaScript ===
    case "evaluate_js": {
      // Binary pattern math_000.c:10740 — wraps in async IIFE to ensure await works
      // Also includes generatePreview (binary string_046.c:3532) for rich object inspection
      const wrapped = `(async()=>{return await (${input.code})})()`;
      const r = await cdp("Runtime.evaluate", {
        expression: wrapped,
        returnByValue: true,
        awaitPromise: true,
        generatePreview: true, // binary string_046.c:3532
      });
      if (r?.exceptionDetails) return `Error: ${r.exceptionDetails.text}`;
      return JSON.stringify(r?.result?.value ?? r?.result ?? null);
    }

    // Runtime.callFunctionOn — binary string_046.c:5750
    // Calls a function on a specific remote object (element, etc)
    case "call_function_on": {
      const r = await cdp("Runtime.callFunctionOn", {
        functionDeclaration: input.code,
        objectId: input.objectId,
        returnByValue: true,
        awaitPromise: true,
        generatePreview: true,
      });
      if (r?.exceptionDetails) return `Error: ${r.exceptionDetails.text}`;
      return JSON.stringify(r?.result?.value ?? r?.result ?? null);
    }

    // === Wait ===
    case "wait": { await Bun.sleep(input.ms); return `Waited ${input.ms}ms`; }
    case "wait_for_element": {
      const timeout = input.timeout_ms || 5000;
      const r = await cdp("Runtime.evaluate", {
        expression: `(async()=>{const d=performance.now()+${timeout};for(;;){if(document.querySelector(\`${esc(input.selector)}\`))return true;if(performance.now()>d)return false;await new Promise(f=>requestAnimationFrame(f))}})()`,
        returnByValue: true, awaitPromise: true,
      });
      return r?.result?.value ? `Element found: ${input.selector}` : `Timeout: ${input.selector} not found after ${timeout}ms`;
    }
    case "wait_for_text": {
      const timeout = input.timeout_ms || 5000;
      const r = await cdp("Runtime.evaluate", {
        expression: `(async()=>{const d=performance.now()+${timeout};for(;;){if(document.body?.innerText?.includes(\`${esc(input.text)}\`))return true;if(performance.now()>d)return false;await new Promise(f=>setTimeout(f,200))}})()`,
        returnByValue: true, awaitPromise: true,
      });
      return r?.result?.value ? `Text found: "${input.text}"` : `Timeout: text "${input.text}" not found`;
    }
    case "wait_for_navigation": {
      await Bun.sleep(input.timeout_ms || 3000);
      const r = await cdp("Runtime.evaluate", { expression: "JSON.stringify({title:document.title,url:location.href})", returnByValue: true });
      return `Page: ${r?.result?.value}`;
    }

    // === Text-based interaction ===
    case "click_text": {
      // High-level click by text — uses io/io.c:748 pattern (scroll + actionability + click)
      const coords = await highLevelClickText(input.text, input.tag || "*", input.index || 0);
      if (!coords) return `No element found with text "${input.text}"${input.tag ? ` (tag: ${input.tag})` : ""}`;
      return `Clicked text "${input.text}" at (${coords[0].toFixed(0)}, ${coords[1].toFixed(0)})`;
    }

    case "find_by_text": {
      const tag = input.tag || "*";
      const limit = input.limit || 20;
      const searchText2 = JSON.stringify(input.text.toLowerCase());
      const r = await cdp("Runtime.evaluate", {
        expression: `JSON.stringify((()=>{
          const search=${searchText2};
          const results=[];
          document.querySelectorAll("${tag}").forEach((el)=>{
            if(results.length>=${limit})return;
            const r=el.getBoundingClientRect();
            if(r.width===0||r.height===0)return;
            const t=(el.textContent||"").trim();
            if(!t.toLowerCase().includes(search))return;
            // Skip large containers — only match leaf/small elements
            if(t.length>300||el.children.length>5)return;
            // Skip if a child element has the same text (prefer the child)
            const childMatch=Array.from(el.children).some(c=>(c.textContent||"").trim().toLowerCase().includes(search));
            if(childMatch&&el.tagName!=="BUTTON"&&el.tagName!=="A")return;
            results.push({index:results.length,tag:el.tagName.toLowerCase(),text:t.slice(0,100),
              x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
              aria:el.getAttribute("aria-label")||"",role:el.getAttribute("role")||""});
          });
          return results;
        })())`,
        returnByValue: true,
      });
      return r?.result?.value ?? `No elements found with text "${input.text}"`;
    }

    case "click_nth": {
      // Click the Nth interactive element (button, link, input) visible on the page
      // Filters to small/leaf elements only, sorted by vertical position
      const r = await cdp("Runtime.evaluate", {
        expression: `(()=>{
          const all=Array.from(document.querySelectorAll("button,a,[role='button'],[role='link'],input[type='submit']")).filter(el=>{
            const r=el.getBoundingClientRect();
            return r.width>0&&r.height>0&&r.top>=0&&r.top<innerHeight;
          }).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
          const el=all[${input.index}];
          if(!el)return null;
          el.scrollIntoView({block:"center",behavior:"instant"});
          const r=el.getBoundingClientRect();
          return {x:r.left+r.width/2,y:r.top+r.height/2,text:(el.textContent||"").trim().slice(0,80),tag:el.tagName};
        })()`,
        returnByValue: true,
      });
      const v = r?.result?.value;
      if (!v) return `Element at index ${input.index} not found`;
      await clickAt(v.x, v.y); await Bun.sleep(500);
      return `Clicked <${v.tag}> #${input.index}: "${v.text}" at (${v.x.toFixed(0)}, ${v.y.toFixed(0)})`;
    }

    case "get_page_text": {
      const max = input.max_length || 5000;
      const r = await cdp("Runtime.evaluate", {
        expression: `document.body?.innerText?.slice(0,${max})||""`,
        returnByValue: true,
      });
      return r?.result?.value ?? "";
    }

    case "find_by_aria": {
      let selector = "*";
      if (input.aria_label) selector = `[aria-label*="${esc(input.aria_label)}"]`;
      else if (input.role) selector = `[role="${esc(input.role)}"]`;
      else if (input.placeholder) selector = `[placeholder*="${esc(input.placeholder)}"]`;

      const r = await cdp("Runtime.evaluate", {
        expression: `JSON.stringify(Array.from(document.querySelectorAll('${selector}')).slice(0,20).map((el,i)=>{
          const r=el.getBoundingClientRect();
          return {index:i,tag:el.tagName.toLowerCase(),text:(el.textContent||"").trim().slice(0,80),
            aria:el.getAttribute("aria-label")||"",role:el.getAttribute("role")||"",
            placeholder:el.getAttribute("placeholder")||"",
            x:Math.round(r.x),y:Math.round(r.y),visible:r.width>0&&r.height>0};
        }))`,
        returnByValue: true,
      });
      return r?.result?.value ?? "No elements found";
    }

    // === Native macOS (06-native-events.c: CGEvent via osascript/cliclick) ===
    case "native_click": {
      // Binary uses CGEventCreateScrollWheelEvent + CGEventSetLocation (file_003.c:1385-1386)
      // We use cliclick or AppleScript as fallback (same as elo computer-use extension)
      const cliclickResult = Bun.spawnSync(["which", "cliclick"]);
      if (cliclickResult.exitCode === 0) {
        Bun.spawnSync(["cliclick", `c:${Math.round(input.x)},${Math.round(input.y)}`]);
        return `Native clicked at (${input.x}, ${input.y})`;
      }
      // Fallback to AppleScript
      Bun.spawnSync(["osascript", "-e",
        `tell application "System Events" to click at {${Math.round(input.x)}, ${Math.round(input.y)}}`]);
      return `Native clicked at (${input.x}, ${input.y}) via AppleScript`;
    }
    case "native_type": {
      // Binary uses CGEvent keyboardSetUnicodeString (mouse-keyboard.ts pattern)
      const hasCli = Bun.spawnSync(["which", "cliclick"]).exitCode === 0;
      if (hasCli) {
        Bun.spawnSync(["cliclick", `t:${input.text}`]);
        return `Native typed: "${input.text}"`;
      }
      const escaped = input.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      Bun.spawnSync(["osascript", "-e", `tell application "System Events" to keystroke "${escaped}"`]);
      return `Native typed: "${input.text}" via AppleScript`;
    }
    case "native_key": {
      // Binary uses CGEvent with key codes (mouse-keyboard.ts KEY_CODES map)
      // AppleScript key code requires numeric codes
      const keyCodeMap: Record<string, number> = {
        return: 36, enter: 36, tab: 48, escape: 53, space: 49,
        delete: 51, backspace: 51, forwarddelete: 117,
        up: 126, down: 125, left: 123, right: 124,
        home: 115, end: 119, pageup: 116, pagedown: 121,
        f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
        f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
      };
      const code = keyCodeMap[input.key.toLowerCase()];
      if (code !== undefined) {
        Bun.spawnSync(["osascript", "-e", `tell application "System Events" to key code ${code}`]);
      } else {
        Bun.spawnSync(["osascript", "-e", `tell application "System Events" to keystroke "${input.key}"`]);
      }
      return `Native pressed: ${input.key}`;
    }
    case "native_hotkey": {
      // Binary uses CGEvent with modifier flags (MODIFIERS map: shift=0x20000, control=0x10000, option=0x80000, command=0x1000)
      const mod = input.modifier.toLowerCase();
      const key = input.key.toLowerCase();
      const modMap: Record<string, string> = { command: "command", control: "control", option: "option", shift: "shift" };
      const m = modMap[mod] || mod;
      Bun.spawnSync(["osascript", "-e", `tell application "System Events" to keystroke "${key}" using ${m} down`]);
      return `Native hotkey: ${mod}+${key}`;
    }
    case "native_screenshot": {
      // Binary uses /usr/bin/screencapture (screenshot.ts:18)
      const name = input.name || `native-screenshot-${Date.now()}`;
      const path = `/tmp/${name}.png`;
      Bun.spawnSync(["screencapture", "-x", path]);
      return `Native screenshot saved: ${path}`;
    }

    // === Safari WebDriver (12-safari-webautomation.c) ===
    case "safari_open": {
      // Binary speaks Apple's _WDAutomationSession XPC protocol directly
      // We use safaridriver HTTP (W3C WebDriver) as the user-accessible equivalent
      if (!safariSessionId) {
        // Start safaridriver if not running
        safariDriver = Bun.spawn(["safaridriver", "-p", "4444"], { stdout: "ignore", stderr: "ignore" });
        await Bun.sleep(2000);
        // Create session
        const resp = await fetch("http://127.0.0.1:4444/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: "safari" } } }),
        });
        const data = await resp.json() as any;
        safariSessionId = data.value?.sessionId;
        if (!safariSessionId) return `Safari session failed: ${JSON.stringify(data)}`;
      }
      // Navigate
      await fetch(`http://127.0.0.1:4444/session/${safariSessionId}/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input.url.includes("://") ? input.url : "https://" + input.url }),
      });
      await Bun.sleep(1500);
      const titleResp = await fetch(`http://127.0.0.1:4444/session/${safariSessionId}/title`);
      const titleData = await titleResp.json() as any;
      return `Safari opened: ${titleData.value} — ${input.url}`;
    }
    case "safari_eval": {
      if (!safariSessionId) return "Safari not open. Use safari_open first.";
      const resp = await fetch(`http://127.0.0.1:4444/session/${safariSessionId}/execute/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: input.code, args: [] }),
      });
      const data = await resp.json() as any;
      return JSON.stringify(data.value);
    }
    case "safari_screenshot": {
      if (!safariSessionId) return "Safari not open.";
      const resp = await fetch(`http://127.0.0.1:4444/session/${safariSessionId}/screenshot`);
      const data = await resp.json() as any;
      if (data.value) {
        const path = `/tmp/safari-screenshot-${Date.now()}.png`;
        await Bun.write(path, Buffer.from(data.value, "base64"));
        return `Safari screenshot saved: ${path}`;
      }
      return "Safari screenshot failed";
    }
    case "safari_close": {
      if (safariSessionId) {
        await fetch(`http://127.0.0.1:4444/session/${safariSessionId}`, { method: "DELETE" }).catch(() => {});
        safariSessionId = null;
      }
      if (safariDriver) { safariDriver.kill(); safariDriver = null; }
      return "Safari session closed";
    }

    // === Inject scripts (03-backend-config.c, 09-hmr-reload.c, 14-devserver-scripts.c) ===
    case "inject_console_bridge": {
      // Exact script from binary (core_057.c:7026) — bunConsole messageHandler adapted for CDP
      await cdp("Runtime.evaluate", {
        expression: `(() => {
          if (window.__eloBridgeInstalled) return;
          window.__eloBridgeInstalled = true;
          const originals = {};
          for (const t of ['log','warn','error','info','debug','trace','dir']) {
            originals[t] = console[t];
            console[t] = (...args) => {
              window.__eloConsoleLogs = window.__eloConsoleLogs || [];
              window.__eloConsoleLogs.push({type: t, args: args.map(x => {
                try { return JSON.stringify(x) ?? String(x) } catch { return String(x) }
              }), time: Date.now()});
              if (window.__eloConsoleLogs.length > 200) window.__eloConsoleLogs.shift();
              return originals[t].apply(console, args);
            };
          }
        })()`,
      });
      return "Console bridge injected (captures log/warn/error/info/debug/trace/dir)";
    }
    case "inject_script": {
      await cdp("Runtime.evaluate", {
        expression: `(() => {
          const s = document.createElement('script');
          s.textContent = ${JSON.stringify(input.code)};
          document.head.appendChild(s);
        })()`,
      });
      return "Script injected";
    }

    // === WebView lifecycle (project_map.json func_16062) ===
    case "close_all": {
      // Binary closeAll() closes all targets
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as any[];
      let closed = 0;
      for (const t of tabs) {
        if (t.type === "page") {
          try { await cdp("Target.closeTarget", { targetId: t.id }); closed++; } catch {}
        }
      }
      sessionId = null;
      return `Closed ${closed} tabs`;
    }

    // === ADVANCED CDP DOMAINS ===

    // Network interception
    case "block_urls": {
      await cdp("Fetch.enable", { patterns: input.patterns.map((p: string) => ({ urlPattern: p, requestStage: "Request" })) });
      // Store patterns — the Fetch.requestPaused handler will block them
      (globalThis as any).__blockPatterns = input.patterns;
      return `Blocking ${input.patterns.length} URL patterns. Matching requests will be aborted.`;
    }
    case "mock_response": {
      await cdp("Fetch.enable", { patterns: [{ urlPattern: input.url_pattern, requestStage: "Request" }] });
      (globalThis as any).__mockResponses = (globalThis as any).__mockResponses || {};
      (globalThis as any).__mockResponses[input.url_pattern] = { status: input.status, body: input.body, contentType: input.content_type || "application/json" };
      return `Mocking ${input.url_pattern} → ${input.status}`;
    }
    case "set_request_headers": {
      await cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      (globalThis as any).__extraHeaders = input.headers;
      return `Will add headers to all requests: ${Object.keys(input.headers).join(", ")}`;
    }

    // CDP Cookie API
    case "cdp_get_cookies": {
      await cdp("Network.enable", {}).catch(() => {});
      const r = await cdp("Network.getCookies", input.urls ? { urls: input.urls } : {});
      return JSON.stringify(r?.cookies ?? []);
    }
    case "cdp_set_cookie": {
      await cdp("Network.enable", {}).catch(() => {});
      const r = await cdp("Network.setCookie", {
        name: input.name, value: input.value,
        domain: input.domain, path: input.path || "/",
        httpOnly: input.httpOnly || false, secure: input.secure || false,
        sameSite: input.sameSite, expires: input.expires,
      });
      return r?.success ? `Cookie set: ${input.name}` : "Cookie set failed";
    }
    case "cdp_clear_cookies": {
      await cdp("Network.enable", {}).catch(() => {});
      await cdp("Network.clearBrowserCookies", {});
      return "All browser cookies cleared";
    }

    // Accessibility tree
    case "get_accessibility_tree": {
      await cdp("Accessibility.enable", {});
      const r = await cdp("Accessibility.getFullAXTree", { depth: input.depth || 5 });
      const nodes = (r?.nodes ?? []).filter((n: any) => !n.ignored).map((n: any) => ({
        role: n.role?.value, name: n.name?.value, description: n.description?.value,
        value: n.value?.value, nodeId: n.nodeId,
      })).filter((n: any) => n.role && n.role !== "none" && n.role !== "generic");
      return JSON.stringify(nodes.slice(0, 100));
    }
    case "find_by_role": {
      await cdp("DOM.enable", {});
      await cdp("Accessibility.enable", {});
      const doc = await cdp("DOM.getDocument", { depth: 0 });
      const r = await cdp("Accessibility.queryAXTree", { nodeId: doc.root.nodeId, role: input.role });
      const nodes = (r?.nodes ?? []).map((n: any) => ({
        role: n.role?.value, name: n.name?.value, backendNodeId: n.backendDOMNodeId,
      }));
      return JSON.stringify(nodes);
    }
    case "find_by_name": {
      await cdp("DOM.enable", {});
      await cdp("Accessibility.enable", {});
      const doc = await cdp("DOM.getDocument", { depth: 0 });
      const r = await cdp("Accessibility.queryAXTree", { nodeId: doc.root.nodeId, accessibleName: input.name });
      const nodes = (r?.nodes ?? []).map((n: any) => ({
        role: n.role?.value, name: n.name?.value, backendNodeId: n.backendDOMNodeId,
      }));
      return JSON.stringify(nodes);
    }

    // PDF generation
    case "save_pdf": {
      const r = await cdp("Page.printToPDF", {
        printBackground: input.print_background ?? true,
        landscape: input.landscape ?? false,
        scale: 1, paperWidth: 8.5, paperHeight: 11,
        marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5,
      });
      if (r?.data) {
        const path = input.path || `/tmp/page-${Date.now()}.pdf`;
        await Bun.write(path, Buffer.from(r.data, "base64"));
        return `PDF saved: ${path}`;
      }
      return "PDF generation failed (only works in headless mode)";
    }

    // Dialog handling
    case "handle_dialog": {
      await cdp("Page.handleJavaScriptDialog", { accept: input.accept, promptText: input.prompt_text });
      return `Dialog ${input.accept ? "accepted" : "dismissed"}`;
    }
    case "auto_dismiss_dialogs": {
      // Register a preload script that overrides alert/confirm/prompt
      await cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: "window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';"
      });
      return "All future dialogs will be auto-dismissed";
    }

    // Download control
    case "set_download_path": {
      await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: input.path, eventsEnabled: true });
      return `Downloads will save to: ${input.path}`;
    }

    // Preload scripts
    case "add_preload_script": {
      const r = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: input.code });
      return `Preload script added (id: ${r?.identifier}). Runs before every page load.`;
    }
    case "enable_stealth": {
      await cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: `Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
window.chrome={runtime:{},loadTimes:()=>({}),csi:()=>({})};
Object.defineProperty(navigator,'plugins',{get:()=>[{name:'Chrome PDF Plugin'},{name:'Chrome PDF Viewer'},{name:'Native Client'}]});
Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
delete navigator.__proto__.webdriver;`
      });
      return "Stealth mode enabled — webdriver flag hidden, chrome.runtime faked";
    }

    // Permissions
    case "grant_permissions": {
      await cdp("Browser.grantPermissions", { permissions: input.permissions, origin: input.origin });
      return `Granted: ${input.permissions.join(", ")}`;
    }

    // File upload
    case "upload_file": {
      await cdp("DOM.enable", {});
      const doc = await cdp("DOM.getDocument", { depth: 0 });
      const node = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: input.selector });
      if (!node?.nodeId) return `File input not found: ${input.selector}`;
      await cdp("DOM.setFileInputFiles", { nodeId: node.nodeId, files: input.files });
      return `Uploaded ${input.files.length} file(s) to ${input.selector}`;
    }

    // Geolocation
    case "set_geolocation": {
      await cdp("Browser.grantPermissions", { permissions: ["geolocation"] }).catch(() => {});
      await cdp("Emulation.setGeolocationOverride", { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy || 100 });
      return `Location set: ${input.latitude}, ${input.longitude}`;
    }

    // Dark mode
    case "set_dark_mode": {
      await cdp("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: input.enabled ? "dark" : "light" }],
      });
      return `Dark mode: ${input.enabled ? "ON" : "OFF"}`;
    }

    // Touch emulation
    case "enable_touch": {
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: input.enabled, maxTouchPoints: input.enabled ? 5 : 0 });
      return `Touch emulation: ${input.enabled ? "ON" : "OFF"}`;
    }

    // DOM domain
    case "get_html": {
      await cdp("DOM.enable", {});
      const doc = await cdp("DOM.getDocument", { depth: 0 });
      const node = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: input.selector });
      if (!node?.nodeId) return `Not found: ${input.selector}`;
      const r = await cdp("DOM.getOuterHTML", { nodeId: node.nodeId });
      return r?.outerHTML ?? "No HTML";
    }
    case "remove_element": {
      await cdp("DOM.enable", {});
      const doc = await cdp("DOM.getDocument", { depth: 0 });
      const node = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: input.selector });
      if (!node?.nodeId) return `Not found: ${input.selector}`;
      await cdp("DOM.removeNode", { nodeId: node.nodeId });
      return `Removed: ${input.selector}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ============================================================================
// LLM API (OpenAI-compatible — works with Qwen, Bailian, OpenAI, etc.)
// ============================================================================

type Message = { role: "system" | "user" | "assistant" | "tool"; content?: any; tool_calls?: any[]; tool_call_id?: string; name?: string };

const SYSTEM_PROMPT = `You are a browser automation assistant. You control a Chrome browser using tools (function calls).

CRITICAL RULES:
1. Use find_by_text and click_text for sites with dynamic CSS classes (LinkedIn, Facebook, etc). Never rely on class-based selectors on these sites.
2. Elements below the fold are INVISIBLE until you scroll. If you need to find more elements, SCROLL DOWN first, then search again.
3. For repeated actions (e.g. "send 10 connections", "like 5 posts"):
   - Find visible matching elements → click them
   - Scroll down to reveal more
   - Find and click again
   - Repeat until the target count is reached
   - Always count what you've done so far
4. After clicking a button that opens a dialog/modal, wait 500-1000ms then check what appeared.
5. Use get_page_info to understand the current page before acting.
6. For search: click the search input, type text, press Enter.
7. For forms: use type_text for each field, or fill_form for multiple fields.
8. Use screenshot to show results when helpful.

SCROLL PATTERN (from binary):
The browser engine uses this sequence internally: scrollIntoView → wait for element stability (2 frames) → check not occluded → click.
When you need elements not yet visible: scroll down 400-800px → wait 1000ms → find_by_text or get_elements again.

Reply in the same language as the user.`;

// Convert our tools to OpenAI function format
const openaiTools = tools.map(t => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

async function callLLM(messages: Message[]): Promise<any> {
  const body = {
    model: AI_MODEL,
    max_tokens: 4096,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    tools: openaiTools,
  };

  const resp = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${err}`);
  }

  return resp.json();
}

// ============================================================================
// REPL
// ============================================================================

const conversationHistory: Message[] = [];

console.log("\nChrome is open. Tell me what to do:\n");
process.stdout.write("you> ");

const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let buf = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buf += decoder.decode(value);
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";

  for (const raw of lines) {
    const userInput = raw.trim();
    if (!userInput) { process.stdout.write("you> "); continue; }

    if (userInput === "quit" || userInput === "exit" || userInput === "q") {
      console.log("Closing...");
      ws.close();
      chrome.kill();
      if (safariDriver) safariDriver.kill();
      await Bun.sleep(500);
      Bun.spawnSync(["rm", "-rf", dataDir]);
      process.exit(0);
    }

    // Add user message
    conversationHistory.push({ role: "user", content: userInput });

    // Call LLM in a loop until it stops using tools
    let thinking = true;
    while (thinking) {
      try {
        const response = await callLLM(conversationHistory);
        const choice = response.choices?.[0];
        if (!choice) { thinking = false; break; }

        const msg = choice.message;

        // Add assistant message to history
        conversationHistory.push({
          role: "assistant",
          content: msg.content ?? null,
          tool_calls: msg.tool_calls ?? undefined,
        });

        // Print text response
        if (msg.content) {
          console.log(`\n${msg.content}`);
        }

        // Check for tool calls
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          thinking = false;
          break;
        }

        // Execute each tool call
        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          let fnArgs: any = {};
          try { fnArgs = JSON.parse(tc.function.arguments || "{}"); } catch {}

          console.log(`  [${fnName}] ${JSON.stringify(fnArgs).slice(0, 100)}`);
          let result: string;
          try {
            result = await executeTool(fnName, fnArgs);
            console.log(`  -> ${result.slice(0, 200)}`);
          } catch (e: any) {
            result = `Error: ${e.message}`;
            console.log(`  -> ${result}`);
          }

          // Add tool result to history
          conversationHistory.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }

        // If finish_reason is "stop", done
        if (choice.finish_reason === "stop") {
          thinking = false;
        }
      } catch (e: any) {
        console.log(`\nError: ${e.message}`);
        thinking = false;
      }
    }

    console.log("");
    process.stdout.write("you> ");
  }
}
