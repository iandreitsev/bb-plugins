import { mountSavedQuote } from "./saved-quote";

/** DOM enhancements for the stock BB transcript and composer. No private app imports. */
const THREAD = "[data-thread-window]";
const PROSE = "[data-message-column] [data-sidebar-swipe-selectable]";
const EDITOR = '[data-promptbox-editor-content] [contenteditable="true"][role="textbox"]';
const INPUT = 'input, textarea, select, [contenteditable="true"]';
const STYLE_ID = "bb-mobile-selection-style";

export function isMobile(win: Window): boolean {
  const nav = win.navigator;
  return /iPhone|iPad|iPod|Android/i.test(nav.userAgent) ||
    (nav.maxTouchPoints > 0 && win.matchMedia("(pointer: coarse)").matches);
}

function element(node: EventTarget | Node | null): Element | null {
  return node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
}

function transcript(node: EventTarget | Node | null): Element | null {
  const el = element(node);
  if (!el || el.closest(INPUT)) return null;
  const prose = el.closest(PROSE);
  return prose?.closest(THREAD) ? prose : null;
}

function quoteAction(target: EventTarget | null): HTMLButtonElement | null {
  const button = element(target)?.closest("button");
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
  const label = (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
  return /^(Add to chat|Добавить в чат|Цитировать)$/i.test(label) ? button : null;
}

/** A caret belongs in BB's trailing paragraph, never in the blockquote or after its BR. */
export function focusEnd(editor: HTMLElement): boolean {
  const paragraph = editor.lastElementChild;
  if (!(paragraph instanceof HTMLElement) || !["P", "DIV"].includes(paragraph.tagName) ||
      paragraph.closest("blockquote") || !editor.querySelector("blockquote")) return false;
  const selection = editor.ownerDocument.getSelection();
  if (!selection) return false;
  editor.focus({ preventScroll: true });
  const range = editor.ownerDocument.createRange();
  if (paragraph.textContent === "") {
    // iOS needs the position BEFORE ProseMirror's trailing BR. After it can map back to the quote.
    range.setStart(paragraph, 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(paragraph);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

interface PendingQuote {
  button: HTMLButtonElement;
  thread: Element;
  editors: Map<HTMLElement, string>;
  observer: MutationObserver;
  timeout: number;
}

export function mountMobile({ signal }: { signal: AbortSignal }): (() => void) | void {
  if (signal.aborted || !isMobile(window)) return;
  let disposed = false;
  let pending: PendingQuote | null = null;
  let frame: number | null = null;
  let origin: Element | null = null;
  let correctionFrame: number | null = null;
  let correctionEditor: HTMLElement | null = null;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // OS selection stays intact; web actions are shown only after selection collapses.
  style.textContent = `
    [data-bb-mobile-native-selection] { visibility: hidden !important; pointer-events: none !important; }
    [data-bb-mobile-saved-quote][hidden] { display: none !important; }
    [data-bb-mobile-saved-quote] { position: fixed; z-index: 100; display: flex; align-items: center; gap: 8px;
      box-sizing: border-box; max-width: calc(100vw - 24px); padding: 8px; border: 1px solid var(--border, #ddd); border-radius: 12px;
      background: var(--popover, white); color: var(--popover-foreground, #222); box-shadow: 0 3px 12px #00000012;
      font: 14px/20px -apple-system, system-ui, "SF Pro Text", "Segoe UI", sans-serif; -webkit-user-select: none; user-select: none; }
    [data-mobile-quote-preview] { flex: 1; min-width: 0; border-left: 2px solid var(--border, #ccc); padding-left: 8px; margin-left: 2px;
      color: var(--muted-foreground, #777); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-bb-mobile-saved-quote] button { display: inline-flex; flex-shrink: 0; align-items: center; gap: 5px; justify-content: center;
      min-height: 32px; border: 0; border-radius: 7px; padding: 4px 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
    [data-bb-mobile-saved-quote] button[data-mobile-quote-reply] { background: var(--surface-recessed, #f3f3f3); }
    [data-bb-mobile-saved-quote] button[data-mobile-quote-more] { width: 32px; padding: 0; font-size: 22px; }
    [data-bb-mobile-saved-quote] button svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--muted-foreground, #888); }
    [data-bb-mobile-saved-quote] button:hover, [data-bb-mobile-saved-quote] button:active { background: #8882; }
    [data-bb-mobile-saved-quote] button:focus-visible { outline: 1px solid currentColor; }
    [data-mobile-quote-extra] { position: absolute; bottom: calc(100% + 6px); right: 0; display: flex; flex-direction: column; min-width: 170px;
      padding: 4px; border: 1px solid var(--border, #ddd); border-radius: 10px; background: var(--popover, white); box-shadow: 0 3px 12px #0002; overflow-y: auto; }
    [data-mobile-quote-extra][hidden] { display: none !important; }
    [data-mobile-quote-extra] button[data-mobile-quote-cancel] { border-top: 1px solid var(--border, #ddd); border-radius: 0 0 7px 7px; margin-top: 4px; }
    [data-mobile-quote-extra] button { justify-content: flex-start; min-height: 36px; padding: 6px 10px; }
    [data-bb-mobile-saved-quote] [role=status] { position: absolute; bottom: calc(100% + 6px); left: 0; max-width: 280px; padding: 6px; border-radius: 6px; background: var(--popover, white); font-size: 12px; }
  `;
  document.head.append(style);

  function clearPending() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (!pending) return;
    pending.observer.disconnect();
    window.clearTimeout(pending.timeout);
    pending = null;
  }

  function cancelCorrection() {
    if (correctionFrame !== null) window.cancelAnimationFrame(correctionFrame);
    correctionFrame = null;
    correctionEditor = null;
  }

  function stabilizeCaret(editor: HTMLElement) {
    cancelCorrection();
    correctionEditor = editor;
    // BB/Tiptap also restores focus in animation frames. Apply the position after that work,
    // once more on the following frame, and stop immediately on the next user gesture.
    let remaining = 2;
    function correct() {
      correctionFrame = null;
      if (disposed || correctionEditor !== editor || !editor.isConnected || document.activeElement !== editor) {
        cancelCorrection();
        return;
      }
      focusEnd(editor);
      if (--remaining > 0) correctionFrame = window.requestAnimationFrame(correct);
      else correctionEditor = null;
    }
    correctionFrame = window.requestAnimationFrame(correct);
  }

  function rememberSelection() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
      origin = null;
      return;
    }
    const start = transcript(selection.anchorNode);
    const end = transcript(selection.focusNode);
    const thread = start?.closest(THREAD);
    origin = thread && end?.closest(THREAD) === thread ? thread : null;
  }

  function candidates(thread: Element): HTMLElement[] {
    return Array.from(thread.querySelectorAll<HTMLElement>(EDITOR)).filter(el =>
      el.closest(THREAD) === thread && !el.closest('[inert], [aria-hidden="true"]'));
  }

  function fingerprint(el: HTMLElement) { return el.innerHTML; }

  function settle(): boolean {
    const task = pending;
    if (!task || disposed || !task.thread.isConnected) { clearPending(); return false; }
    // A newly mounted editor or another thread's draft is deliberately not guessed.
    const changed = candidates(task.thread).filter(el =>
      task.editors.has(el) && fingerprint(el) !== task.editors.get(el));
    if (changed.length !== 1) return false;
    const editor = changed[0];
    if (!focusEnd(editor)) return false;
    clearPending();
    stabilizeCaret(editor);
    return true;
  }

  function prepare(event: Event) {
    const button = quoteAction(event.target);
    if (!button) return;
    // Native message action buttons live in the thread; floating selection menus use origin.
    const thread = button.closest(THREAD) ?? origin;
    if (!thread?.isConnected) return;
    beginQuote(button, thread);
  }

  function beginQuote(button: HTMLButtonElement, thread: Element) {
    if (pending?.button === button) return;
    clearPending();
    const editors = new Map(candidates(thread).map(el => [el, fingerprint(el)]));
    if (editors.size === 0) return;
    const observer = new MutationObserver(() => { settle(); });
    observer.observe(thread, { childList: true, characterData: true, subtree: true });
    pending = { button, thread, editors, observer, timeout: window.setTimeout(clearPending, 600) };
  }

  function afterAction(event: Event) {
    const button = quoteAction(event.target);
    if (button) finishQuote(button);
  }

  function finishQuote(button: HTMLButtonElement) {
    if (!pending || button !== pending.button) return;
    // Runs after the stock React action. Synchronous focus keeps the iOS keyboard gesture.
    if (settle()) return;
    queueMicrotask(() => {
      if (disposed || !pending || settle()) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => { frame = null; settle(); });
    });
  }

  function newGesture(event: Event) {
    cancelCorrection();
    if (pending && quoteAction(event.target) !== pending.button) clearPending();
  }

  function cancel() { clearPending(); cancelCorrection(); }
  document.addEventListener("selectionchange", rememberSelection);
  document.addEventListener("pointerdown", newGesture, true);
  document.addEventListener("keydown", cancel, true);
  // BB activates touch quotes on pointerup and mouse/keyboard quotes on click.
  document.addEventListener("pointerup", prepare, true);
  document.addEventListener("click", prepare, true);
  document.addEventListener("pointerup", afterAction);
  document.addEventListener("click", afterAction);
  rememberSelection();
  const disposeSavedQuote = mountSavedQuote({ insertQuote(button, thread, operation) {
    beginQuote(button, thread);
    try { operation(); finishQuote(button); }
    catch (error) { clearPending(); throw error; }
  } });

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearPending();
    cancelCorrection();
    origin = null;
    disposeSavedQuote();
    style.remove();
    document.removeEventListener("selectionchange", rememberSelection);
    document.removeEventListener("pointerdown", newGesture, true);
    document.removeEventListener("keydown", cancel, true);
    document.removeEventListener("pointerup", prepare, true);
    document.removeEventListener("click", prepare, true);
    document.removeEventListener("pointerup", afterAction);
    document.removeEventListener("click", afterAction);
    signal.removeEventListener("abort", dispose);
  }
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
