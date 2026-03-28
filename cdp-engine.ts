/**
 * CDP Engine — Exact replica of the eloterminal binary's browser automation
 *
 * Every function here maps 1:1 to a decompiled function in the binary.
 * Comments reference the exact file:line in browser-clean/*.c
 */

export {};

// ============================================================================
// Types matching binary's internal structs
// ============================================================================

// Binary stores these at session+0x60, +0x61, +0x62 (core_056.c:8102-8119)
type ButtonType = 0 | 1 | 2; // 0=left, 1=right, 2=middle

// Binary modifier bitmask (rust_core_000.c:4950)
// Internal: Alt=bit0, Ctrl=bit1, Meta=bit2, Shift=bit3
// CDP:      Alt=1, Ctrl=2, Shift=4, Meta=8 (after reorder)
// Reorder formula from binary (core_056.c:8120):
//   bVar3 & 2 | bVar3 >> 2 & 1 | bVar3 >> 1 & 4 | (bVar3 & 1) << 3
function reorderModifiers(internal: number): number {
  return (internal & 2) | ((internal >> 2) & 1) | ((internal >> 1) & 4) | ((internal & 1) << 3);
}

// ============================================================================
// CDP Connection (matches FUN_100729954 — JSON-RPC message builder)
// ============================================================================

export class CDPEngine {
  private ws: WebSocket;
  private msgId = 1; // DAT_1047c18fc in binary
  private sessionId: string | null = null;
  private pending = new Map<number, { resolve: Function; reject: Function }>();

  // Session state (binary stores at lVar18+offset)
  private viewportWidth = 1280;  // +0x20
  private viewportHeight = 800;  // +0x24
  private currentUrl = "";
  private currentTitle = "";
  private consoleLogs: { type: string; args: string[]; time: number }[] = [];
  private pageErrors: string[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.onmessage = (e) => this._onMessage(String(e.data));
  }

  // Binary: FUN_100723344 + FUN_10072466c — CDP message router
  private _onMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    // Response to a command
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result ?? {});
      return;
    }

    // Event handling (core_056.c FUN_10072466c)
    switch (msg.method) {
      case "Page.frameNavigated":
        // core_056.c: extracts frame.url, updates stored URL
        if (msg.params?.frame?.url) this.currentUrl = msg.params.frame.url;
        break;

      case "Page.loadEventFired":
        // core_056.c:8982 — binary auto-evaluates "document.title" after load
        this.send("Runtime.evaluate", {
          expression: "document.title",
          returnByValue: true,
        }).then(r => {
          if (r?.result?.value) this.currentTitle = r.result.value;
        }).catch(() => {});
        break;

      case "Runtime.consoleAPICalled":
        // core_056.c FUN_10072466c — parses each arg by type:
        // string, number, boolean, undefined, bigint, symbol
        const args = (msg.params?.args ?? []).map((a: any) => {
          switch (a.type) {
            case "string": return a.value;
            case "number": return String(a.value);
            case "boolean": return String(a.value);
            case "undefined": return "undefined";
            case "bigint": return a.description ?? a.unserializableValue ?? "bigint";
            case "symbol": return a.description ?? "Symbol()";
            default: return a.description ?? a.value ?? "";
          }
        });
        // Binary determines level: error/assert→error, warning→warn, debug→debug, info/log/etc→info
        this.consoleLogs.push({ type: msg.params?.type ?? "log", args, time: Date.now() });
        if (this.consoleLogs.length > 200) this.consoleLogs.shift();
        break;

      case "Runtime.exceptionThrown":
        this.pageErrors.push(msg.params?.exceptionDetails?.text ?? "Unknown error");
        break;

      case "Target.detachedFromTarget":
        // core_056.c: "page detached (crashed or closed)"
        if (msg.params?.sessionId === this.sessionId) {
          this.sessionId = null;
        }
        break;
    }
  }

  // Binary: FUN_100729954 — builds {"id":N,"method":"...","sessionId":"...","params":{...}}
  async send(method: string, params?: any): Promise<any> {
    const id = this.msgId++;
    const msg: any = { id, method };
    if (params) msg.params = params;
    if (this.sessionId) msg.sessionId = this.sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 15000);
    });
  }

  // Binary: FUN_1007229f0 — fire-and-forget (no response awaited)
  fire(method: string, params?: any): void {
    const id = this.msgId++;
    const msg: any = { id, method };
    if (params) msg.params = params;
    if (this.sessionId) msg.sessionId = this.sessionId;
    this.ws.send(JSON.stringify(msg));
  }

  // ============================================================================
  // Session bootstrap (core_056.c states 0→1→2)
  // Binary: Target.attachToTarget → Page.enable → Runtime.enable
  // ============================================================================

  async attachToTarget(targetId: string): Promise<string> {
    // State 0: Target.attachToTarget with flatten=true
    const r = await this.send("Target.attachToTarget", { targetId, flatten: true });
    this.sessionId = r.sessionId;

    // State 1: Page.enable
    await this.send("Page.enable");

    // State 2: Runtime.enable
    await this.send("Runtime.enable");

    return r.sessionId;
  }

  // ============================================================================
  // Navigate (rust_core_000.c FUN_1007272c0, lines 4681-4764)
  // Binary: if no target → Target.createTarget(about:blank, newWindow, width, height)
  //         if target exists → Page.navigate(url)
  // ============================================================================

  async navigate(url: string): Promise<{ url: string; errorText?: string }> {
    // State 2: Page.navigate
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) return { url, errorText: r.errorText };
    return { url: r.frameId ? url : this.currentUrl };
  }

  async createTarget(url?: string): Promise<string> {
    // rust_core_000.c:4719-4724 — about:blank + newWindow=true + width + height
    const r = await this.send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
      width: this.viewportWidth,
      height: this.viewportHeight,
    });
    const targetId = r.targetId;

    if (url) {
      // rust_core_000.c:4738 — navigate separately after creation
      await this.attachToTarget(targetId);
      await this.navigate(url);
    }

    return targetId;
  }

  async closeTarget(targetId: string): Promise<void> {
    // file_003.c:552 — Target.closeTarget
    await this.send("Target.closeTarget", { targetId });
  }

  // ============================================================================
  // History navigation (core_056.c state 8, rust_core_000.c FUN_100728c58/FUN_100728d90)
  // ============================================================================

  async goBack(): Promise<boolean> {
    const h = await this.send("Page.getNavigationHistory");
    if (h.currentIndex > 0) {
      await this.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
      return true;
    }
    return false;
  }

  async goForward(): Promise<boolean> {
    const h = await this.send("Page.getNavigationHistory");
    if (h.currentIndex < h.entries.length - 1) {
      await this.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex + 1].id });
      return true;
    }
    return false;
  }

  async reload(): Promise<void> {
    // rust_core_000.c:5439 — Page.reload
    await this.send("Page.reload");
  }

  // ============================================================================
  // HIGH-LEVEL METHODS (io/io.c, string_006.c)
  //
  // The binary exposes these as the WebView JS API. They chain low-level CDP
  // primitives into single, reliable operations.
  // ============================================================================

  // ============================================================================
  // click(selector, options?) — io/io.c:748 (THE KEY METHOD)
  //
  // High-level click that does EVERYTHING:
  //   1. Validate selector not empty
  //   2. scrollIntoView (network_001.c:7021)
  //   3. Actionability check with 2-frame stability (network_001.c:6908)
  //   4. mousePressed (fire-and-forget) + mouseReleased (await)
  //   Default timeout: 30000ms (io/io.c:760)
  // ============================================================================

  async clickSelector(selector: string, options?: { timeout?: number; button?: ButtonType; clickCount?: number; modifiers?: number }): Promise<[number, number]> {
    const timeout = options?.timeout ?? 30000; // Binary default: 30s (io/io.c:760)
    const button = options?.button ?? 0;
    const clickCount = options?.clickCount ?? 1;
    const modifiers = options?.modifiers ?? 0;

    if (!selector) throw new Error("must not be empty"); // io/io.c:783

    // Combined scrollIntoView + actionability + click in ONE Runtime.evaluate
    // This matches the binary's FUN_10072f958 which chains all 3 steps
    const r = await this.send("Runtime.evaluate", {
      expression: `(async (sel, timeout) => {
// Step 1: scrollIntoView (binary state 0x12 — network_001.c:7021)
const el0 = document.querySelector(sel);
if (el0) el0.scrollIntoView({ block: "center", behavior: "instant" });

// Step 2: actionability check (binary state 0x11 — network_001.c:6908)
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
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "' to be actionable";
  await new Promise(f => requestAnimationFrame(f));
}
})("${selector.replace(/"/g, '\\"')}", ${timeout})`,
      returnByValue: true,
      awaitPromise: true,
    });

    const coords = r?.result?.value;
    if (!coords) throw new Error(`Element not actionable: ${selector}`);
    const [cx, cy] = coords;

    // Step 3: click (core_056.c:8122-8148)
    const buttonStr = button === 2 ? "middle" : button === 1 ? "right" : "left";
    const cdpMods = reorderModifiers(modifiers);

    // mousePressed — fire-and-forget (FUN_1007229f0)
    this.fire("Input.dispatchMouseEvent", {
      type: "mousePressed", x: cx, y: cy,
      button: buttonStr, clickCount, modifiers: cdpMods,
    });

    // mouseReleased — await response (FUN_1007274fc)
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: cx, y: cy,
      button: buttonStr, clickCount, modifiers: cdpMods,
    });

    return [cx, cy];
  }

  // ============================================================================
  // scrollTo(selector) — io/io.c:920
  // High-level scroll-to-element by CSS selector
  // ============================================================================

  async scrollTo(selector: string, timeout = 5000): Promise<void> {
    await this.send("Runtime.evaluate", {
      expression: `(async (sel, timeout) => {
const deadline = performance.now() + timeout;
for (;;) {
  const el = document.querySelector(sel);
  if (el) { el.scrollIntoView({ block: "center", behavior: "instant" }); return; }
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "'";
  await new Promise(f => requestAnimationFrame(f));
}
})("${selector.replace(/"/g, '\\"')}", ${timeout})`,
      returnByValue: true,
      awaitPromise: true,
    });
  }

  // ============================================================================
  // type(text) — string_006.c:21860
  // High-level text input (validates text is string, then calls insertText)
  // ============================================================================

  async type(text: string): Promise<void> {
    if (typeof text !== "string") throw new Error("text must be string"); // string_006.c:21891-21892
    await this.send("Input.insertText", { text });
  }

  // ============================================================================
  // LOW-LEVEL METHODS (rust_core_000.c, network_001.c)
  // These are the primitives that the high-level methods chain.
  // ============================================================================

  async scrollIntoView(selector: string, block = "center"): Promise<void> {
    // network_001.c:7021 — exact binary JS
    await this.send("Runtime.evaluate", {
      expression: `(async (sel, timeout, block) => {
const deadline = performance.now() + timeout;
for (;;) {
  const el = document.querySelector(sel);
  if (el) { el.scrollIntoView({ block, behavior: 'instant' }); return; }
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "'";
  await new Promise(f => requestAnimationFrame(f));
}
})("${selector.replace(/"/g, '\\"')}", 5000, "${block}")`,
      returnByValue: true,
      awaitPromise: true,
    });
  }

  async findActionable(selector: string): Promise<[number, number] | null> {
    // network_001.c:6908 — exact binary JS (returns [cx, cy])
    const r = await this.send("Runtime.evaluate", {
      expression: `(async (sel, timeout) => {
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
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "' to be actionable";
  await new Promise(f => requestAnimationFrame(f));
}
})("${selector.replace(/"/g, '\\"')}", 5000)`,
      returnByValue: true,
      awaitPromise: true,
    });
    return r?.result?.value ?? null;
  }

  async click(selector: string, button: ButtonType = 0, clickCount = 1, modifiers = 0): Promise<[number, number]> {
    // Step 1: scrollIntoView (state 0x12)
    await this.scrollIntoView(selector).catch(() => {});

    // Step 2: actionability check (state 0x11)
    const coords = await this.findActionable(selector);
    if (!coords) throw new Error(`Element not actionable: ${selector}`);

    const [cx, cy] = coords;

    // Step 3: Map button (core_056.c:8103-8117)
    // Binary: 0→"left", 1→"right", 2→"middle"
    const buttonStr = button === 2 ? "middle" : button === 1 ? "right" : "left";

    // Step 4: Reorder modifiers (core_056.c:8120)
    const cdpMods = reorderModifiers(modifiers);

    // Step 5: mousePressed (fire-and-forget — FUN_1007229f0 in core_056.c:8130)
    this.fire("Input.dispatchMouseEvent", {
      type: "mousePressed", x: cx, y: cy,
      button: buttonStr, clickCount, modifiers: cdpMods,
    });

    // Step 6: mouseReleased (await response — core_056.c:8141-8148)
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: cx, y: cy,
      button: buttonStr, clickCount, modifiers: cdpMods,
    });

    return [cx, cy];
  }

  // Direct click at coordinates (rust_core_000.c FUN_100727bac)
  async clickAt(x: number, y: number, button: ButtonType = 0, clickCount = 1, modifiers = 0): Promise<void> {
    const buttonStr = button === 2 ? "middle" : button === 1 ? "right" : "left";
    const cdpMods = reorderModifiers(modifiers);

    // Fire-and-forget mousePressed
    this.fire("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y,
      button: buttonStr, clickCount, modifiers: cdpMods,
    });

    // Await mouseReleased
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y,
      button: buttonStr, clickCount, modifiers: cdpMods,
    });
  }

  // ============================================================================
  // Keyboard (rust_core_000.c FUN_100728520 + FUN_1007283e8)
  // ============================================================================

  // FUN_100728520: keyPress — rawKeyDown + keyUp
  async keyPress(keyCode: number, key: string, text: string, modifiers = 0): Promise<void> {
    const cdpMods = reorderModifiers(modifiers);

    // Binary: determines rawKeyDown vs keyDown based on whether text exists (5140-5142)
    const downType = text ? "keyDown" : "rawKeyDown";

    // rawKeyDown/keyDown (fire-and-forget — FUN_1007229f0)
    this.fire("Input.dispatchKeyEvent", {
      type: downType, key, text,
      windowsVirtualKeyCode: keyCode,
      modifiers: cdpMods,
    });

    // keyUp (await response — FUN_1007274fc)
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp", key,
      windowsVirtualKeyCode: keyCode,
      modifiers: cdpMods,
    });
  }

  // FUN_1007283e8: insertText
  async insertText(text: string): Promise<void> {
    await this.send("Input.insertText", { text });
  }

  // ============================================================================
  // Scroll (rust_core_000.c FUN_10072891c, lines 5232-5288)
  //
  // Binary: mouseWheel at viewport center (width/2, height/2)
  //         reads actual viewport from session state +0x20/+0x24
  // ============================================================================

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    // Binary reads viewport from state. We read from page to match.
    const vp = await this.send("Runtime.evaluate", {
      expression: "JSON.stringify({w:innerWidth,h:innerHeight})",
      returnByValue: true,
    }).catch(() => null);

    let cx = this.viewportWidth / 2;
    let cy = this.viewportHeight / 2;
    try {
      const parsed = JSON.parse(vp?.result?.value);
      cx = parsed.w / 2;
      cy = parsed.h / 2;
      this.viewportWidth = parsed.w;
      this.viewportHeight = parsed.h;
    } catch {}

    // rust_core_000.c:5262-5268 — mouseWheel at center
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(cx), y: Math.round(cy),
      deltaX, deltaY,
    });
  }

  // ============================================================================
  // Viewport (rust_core_000.c FUN_100728ac0, line 5324)
  // Binary: always sends width, height, deviceScaleFactor, mobile
  // ============================================================================

  async setViewport(width: number, height: number, deviceScaleFactor = 1, mobile = false): Promise<void> {
    this.viewportWidth = width;
    this.viewportHeight = height;
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor, mobile,
    });
  }

  // ============================================================================
  // Screenshot (regex.c:6573)
  // Binary: Page.captureScreenshot with format="png" — hardcoded, no jpeg
  // ============================================================================

  async screenshot(): Promise<string> {
    // regex.c:6574 — format is hardcoded to "png"
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    return r.data; // base64
  }

  // ============================================================================
  // JavaScript evaluation (core_056.c state 0xb, network_001.c:6927)
  //
  // Binary has 4 variants:
  //   1. core_056.c:8980 — returnByValue=true (document.title)
  //   2. network_001.c:6927 — returnByValue=true, awaitPromise=true (actionability)
  //   3. network_001.c:7049 — returnByValue=true, awaitPromise=true (scrollIntoView)
  //   4. math_000.c:10766 — returnByValue=true, awaitPromise=true, wraps in (async()=>{return await (expr)})()
  // ============================================================================

  async evaluate(expression: string): Promise<any> {
    // Variant 1: simple (core_056.c:8980)
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  }

  async evaluateAsync(expression: string): Promise<any> {
    // Variant 2/3: with awaitPromise (network_001.c:6927)
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  }

  async evaluateAsyncWrapped(expression: string): Promise<any> {
    // Variant 4: wraps in async IIFE (math_000.c:10740)
    return this.evaluateAsync(`(async()=>{return await (${expression})})()`);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  getSessionId() { return this.sessionId; }
  setSessionId(id: string) { this.sessionId = id; }
  getCurrentUrl() { return this.currentUrl; }
  getCurrentTitle() { return this.currentTitle; }
  getConsoleLogs() { return this.consoleLogs; }
  getPageErrors() { return this.pageErrors; }
  getViewport() { return { width: this.viewportWidth, height: this.viewportHeight }; }
  clearConsoleLogs() { this.consoleLogs.length = 0; }
  clearPageErrors() { this.pageErrors.length = 0; }
}
