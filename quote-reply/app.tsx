/** Selection-anchored reply editor; native mentions own persistence and delivery. */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { definePluginApp, experimental_VoiceInputTextarea as VoiceInputTextarea, experimental_usePluginId, useComposer, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginComposerApi } from "@get-bb/plugin-sdk";
import { createPortal, flushSync } from "react-dom";
import { bindInlineCards, mountInlineCards } from "./inline-cards";
import { captureReplyAnchor, mountSelectionCapture, popupPosition, replyFieldHeight, growingPopupTop, replyBottomBoundary, type ReplyAnchor } from "./selection-anchor";
import { observeSentQuotes, type SentQuoteTarget } from "./sent-quotes";
import { mountMobileReply, registerReplyComposer } from "./mobile-reply";
import { mountSelectionMenu } from "./selection-menu";
import type { rpcContract } from "./server";
import { PROVIDER, preview, quoteInputSchema, quoteMentions, replaceQuoteMention, type QuoteInput, type QuoteMention } from "./quotes";
import { NativeVoiceAdd } from "./native-voice-add";
import "./app.css";

type Editor = { id: number; input: QuoteInput; target?: QuoteMention; anchor: ReplyAnchor; open: boolean };
let nextEditorId = 0;
const editors = new Map<string, Editor>();
const actionErrors = new Map<string, string>();
function reportActionError(key: string, error?: string): void {
  if (error) actionErrors.set(key, error); else actionErrors.delete(key);
  for (const listener of listeners) listener();
}
const listeners = new Set<() => void>();
function updateEditor(key: string, editor?: Editor): void {
  if (editor) editors.set(key, editor); else editors.delete(key);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function openEditor(composer: PluginComposerApi, editor: Omit<Editor, "open" | "id">): void {
  const previous = editors.get(composer.key);
  const sameReply = previous?.input.messageId === editor.input.messageId && previous.input.quote === editor.input.quote && previous.target?.id === editor.target?.id;
  updateEditor(composer.key, { ...editor, id: ++nextEditorId, input: sameReply ? previous.input : editor.input, open: true });
}
const errorText = (error: unknown): string => error instanceof Error ? error.message : "Не удалось сохранить ответ.";

export function ReplyPopup() {
  const composer = useComposer();
  const editor = useSyncExternalStore(subscribe, () => editors.get(composer.key));
  const boundaryMarker = useRef<HTMLSpanElement>(null);
  const actionError = useSyncExternalStore(subscribe, () => actionErrors.get(composer.key) ?? actionErrors.get("*"));
  useLayoutEffect(() => registerReplyComposer(composer), [composer, composer.key]);
  return <><span ref={boundaryMarker} hidden />
    {actionError && <div role="alert" className="qr-error">{actionError} <button type="button" onClick={() => { reportActionError(composer.key); reportActionError("*"); }}>Закрыть</button></div>}
    {editor?.open ? createPortal(<ReplyEditor key={editor.id} editor={editor} boundaryMarker={boundaryMarker} />, document.body) : null}</>;
}

function ReplyEditor({ editor, boundaryMarker }: { editor: Editor; boundaryMarker: RefObject<HTMLSpanElement | null> }) {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const [busy, setBusy] = useState(false);
  const mobileInput = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const closing = useRef(false);
  const clearSourceHighlight = useRef<() => void>(() => {});
  const restoreComposer = useRef<() => void>(() => {});
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceActiveRef = useRef(false);
  const voiceAddPending = useRef(false);
  const voiceTranscript = useRef<string | null>(null);
  const [voiceAdding, setVoiceAdding] = useState(false);
  const voiceOpeningHeight = useRef(0);
  const voiceDockBottom = useRef<number | null>(null);
  const voiceMotionStarted = useRef(false);
  const voiceSettleTimer = useRef<number | undefined>(undefined);
  const keyboardClosedBottom = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const saving = useRef(false);
  const popup = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const resizeField = useRef<() => void>(() => {});
  const current = useRef(editor);
  current.current = editor;
  const canSend = composer.scope.kind === "thread" && !editor.target;
  async function animateClose(): Promise<void> {
    if (!mounted.current) return;
    closing.current = true;
    clearSourceHighlight.current();
    setBusy(true);
    const element = popup.current;
    if (!mobileInput || !element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Reveal the ordinary composer underneath before fading the reply away.
    // Keep focus until unmount: blurring now starts a second keyboard/layout transition.
    restoreComposer.current();
    element.style.transition = "none";
    element.style.top = `${element.getBoundingClientRect().top}px`;
    try {
      await element.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(6px)" }],
        { duration: 140, easing: "ease-out", fill: "forwards" },
      ).finished;
    } catch { /* Unmount or cancelled animation still permits closing. */ }
  }
  function dismiss(explicit = false): void {
    if (saving.current || closing.current || (voiceActiveRef.current && !explicit)) return;
    const value = current.current;
    clearSourceHighlight.current();
    if (!mobileInput || !popup.current?.animate) {
      updateEditor(composer.key, { ...value, open: false });
      return;
    }
    void animateClose().then(() => {
      const active = editors.get(composer.key);
      if (active?.id === value.id) updateEditor(composer.key, { ...active, open: false });
    });
  }
  useLayoutEffect(() => {
    const element = popup.current;
    const field = textarea.current;
    if (!element || !field) return;
    // Keep a stable opening position; only overflow pushes the top upwards.
    const openingHeight = element.offsetHeight;
    const viewport = window.visualViewport;
    const visible = () => ({
      left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
    });
    const mobile = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    let positionFrame: number | null = null;
    let openingTop = 12;
    function fitField(): void {
      if (!element || !field || closing.current) return;
      // The host swaps the textarea controls for its recorder. Do not measure
      // the hidden textarea or collapse the shell while the keyboard retreats.
      if (mobile && (voiceActiveRef.current || voiceDockBottom.current !== null)) {
        const view = visible();
        if (voiceDockBottom.current !== null) {
          if (view.top + view.height < voiceDockBottom.current - 2) return;
          voiceDockBottom.current = null;
        }
        element.style.top = `${Math.max(view.top + 12, view.top + view.height - element.offsetHeight - 12)}px`;
        return;
      }
      const fieldStyle = getComputedStyle(field);
      const lineHeight = Number.parseFloat(fieldStyle.lineHeight) || 21;
      const verticalPadding = (Number.parseFloat(fieldStyle.paddingTop) || 0) + (Number.parseFloat(fieldStyle.paddingBottom) || 0);
      const chromeHeight = element.offsetHeight - field.offsetHeight;
      const view = visible();
      const bottomBoundary = mobile ? view.top + view.height : Math.min(view.top + view.height, replyBottomBoundary(boundaryMarker.current, window.innerHeight));
      const available = bottomBoundary - view.top - chromeHeight - 24;
      const scrollTop = field.scrollTop;
      field.style.height = "0px";
      field.style.height = `${replyFieldHeight(field.scrollHeight - verticalPadding, lineHeight, available - verticalPadding) + verticalPadding}px`;
      field.scrollTop = scrollTop;
      element.style.top = `${mobile
        ? Math.max(view.top + 12, bottomBoundary - element.offsetHeight - 12)
        : view.top + growingPopupTop(openingTop - view.top, element.offsetHeight, bottomBoundary - view.top)}px`;
    }
    function position(event?: Event): void {
      if (!element || closing.current) return;
      // Scrolling the answer must not move its containing popup.
      if (event?.target instanceof Node && element.contains(event.target)) return;
      const view = visible();
      keyboardClosedBottom.current = Math.max(keyboardClosedBottom.current, view.top + view.height);
      if (mobile) {
        element.style.width = `${Math.max(0, view.width - 24)}px`;
        element.style.maxWidth = `${Math.max(0, view.width - 24)}px`;
        element.style.left = `${view.left + 12}px`;
        fitField();
        return;
      }
      const rect = editor.anchor.range?.getClientRects()[0] ?? editor.anchor.rect;
      element.style.maxWidth = `${Math.max(0, view.width - 24)}px`;
      const location = popupPosition({
        left: rect.left - view.left, right: rect.right - view.left,
        top: rect.top - view.top, bottom: rect.bottom - view.top,
      }, element.offsetWidth, openingHeight, view);
      element.style.left = `${view.left + location.left}px`;
      openingTop = view.top + location.top;
      element.style.top = `${openingTop}px`;
      fitField();
    }
    function schedulePosition(event: Event) {
      if (event.target instanceof Node && element?.contains(event.target)) return;
      if (positionFrame !== null) return;
      positionFrame = window.requestAnimationFrame(() => { positionFrame = null; position(); });
    }
    resizeField.current = fitField;
    position();
    const entrance = mobile && typeof element.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? element.animate(
          [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 240, easing: "cubic-bezier(.2,.7,.3,1)" },
        ) : null;
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    viewport?.addEventListener("resize", schedulePosition);
    viewport?.addEventListener("scroll", schedulePosition);
    // On phones the user chooses typing or dictation; opening must not summon the keyboard.
    if (!mobile) field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
    field.scrollTop = field.scrollHeight;
    return () => {
      entrance?.cancel?.();
      resizeField.current = () => {};
      if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
      viewport?.removeEventListener("resize", schedulePosition);
      viewport?.removeEventListener("scroll", schedulePosition);
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
    };
  }, [editor.anchor]);
  function beginVoiceMotion(): void {
    const element = popup.current;
    if (!mobileInput || !element || voiceMotionStarted.current) return;
    voiceMotionStarted.current = true;
    element.style.minHeight = `${voiceOpeningHeight.current || element.offsetHeight}px`;
    const bottom = Math.max(keyboardClosedBottom.current, window.innerHeight, document.documentElement.clientHeight);
    voiceDockBottom.current = bottom;
    element.style.transition = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "none" : "top 280ms cubic-bezier(.2,.7,.3,1)";
    element.getBoundingClientRect();
    element.style.top = `${Math.max(12, bottom - element.offsetHeight - 12)}px`;
    textarea.current?.blur();
    window.clearTimeout(voiceSettleTimer.current);
    voiceSettleTimer.current = window.setTimeout(() => {
      voiceDockBottom.current = null;
      if (!voiceActiveRef.current) {
        voiceMotionStarted.current = false;
        element.style.minHeight = "";
        element.style.transition = "";
      }
      resizeField.current();
    }, 400);
  }
  useEffect(() => () => { window.clearTimeout(voiceSettleTimer.current); }, []);
  useLayoutEffect(() => {
    const element = popup.current;
    if (mobileInput && element) {
      if (voiceActive) beginVoiceMotion();
      else {
        element.style.minHeight = "";
        element.style.transition = "";
        voiceOpeningHeight.current = 0;
        voiceDockBottom.current = null;
        voiceMotionStarted.current = false;
      }
    }
    resizeField.current();
  }, [voiceActive, mobileInput]);
  useLayoutEffect(() => { resizeField.current(); }, [editor.input.reply, error]);
  useEffect(() => {
    function outside(event: PointerEvent): void {
      if (window.matchMedia?.("(pointer: coarse)").matches) return;
      if (!popup.current?.contains(event.target as Node)) dismiss();
    }
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [composer.key]);
  useLayoutEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    // Keep the ordinary draft mounted, but expose only the quote input in this mode.
    for (let parent = boundaryMarker.current?.parentElement; parent; parent = parent.parentElement) {
      const boxes = parent.querySelectorAll<HTMLElement>("[data-promptbox]");
      if (boxes.length > 1) break;
      if (!boxes.length) continue;
      const box = boxes[0];
      const visibility = box.style.visibility;
      const inert = box.inert;
      box.style.visibility = "hidden";
      box.inert = true;
      // Keep the old surface visible only during its fade; the layout stays mounted.
      const fade = typeof box.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? box.animate(
            [{ opacity: 1, visibility: "visible" }, { opacity: 0, visibility: "visible" }],
            { duration: 180, easing: "ease-out" },
          ) : null;
      const restore = () => { fade?.cancel?.(); box.style.visibility = visibility; box.inert = inert; };
      restoreComposer.current = restore;
      return () => { restore(); restoreComposer.current = () => {}; };
    }
  }, [boundaryMarker]);
  useEffect(() => {
    // CSS Highlights retain the source emphasis after the textarea takes focus.
    if (!editor.anchor.range || typeof Highlight === "undefined" || !CSS.highlights) return;
    const name = `qr-source-${composer.key.replace(/[^a-z0-9-]/gi, "-")}`;
    CSS.highlights.set(name, new Highlight(editor.anchor.range));
    const style = document.createElement("style");
    style.textContent = `::highlight(${name}) { background: #b8d8ff; color: #222; }`;
    document.head.append(style);
    const clear = () => {
      CSS.highlights.delete(name);
      style.remove();
      const selection = window.getSelection();
      const source = editor.anchor.range;
      if (source && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (range.startContainer === source.startContainer && range.startOffset === source.startOffset &&
            range.endContainer === source.endContainer && range.endOffset === source.endOffset) selection.removeAllRanges();
      }
    };
    clearSourceHighlight.current = clear;
    return () => { clear(); clearSourceHighlight.current = () => {}; };
  }, [composer.key, editor.anchor]);

  async function save(send = false, reply?: string): Promise<void> {
    if (saving.current || closing.current || voiceActiveRef.current || (send && !canSend)) return;
    const composerKey = composer.key;
    const scopeIdentity = JSON.stringify(composer.scope);
    const parsed = quoteInputSchema.safeParse(reply === undefined ? editor.input : { ...current.current.input, reply });
    if (!parsed.success) { setError("Добавьте ответ. Цитата и ответ — до 40 000 символов каждый."); return; }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await rpc.call("create", parsed.data);
      if (composer.key !== composerKey || JSON.stringify(composer.scope) !== scopeIdentity) throw new Error("Поле ввода изменилось. Откройте цитату заново.");
      const label = `Ответ: ${preview(saved.reply, 36)}`;
      if (send && composer.scope.kind === "thread") {
        const text = `@${label}`;
        await sdk.threads.send({
          threadId: composer.scope.threadId, mode: "steer-if-active",
          input: [{ type: "text", text, mentions: [{ start: 0, end: text.length, resource: {
            kind: "plugin", pluginId, itemId: `${PROVIDER}:${saved.id}`, label,
          } }] }],
          model: composer.selection?.model ?? undefined,
          reasoningLevel: composer.selection?.reasoningLevel ?? undefined,
          serviceTier: composer.selection?.serviceTier ?? undefined,
          permissionMode: composer.selection?.permissionMode ?? undefined,
        });
      } else if (editor.target) composer.replace(draft => replaceQuoteMention(draft, editor.target!, { id: saved.id, label }));
      else {
        const lastMention = composer.draft.mentions.at(-1);
        const followsCard = lastMention?.kind === "plugin" && lastMention.pluginId === pluginId &&
          lastMention.provider === PROVIDER && !composer.draft.text.slice(lastMention.to).trim();
        const mention = { provider: PROVIDER, id: saved.id, label };
        composer.insert(followsCard ? [" ", mention] : mention, { at: "end", block: !followsCard });
      }
      await animateClose();
      if (editors.get(composer.key)?.id === editor.id) updateEditor(composer.key);
      if (mounted.current && !mobileInput) composer.focus();
    } catch (cause) { if (mounted.current) setError(errorText(cause)); else reportActionError(composerKey, errorText(cause)); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  const addLabel = editor.target ? "Сохранить" : "Добавить в строку";
  return <div ref={popup} className="qr-floating" role="dialog" aria-label="Ответ на цитату"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onFocus={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    }}>
    <button type="button" className="qr-close-editor" aria-label="Закрыть ответ" disabled={busy} onPointerDown={event => { if (mobileInput) event.preventDefault(); }} onClick={() => dismiss(true)}>×</button>
    <blockquote className="qr-excerpt" title={editor.input.quote}>{editor.input.quote}</blockquote>
    <div className="qr-input" data-voice-active={voiceActive} onClickCapture={event => {
      if (!mobileInput || voiceActiveRef.current || !(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (button?.getAttribute("aria-label") === "Start voice input") beginVoiceMotion();
    }} onPointerDownCapture={event => {
      if (!mobileInput || voiceActiveRef.current || !(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (button?.getAttribute("aria-label") !== "Start voice input") return;
      voiceOpeningHeight.current = popup.current?.offsetHeight ?? 0;
      // Preserve focus until the SDK has actually entered recording mode.
      // The click still reaches the native microphone control.
      event.preventDefault();
    }}>
    <VoiceInputTextarea ref={textarea} aria-label="Ваш ответ" value={editor.input.reply} disabled={busy && !mobileInput} readOnly={busy || voiceAdding} aria-busy={busy}
      placeholder="Ответить…" maxLength={40_000} rows={1}
      onValueChange={reply => {
        if (!mounted.current || saving.current || closing.current) return;
        if (voiceAddPending.current && reply !== current.current.input.reply) voiceTranscript.current = reply;
        updateEditor(composer.key, { ...current.current, input: { ...current.current.input, reply } });
      }}
      onVoiceInputActiveChange={active => {
        voiceActiveRef.current = active;
        if (!mounted.current) return;
        setVoiceActive(active);
        if (active) setMenu(false);
        else {
          const reply = voiceTranscript.current;
          const shouldAdd = voiceAddPending.current && reply !== null;
          voiceAddPending.current = false;
          voiceTranscript.current = null;
          setVoiceAdding(false);
          if (shouldAdd) void save(false, reply!);
        }
      }}
      onKeyDown={event => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.shiftKey) return;
        // Phone keyboards use Enter for a newline; explicit buttons own submission.
        if (window.matchMedia?.("(pointer: coarse)").matches) {
          event.stopPropagation();
          return;
        }
        event.preventDefault(); event.stopPropagation(); void save(event.metaKey || event.ctrlKey);
      }} />
    {mobileInput && voiceActive && <NativeVoiceAdd root={popup} pending={voiceAdding} onBeforeStop={() => {
      voiceAddPending.current = true;
      voiceTranscript.current = null;
      setVoiceAdding(true);
      if (textarea.current) textarea.current.readOnly = true;
    }} />}
    {!voiceActive && <div className="qr-footer" onMouseEnter={() => { if (!mobileInput) setMenu(true); }} onMouseLeave={() => setMenu(false)}>
      {!mobileInput && menu && <div className="qr-action-menu" role="group" aria-label="Действия с ответом">
        <button type="button" disabled={busy || voiceActive || !editor.input.reply.trim()} onClick={() => void save()}>{addLabel}<kbd>↵</kbd></button>
        {canSend && <button type="button" disabled={busy || voiceActive || !editor.input.reply.trim()} onClick={() => void save(true)}>Отправить ответ<kbd>⌘ ↵</kbd></button>}
      </div>}
      <button type="button" className="qr-add" aria-label={addLabel} aria-description={mobileInput ? undefined : "Enter — добавить в строку. Command или Control + Enter — отправить ответ."}
        disabled={busy || voiceActive || !editor.input.reply.trim()} onFocus={() => { if (!mobileInput) setMenu(true); }} onPointerDown={event => { if (mobileInput) event.preventDefault(); }} onClick={() => void save()}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M15 18H9l-4 3v-5a8 8 0 1 1 15-4"/><path d="M18 14v8m-4-4h8"/></svg>
      </button>
    </div>}
    </div>
    {error && <div role="alert" className="qr-error">{error}</div>}
  </div>;
}
export function InlineReplyCards() {
  const composer = useComposer();
  const pluginId = experimental_usePluginId();
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (anchor.current) return bindInlineCards(anchor.current, pluginId);
  }, [composer.key, pluginId]);
  return <span ref={anchor} hidden />;
}

export function SentReplySummaries() {
  const pluginId = experimental_usePluginId();
  const [targets, setTargets] = useState<SentQuoteTarget[]>([]);
  useEffect(() => observeSentQuotes(pluginId, setTargets), [pluginId]);
  return <>{targets.map(target => createPortal(<ReplyCards sentMentions={target.mentions} />, target.element))}</>;
}

export function ReplyCards({ sentMentions }: { sentMentions?: QuoteMention[] } = {}) {
  const composer = useComposer();
  const pluginId = experimental_usePluginId();
  const mentions = sentMentions ?? quoteMentions(composer.draft, pluginId);
  const readOnly = sentMentions !== undefined;
  const [open, setOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [position, setPosition] = useState<React.CSSProperties>({left: 12, bottom: 12, maxHeight: 280});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  function show() {
    cancelClose();
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 392)),
      ...(rect.top >= 180 ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(280, rect.top - 18) } : { top: rect.bottom + 6, maxHeight: Math.max(80, Math.min(280, window.innerHeight - rect.bottom - 18)) }),
    });
    setOpen(true);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  function removeAll() {
    cancelClose();
    try {
      composer.replace(draft => quoteMentions(draft, pluginId)
        .sort((a, b) => b.from - a.from)
        .reduce((next, mention) => replaceQuoteMention(next, mention), draft));
      setOpen(false);
    } catch (cause) { setRemoveError(errorText(cause)); show(); }
  }
  const count = mentions.length;
  useEffect(() => { if (!count) setOpen(false); }, [count]);
  const noun = count % 10 === 1 && count % 100 !== 11 ? "цитата" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "цитаты" : "цитат";
  return count ? <div className={`qr-summary${readOnly ? " qr-summary-readonly" : ""}`} onMouseEnter={() => { cancelClose(); if (!open) timer.current = setTimeout(show, 180); }} onMouseLeave={() => { cancelClose(); timer.current = setTimeout(() => setOpen(false), 220); }}>
    <button ref={trigger} type="button" className="qr-summary-trigger" aria-expanded={open} aria-haspopup="dialog"
      onClick={() => open ? setOpen(false) : show()} onKeyDown={event => { if (event.key === "ArrowUp") { event.preventDefault(); show(); } }}>
      <span aria-hidden="true">❞</span> {count} {noun}
    </button>
    {!readOnly && <button type="button" className="qr-summary-clear" aria-label="Удалить все цитаты" title="Удалить все цитаты" onClick={removeAll}>
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6"/></svg>
    </button>}
    {open && createPortal(<div ref={panel} className="qr-summary-panel" role="dialog" aria-label="Ответы на цитаты"
      style={position} onMouseEnter={cancelClose}>
      {removeError && <div role="alert" className="qr-error">{removeError}</div>}
      {mentions.map((mention, index) => <ReplyCard key={`${mention.id}:${mention.from}`} mention={mention} index={index + 1} readOnly={readOnly} onEdit={() => setOpen(false)} />)}
    </div>, document.body)}
  </div> : null;
}

function ReplyCard({ mention, index, onEdit, readOnly }: { mention: QuoteMention; index: number; onEdit: () => void; readOnly: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const [quote, setQuote] = useState<QuoteInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    rpc.call("get", { id: mention.id }).then(result => {
      if (active) { const { id: _id, ...input } = result; setQuote(input); }
    }, cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [rpc, mention.id, attempt]);
  function remove(): void {
    try { composer.replace(draft => replaceQuoteMention(draft, mention)); }
    catch (cause) { setError(errorText(cause)); }
  }
  return <div className="qr-list-item">
    <span className="qr-list-number">{index}.</span>
    <div className="qr-list-content">
      <div className="qr-list-label">Выделенный текст:</div>
      <div className="qr-list-text">{quote?.quote ?? (error ? "Не удалось загрузить цитату" : "Загрузка…")}</div>
      {quote && <><div className="qr-list-label">Ваш ответ:</div><div className="qr-list-text">{quote.reply}</div></>}
      {error && <div role="alert" className="qr-error">{error}</div>}
      {error && <button type="button" onClick={() => setAttempt(attempt + 1)}>Повторить загрузку</button>}
    </div>
    {!readOnly && <div className="qr-list-actions">
      <button type="button" disabled={!quote} aria-label={quote ? `Редактировать ответ: ${quote.reply}` : "Загрузка цитаты"} title="Редактировать"
        onClick={event => { if (quote) { openEditor(composer, { input: quote, target: mention, anchor: { rect: event.currentTarget.getBoundingClientRect() } }); onEdit(); } }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m15 5 4 4M4 20l1-5L16 4a2.8 2.8 0 0 1 4 4L9 19Z"/></svg>
      </button>
      <button type="button" aria-label="Удалить ответ на цитату" title="Удалить" onClick={remove}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>
      </button>
    </div>}
  </div>;
}

export default definePluginApp(app => {
  app.slots.messageAction({
    id: "reply", title: "Ответить", icon: "Quote",
    run: ({ message, selectedText, composer }) => {
      if (!composer) { reportActionError("*", "Поле ввода недоступно."); return; }
      const quote = selectedText ?? message.text;
      if (!quote.trim()) return;
      if (quote.length > 40_000) { reportActionError(composer.key, "Выделите фрагмент до 40 000 символов."); return; }
      openEditor(composer, { anchor: captureReplyAnchor(selectedText), input: {
        threadId: message.threadId, messageId: message.id,
        messageSeq: message.experimental_messageSeq ?? null, quote, reply: "",
      } });
    },
  });
  app.contentScripts.register({ id: "inline-replies", mount: mountInlineCards });
  app.contentScripts.register({ id: "mobile-reply", mount: () => mountMobileReply((composer, input, anchor) => flushSync(() => openEditor(composer, { input, anchor }))) });
  app.contentScripts.register({ id: "selection-anchor", mount: mountSelectionCapture });
  app.contentScripts.register({ id: "selection-menu", mount: mountSelectionMenu });
  app.composer.customize({
    id: "quote-replies",
    banners: [{ id: "reply-editor", chrome: "bare", component: () => <><InlineReplyCards /><ReplyPopup /><ReplyCards /><SentReplySummaries /></> }],
  });
});
