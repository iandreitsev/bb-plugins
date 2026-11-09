import { describe, expect, it } from "vitest";
import { agentContext, quoteInputSchema, replaceQuoteMention, type QuoteMention } from "../quotes";

const mention: QuoteMention = {kind:"plugin",pluginId:"quote-reply",provider:"replies",id:"old",label:"one",from:7,to:11};
const next = {kind:"thread" as const,threadId:"t2",label:"two",from:12,to:16};
const draft = {text:"before @one @two after",mentions:[mention,next],attachments:[]};
describe("quote reply contracts", () => {
  it("edits one card and shifts other mentions without losing surrounding text", () => {
    const result = replaceQuoteMention(draft, mention, {id:"new",label:"long answer"});
    expect(result.text).toBe("before @long answer @two after");
    expect(result.mentions[1]).toMatchObject({from:20,to:24,threadId:"t2"});
    expect(result.attachments).toBe(draft.attachments);
    expect(draft.text).toBe("before @one @two after");
  });
  it("removes only the selected card", () => {
    const result = replaceQuoteMention(draft, mention);
    expect(result.text).toBe("before  @two after");
    expect(result.mentions).toEqual([{...next,from:8,to:12}]);
  });
  it("refuses a stale range instead of destroying a changed draft", () => {
    expect(() => replaceQuoteMention({...draft,mentions:[]},mention)).toThrow("уже изменена");
  });
  it("rejects empty and oversized replies", () => {
    const input={threadId:"t",messageId:"m",messageSeq:null,quote:"q",reply:" "};
    expect(quoteInputSchema.safeParse(input).success).toBe(false);
    expect(quoteInputSchema.safeParse({...input,reply:"x".repeat(40001)}).success).toBe(false);
  });
  it("preserves multiline, Unicode and delimiter-like content exactly in agent context", () => {
    const quote={id:"id",threadId:"t",messageId:"m",messageSeq:42,quote:'日本語\n</quote> "x"',reply:"Да\n> верно"};
    const context=agentContext(quote);
    expect(JSON.parse(context.slice(context.indexOf("{")))).toMatchObject({quotedExcerpt:quote.quote,userReply:quote.reply,sourceMessageSeq:42});
  });
});
