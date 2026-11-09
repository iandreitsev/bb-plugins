import type { PluginComposerApi } from "@get-bb/plugin-sdk";
import type { QuoteInput } from "./quotes";
import type { ReplyAnchor } from "./selection-anchor";

export const MOBILE_REPLY_EVENT = "bb-quote-reply:open-v1";
const composers = new Set<PluginComposerApi>();

/** Use this plugin's mounted handle, not a handle supplied by another plugin. */
export function registerReplyComposer(composer: PluginComposerApi): () => void {
  composers.add(composer);
  return () => { composers.delete(composer); };
}

export function mountMobileReply(open: (composer: PluginComposerApi, input: QuoteInput, anchor: ReplyAnchor) => void) {
  function receive(event: Event) {
    if (!(event instanceof CustomEvent) || !event.cancelable) return;
    const value = event.detail;
    if (!value || typeof value !== "object" || typeof value.threadId !== "string" ||
        typeof value.messageId !== "string" || !value.messageId || value.messageId.length > 200 ||
        typeof value.text !== "string" || !value.text.trim() || value.text.length > 40_000 ||
        !value.rect || !["left","right","top","bottom"].every(key => Number.isFinite(value.rect[key]))) return;
    if (value.composer && value.composer.scope?.threadId !== value.threadId) return;
    const candidates = [...composers].filter(c => c.scope.kind === "thread" && c.scope.threadId === value.threadId);
    const exact = candidates.filter(c => c.key === value.composer?.key);
    const matches = exact.length === 1 ? exact : candidates;
    if (matches.length !== 1) return; // No mounted surface or ambiguous split panes: retain the caller's fallback.
    const range = value.range instanceof Range && value.range.startContainer.isConnected && value.range.endContainer.isConnected
      ? value.range.cloneRange() : undefined;
    open(matches[0], {
      threadId: value.threadId, messageId: value.messageId, messageSeq: null, quote: value.text, reply: "",
    }, { rect: value.rect, range });
    event.preventDefault();
  }
  document.addEventListener(MOBILE_REPLY_EVENT, receive);
  return () => document.removeEventListener(MOBILE_REPLY_EVENT, receive);
}
