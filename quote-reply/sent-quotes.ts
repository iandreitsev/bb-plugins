/** Presentation-only adapter for immutable mentions in message history. */
import { experimental_readPromptMentionClipboard } from "@get-bb/plugin-sdk/app";
import { PROVIDER, type QuoteMention } from "./quotes";

export type SentQuoteTarget = { element: HTMLElement; mentions: QuoteMention[] };
function createSentQuoteObserver(pluginId: string, update: (targets: SentQuoteTarget[]) => void): () => void {
  let targets: SentQuoteTarget[] = [];
  let pending = false;
  let disposed = false;
  const owned = new Set<HTMLElement>();
  function reconcile() {
    pending = false;
    if (disposed) return;
    const groups = new Map<HTMLElement, { pill: HTMLElement; mention: QuoteMention }[]>();
    for (const pill of document.querySelectorAll<HTMLElement>("[data-prompt-mention]")) {
      if (pill.closest("[data-promptbox], [contenteditable=true]")) continue;
      const body = pill.closest<HTMLElement>("[data-markdown-preview]");
      if (!body || !body.closest('[class~="group/message"]')) continue;
      const parsed = experimental_readPromptMentionClipboard(pill)?.mention;
      if (parsed?.kind !== "plugin" || parsed.pluginId !== pluginId || parsed.provider !== PROVIDER) continue;
      const entries = groups.get(body) ?? [];
      entries.push({ pill, mention: { ...parsed, from: entries.length, to: entries.length + 1 } });
      groups.set(body, entries);
    }
    const next: SentQuoteTarget[] = [];
    const active = new Set<HTMLElement>();
    for (const [body, entries] of groups) {
      let target = targets.find(t => t.element.parentElement === body);
      if (!target) {
        // Another composer instance may already own this message.
        if (body.querySelector(":scope > .qr-sent-anchor")) continue;
        const element = document.createElement("div");
        element.className = "qr-sent-anchor";
        body.prepend(element);
        target = { element, mentions: [] };
      }
      for (const {pill} of entries) { pill.setAttribute("data-qr-sent-hidden", ""); owned.add(pill); active.add(pill); }
      const mentions = entries.map(e => e.mention);
      next.push(JSON.stringify(target.mentions) === JSON.stringify(mentions) ? target : { ...target, mentions });
    }
    for (const pill of owned) if (!active.has(pill)) { pill.removeAttribute("data-qr-sent-hidden"); owned.delete(pill); }
    for (const target of targets) if (!next.some(t => t.element === target.element)) target.element.remove();
    if (next.length !== targets.length || next.some((t,i) => t !== targets[i])) { targets = next; update(targets); }
  }
  const observer = new MutationObserver(() => {
    if (!pending) { pending = true; queueMicrotask(reconcile); }
  });
  observer.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:["data-prompt-mention-resource"]});
  reconcile();
  return () => {
    disposed = true; observer.disconnect();
    for (const target of targets) target.element.remove();
    for (const pill of owned) pill.removeAttribute("data-qr-sent-hidden");
  };
}

// One document observer and one portal owner per plugin, even with split chats.
const shared = new Map<string, { listeners: Set<(targets: SentQuoteTarget[]) => void>; targets: SentQuoteTarget[]; dispose: () => void }>();
export function observeSentQuotes(pluginId: string, update: (targets: SentQuoteTarget[]) => void): () => void {
  let entry = shared.get(pluginId);
  if (!entry) {
    entry = { listeners: new Set(), targets: [], dispose: () => {} };
    shared.set(pluginId, entry);
    const current = entry;
    entry.dispose = createSentQuoteObserver(pluginId, targets => {
      current.targets = targets;
      current.listeners.values().next().value?.(targets);
    });
  }
  const current = entry;
  current.listeners.add(update);
  update(current.listeners.values().next().value === update ? current.targets : []);
  return () => {
    const wasOwner = current.listeners.values().next().value === update;
    current.listeners.delete(update);
    if (!current.listeners.size) { current.dispose(); shared.delete(pluginId); }
    else if (wasOwner) current.listeners.values().next().value?.(current.targets);
  };
}
