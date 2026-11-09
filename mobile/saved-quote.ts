import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { bindings, subscribeBindings, type ComposerBinding } from "./bindings";

const THREAD = "[data-thread-window]";
const PROSE = "[data-message-column] [data-sidebar-swipe-selectable]";
const MAX_QUOTE_LENGTH = 32_000;
const converter = new TurndownService({ codeBlockStyle: "fenced", bulletListMarker: "-" });
converter.use(gfm);
converter.addRule("fencedLanguage", {
  filter: node => node.nodeName === "PRE" && !!node.querySelector("code"),
  replacement: (_content, node) => {
    const code = (node as HTMLElement).querySelector("code")!;
    const language = code.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";
    const text = code.textContent ?? "";
    const fence = "`".repeat(Math.max(3, ...[...(text.match(/`+/g) ?? [])].map(s => s.length + 1)));
    return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
  },
});

interface Snapshot {
  binding: ComposerBinding;
  thread: Element;
  messageId: string | null;
  markdown: string;
  range: Range;
  text: string;
  rect: { left: number; right: number; top: number; bottom: number };
  pathname: string;
}

function el(node: Node | null) { return node instanceof Element ? node : node?.parentElement ?? null; }

export function selectedMarkdown(range: Range, prose: Element): string {
  const clone = range.cloneContents();
  // cloneContents drops the ancestor's inline marks when selecting part of a bold/link/code node.
  let content: Node = clone;
  let parent = el(range.commonAncestorContainer);
  while (parent && parent !== prose) {
    if (/^(STRONG|B|EM|I|S|DEL|A|CODE|PRE|P|BLOCKQUOTE|LI|UL|OL|TD|TH|TR|TBODY|THEAD|TABLE)$/.test(parent.tagName)) {
      const wrapper = parent.cloneNode(false);
      wrapper.appendChild(content);
      content = wrapper;
    }
    parent = parent.parentElement;
  }
  const root = document.createElement("div");
  root.appendChild(content);
  root.querySelectorAll('button, script, style, input, [data-clipboard-ignore]').forEach(n => n.remove());
  return converter.turndown(root.innerHTML).trim();
}

export function mountSavedQuote({ insertQuote }: {
  insertQuote: (button: HTMLButtonElement, thread: Element, operation: () => void) => void;
}) {
  let snapshot: Snapshot | null = null;
  let disposed = false;
  let activating = false;
  let actionFrame: number | null = null;
  const menu = document.createElement("div");
  menu.setAttribute("data-bb-mobile-saved-quote", "");
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Сохранённая цитата");
  menu.hidden = true;
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Цитировать";
  const reply = document.createElement("button");
  reply.type = "button";
  reply.textContent = "Ответить";
  const side = document.createElement("button");
  side.type = "button";
  side.textContent = "В боковой чат";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Отменить";
  close.setAttribute("data-mobile-quote-cancel", "");
  close.setAttribute("aria-label", "Отменить цитату");
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.hidden = true;
  const preview = document.createElement("div");
  preview.setAttribute("data-mobile-quote-preview", "");
  const more = document.createElement("button");
  more.type = "button";
  more.textContent = "⋯";
  more.setAttribute("aria-label", "Другие действия с цитатой");
  more.setAttribute("aria-expanded", "false");
  const extra = document.createElement("div");
  extra.setAttribute("data-mobile-quote-extra", "");
  extra.setAttribute("role", "group");
  extra.setAttribute("aria-label", "Другие действия с цитатой");
  extra.hidden = true;
  extra.append(side, add, close);
  reply.setAttribute("data-mobile-quote-reply", "");
  more.setAttribute("data-mobile-quote-more", "");
  menu.append(preview, reply, more, extra, status);
  function closeExtra() { extra.hidden = true; more.setAttribute("aria-expanded", "false"); }
  function toggleExtra() {
    extra.hidden = !extra.hidden;
    more.setAttribute("aria-expanded", String(!extra.hidden));
    position();
  }
  document.body.append(menu);

  // Keep native handlers available for restored selections, but never show a
  // second web toolbar alongside the OS selection menu on mobile.
  const hiddenMenus = new Set<HTMLElement>();
  function hideNativeMenus() {
    for (const wrapper of document.querySelectorAll<HTMLElement>("[data-radix-popper-content-wrapper]")) {
      if (!wrapper.querySelector('[role="dialog"]') || wrapper.querySelector('[role="menu"]')) continue;
      const hasQuote = [...wrapper.querySelectorAll("button")].some(button =>
        ["Add to chat", "Добавить в чат", "Цитировать"].includes(button.textContent?.trim() ?? ""));
      if (!hasQuote) continue;
      // Reuse the host SVGs rather than approximating BB's icon set.
      const aliases = [
        { target: reply, names: ["Ответить"] },
        { target: side, names: ["В боковой чат", "Reply in side chat"] },
        { target: add, names: ["Цитировать", "Add to chat", "Добавить в чат"] },
      ];
      for (const {target, names} of aliases) {
        const source = [...wrapper.querySelectorAll("button")].find(button => names.includes(button.textContent?.trim() ?? ""));
        const icon = source?.querySelector("svg");
        if (!icon || target.querySelector("svg")?.outerHTML === icon.outerHTML) continue;
        target.querySelector("svg")?.remove();
        target.prepend(icon.cloneNode(true));
      }
      wrapper.setAttribute("data-bb-mobile-native-selection", "");
      hiddenMenus.add(wrapper);
    }
    for (const wrapper of hiddenMenus) if (!wrapper.isConnected) hiddenMenus.delete(wrapper);
  }
  const menuObserver = new MutationObserver(hideNativeMenus);
  menuObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  hideNativeMenus();

  function valid(value: Snapshot) {
    return bindings.has(value.binding) && value.binding.marker.isConnected && value.thread.isConnected &&
      value.binding.marker.closest(THREAD) === value.thread && value.binding.composer.key === value.binding.key &&
      value.binding.composer.scope.kind === "thread" && value.binding.composer.scope.threadId === value.binding.threadId &&
      location.pathname === value.pathname;
  }

  function clear() {
    snapshot = null;
    menu.hidden = true;
    status.hidden = true;
    closeExtra();
  }

  function position() {
    if (!snapshot || !valid(snapshot)) { clear(); return; }
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    // Anchor to this selection's composer, never to a stale on-screen text rect.
    let composer: HTMLElement | null = null;
    for (let parent = snapshot.binding.marker.parentElement; parent; parent = parent.parentElement) {
      const boxes = parent.querySelectorAll<HTMLElement>("[data-promptbox]");
      if (boxes.length > 1) break;
      if (boxes.length === 1) { composer = boxes[0]; break; }
      if (parent === snapshot.thread) break;
    }
    const composerRect = composer?.getBoundingClientRect();
    const usable = composerRect && composerRect.width > 0 && composerRect.top > top + 80;
    const panelWidth = Math.min(usable ? composerRect.width : width - 24, width - 24);
    menu.style.width = `${Math.max(0, panelWidth)}px`;
    const box = menu.getBoundingClientRect();
    const x = Math.max(left + 12, Math.min(usable ? composerRect.left : left + 12, left + width - box.width - 12));
    const bottom = usable ? Math.min(composerRect.top - 8, top + height - 12) : top + height - 12;
    menu.style.left = `${x}px`;
    menu.style.top = `${Math.max(top + 12, bottom - box.height)}px`;
    extra.style.maxHeight = `${Math.max(60, bottom - box.height - top - 20)}px`;

  }

  function selectionChanged() {
    if (disposed || activating) return;
    const selection = document.getSelection();
    // The important case: dismissing the Apple menu may collapse selection. Keep our snapshot.
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (snapshot && valid(snapshot)) { menu.hidden = false; position(); }
      else clear();
      return;
    }
    if (selection.rangeCount !== 1) { clear(); return; }
    const range = selection.getRangeAt(0);
    const start = el(range.startContainer)?.closest(PROSE);
    const end = el(range.endContainer)?.closest(PROSE);
    if (!start || start !== end || start.closest('[contenteditable="true"]')) return;
    const thread = start.closest(THREAD);
    if (!thread) { clear(); return; }
    const matches = [...bindings].filter(b => b.marker.isConnected && b.marker.closest(THREAD) === thread);
    if (matches.length !== 1) { clear(); return; }
    if (!selection.toString().trim() || selection.toString().length > MAX_QUOTE_LENGTH) { clear(); return; }
    const markdown = selectedMarkdown(range, start);
    if (!markdown || markdown.length > MAX_QUOTE_LENGTH) { clear(); return; }
    const rect = range.getBoundingClientRect();
    snapshot = { binding: matches[0], thread, messageId: start.closest("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id") ?? null, markdown, range: range.cloneRange(), text: selection.toString(), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, pathname: location.pathname };
    preview.textContent = snapshot.text.replace(/\s+/g, " ").trim();
    preview.title = snapshot.text;
    closeExtra();
    status.hidden = true;
    // Only the OS menu is visible during selection. Show our retained actions after collapse.
    menu.hidden = true;
  }

  function activateNative(labels: string[]) {
    if (activating || !snapshot || !valid(snapshot)) return;
    const saved: Snapshot = snapshot;
    if (!saved.range.startContainer.isConnected || !saved.range.endContainer.isConnected || saved.range.toString() !== saved.text) { clear(); return; }
    activating = true;
    menu.hidden = true;
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(saved.range.cloneRange());
    document.dispatchEvent(new Event("selectionchange"));
    const deadline = Date.now() + 800;
    function attempt() {
      actionFrame = null;
      if (disposed || !valid(saved)) { activating = false; clear(); return; }
      const button = [...saved.thread.querySelectorAll<HTMLButtonElement>('[data-radix-popper-content-wrapper] [role="dialog"] button')]
        .find(button => labels.includes(button.textContent?.trim() ?? "") && !button.disabled);
      if (button) {
        // Native BB click handlers read the restored selection and own the action.
        snapshot = null;
        activating = false;
        button.click();
        clear();
        return;
      }
      if (Date.now() < deadline) { actionFrame = window.requestAnimationFrame(attempt); return; }
      activating = false;
      snapshot = saved;
      document.getSelection()?.removeAllRanges();
      status.textContent = "Действие недоступно. Выдели фрагмент ещё раз.";
      status.hidden = false;
      menu.hidden = false;
      position();
    }
    // Give React time to reconstruct the selection menu with fresh context.
    actionFrame = window.requestAnimationFrame(() => { actionFrame = window.requestAnimationFrame(attempt); });
  }
  function replyClick() {
    const saved = snapshot;
    if (activating || !saved || !valid(saved)) return;
    if (saved.messageId) {
      const event = new CustomEvent("bb-quote-reply:open-v1", { cancelable: true, detail: {
        composer: saved.binding.composer, threadId: saved.binding.threadId,
        messageId: saved.messageId, text: saved.text, rect: saved.rect, range: saved.range,
      } });
      document.dispatchEvent(event);
      if (event.defaultPrevented) { clear(); return; }
    }
    activateNative(["Ответить"]);
  }
  function sideClick() { activateNative(["В боковой чат", "Reply in side chat"]); }

  function activate() {
    const saved = snapshot;
    if (!saved || !valid(saved)) { clear(); return; }
    const quote = saved.markdown.replace(/^/gm, "> ") + "\n\n";
    snapshot = null; // Consume before any synchronous host update or repeated activation.
    document.getSelection()?.removeAllRanges();
    let inserted = false;
    try {
      insertQuote(add, saved.thread, () => {
        saved.binding.composer.insert(quote, { at: "end", block: true });
        inserted = true;
        saved.binding.composer.focus();
      });
      clear();
    } catch {
      // Focus/DOM recovery is optional once the draft write succeeded: never replay that write.
      if (inserted) { clear(); return; }
      if (valid(saved)) snapshot = saved;
      status.textContent = "Не удалось добавить цитату. Попробуй ещё раз.";
      status.hidden = false;
    }
  }

  function outsidePointer(event: PointerEvent) {
    // The pending selection remains until an explicit action; only fold overflow.
    if (!menu.hidden && !activating && !menu.contains(event.target as Node)) closeExtra();
  }

  function key(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (!extra.hidden) { closeExtra(); more.focus(); } else clear();
    }
  }
  function checkBinding() { if (snapshot && !valid(snapshot)) clear(); }
  const unbind = subscribeBindings(checkBinding);
  more.addEventListener("click", toggleExtra);
  reply.addEventListener("click", replyClick);
  side.addEventListener("click", sideClick);
  add.addEventListener("click", activate);
  close.addEventListener("click", clear);
  // Retain the range on the second tap; only explicit activation writes into the draft.
  menu.addEventListener("pointerdown", preventFocus);
  function preventFocus(event: PointerEvent) { event.preventDefault(); }
  document.addEventListener("selectionchange", selectionChanged);
  document.addEventListener("pointerdown", outsidePointer, true);
  document.addEventListener("keydown", key);
  window.addEventListener("popstate", clear);
  window.addEventListener("hashchange", clear);
  window.addEventListener("pagehide", clear);
  let positionFrame: number | null = null;
  function schedulePosition() {
    if (menu.hidden || positionFrame !== null) return;
    positionFrame = window.requestAnimationFrame(() => { positionFrame = null; position(); });
  }
  window.addEventListener("scroll", schedulePosition, true);
  window.addEventListener("resize", schedulePosition);
  window.visualViewport?.addEventListener("resize", schedulePosition);
  window.visualViewport?.addEventListener("scroll", schedulePosition);
  selectionChanged();
  return () => {
    disposed = true;
    menuObserver.disconnect();
    for (const wrapper of hiddenMenus) wrapper.removeAttribute("data-bb-mobile-native-selection");
    hiddenMenus.clear();
    if (actionFrame !== null) window.cancelAnimationFrame(actionFrame);
    clear();
    unbind();
    more.removeEventListener("click", toggleExtra);
    reply.removeEventListener("click", replyClick);
    side.removeEventListener("click", sideClick);
    add.removeEventListener("click", activate);
    close.removeEventListener("click", clear);
    menu.removeEventListener("pointerdown", preventFocus);
    menu.remove();
    document.removeEventListener("selectionchange", selectionChanged);
    document.removeEventListener("pointerdown", outsidePointer, true);
          document.removeEventListener("keydown", key);
    window.removeEventListener("popstate", clear);
    window.removeEventListener("hashchange", clear);
    window.removeEventListener("pagehide", clear);
    if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
    window.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
    window.visualViewport?.removeEventListener("resize", schedulePosition);
    window.visualViewport?.removeEventListener("scroll", schedulePosition);
  };
}
