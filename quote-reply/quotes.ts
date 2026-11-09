/** Immutable quote replies: old queued and sent messages keep their original answer. */
import { z } from "zod";
import type { ComposerDraft, ComposerDraftSnapshot, ComposerMention } from "@get-bb/plugin-sdk";

export const PROVIDER = "replies";
export const quoteInputSchema = z.object({
  threadId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(200),
  messageSeq: z.number().int().nonnegative().nullable(),
  quote: z.string().min(1).max(40_000).refine(text => text.trim().length > 0),
  reply: z.string().trim().min(1).max(40_000),
}).strict();
export const quoteSchema = quoteInputSchema.extend({ id: z.string().uuid() });
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteMention = Extract<ComposerMention, { kind: "plugin" }>;

export function quoteMentions(draft: ComposerDraft, pluginId: string): QuoteMention[] {
  return draft.mentions.filter((mention): mention is QuoteMention =>
    mention.kind === "plugin" && mention.pluginId === pluginId && mention.provider === PROVIDER);
}

export function preview(text: string, length = 60): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

export function agentContext(quote: Quote): string {
  // JSON keeps quotes and answers unambiguous even when they contain Markdown/XML.
  return `The user is replying to a specific excerpt. The quoted excerpt is context; the reply is the user's current message.\n${JSON.stringify({
    sourceThreadId: quote.threadId,
    sourceMessageId: quote.messageId,
    sourceMessageSeq: quote.messageSeq,
    quotedExcerpt: quote.quote,
    userReply: quote.reply,
  }, null, 2)}`;
}

/** Adjust all later mention ranges while preserving text, attachments and unrelated pills. */
export function replaceQuoteMention(draft: ComposerDraftSnapshot, target: QuoteMention, replacement?: { id: string; label: string }): ComposerDraftSnapshot {
  const current = draft.mentions.find(mention => mention.kind === "plugin" &&
    mention.pluginId === target.pluginId && mention.provider === target.provider &&
    mention.id === target.id && mention.from === target.from && mention.to === target.to);
  if (!current) throw new Error("Карточка уже изменена или удалена. Откройте её заново.");
  const text = replacement ? `@${replacement.label}` : "";
  const delta = text.length - (target.to - target.from);
  return {
    ...draft,
    text: draft.text.slice(0, target.from) + text + draft.text.slice(target.to),
    mentions: draft.mentions.flatMap(mention => {
      if (mention === current) return replacement ? [{ ...target, id: replacement.id, label: replacement.label, to: target.from + text.length }] : [];
      return [{ ...mention, from: mention.from >= target.to ? mention.from + delta : mention.from,
        to: mention.to >= target.to ? mention.to + delta : mention.to }];
    }),
  };
}
