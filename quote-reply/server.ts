/** Stores immutable replies and resolves native mention pills into agent-visible context. */
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { agentContext, PROVIDER, quoteInputSchema, quoteSchema, type Quote } from "./quotes";

export const rpcContract = defineRpcContract({
  create: { input: quoteInputSchema, output: quoteSchema },
  get: { input: z.object({ id: z.string().uuid() }).strict(), output: quoteSchema },
});

export default function plugin(bb: BbPluginApi): void {
  async function get(id: string): Promise<Quote> {
    z.string().uuid().parse(id);
    const stored = await bb.storage.kv.get(`reply:${id}`);
    if (!stored) throw new Error("Цитата не найдена. Удалите карточку и добавьте ответ заново.");
    return quoteSchema.parse(stored);
  }
  bb.rpc.register(rpcContract, {
    create: async input => {
      const quote = quoteSchema.parse({ ...input, id: randomUUID() });
      if (Buffer.byteLength(JSON.stringify(quote), "utf8") > 256 * 1024) throw new Error("Цитата и ответ слишком велики для сохранения. Сократите текст.");
      await bb.storage.kv.set(`reply:${quote.id}`, quote);
      bb.log.info(`Quote reply saved id=${quote.id} threadId=${quote.threadId}`);
      return quote;
    },
    get: ({ id }) => get(id),
  });
  bb.ui.registerMentionProvider({
    id: PROVIDER,
    label: "Ответы на цитаты",
    search: () => [],
    resolve: async id => {
      const quote = await get(id);
      bb.log.info(`Quote reply resolved id=${id}`);
      return { context: agentContext(quote) };
    },
  });
}
