// @vitest-environment jsdom
import { expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { experimental_promptMentionClipboardAttributes } from "@get-bb/plugin-sdk/app";
import plugin from "../app";
import { observeSentQuotes, type SentQuoteTarget } from "../sent-quotes";
it("groups history mentions by message, updates and restores original pills", async () => {
 await loadPluginApp(plugin);
 document.body.innerHTML='<div class="group/message"><div data-markdown-preview id="body">Main text</div></div><form data-promptbox><div data-markdown-preview id="draft"></div></form>';
 function pill(parent: string, id: string) {
  const el=document.createElement("span");
  el.setAttribute("data-prompt-mention","");
  for(const [key,value] of Object.entries(experimental_promptMentionClipboardAttributes({kind:"plugin",pluginId:"quote-reply",provider:"replies",id,label:id},id)))el.setAttribute(key,value);
  document.getElementById(parent)!.append(el);
  return el;
 }
 const first=pill("body","one"); const second=pill("body","two"); const draft=pill("draft","draft");
 let targets:SentQuoteTarget[]=[];
 const dispose=observeSentQuotes("quote-reply",next=>targets=next);
 let secondary:SentQuoteTarget[]=[];
 const disposeSecondary=observeSentQuotes("quote-reply",next=>secondary=next);
 expect(secondary).toHaveLength(0);
 try {
  expect(targets).toHaveLength(1);
  expect(targets[0].mentions.map(m=>m.id)).toEqual(["one","two"]);
  expect(first.hasAttribute("data-qr-sent-hidden")).toBe(true);
  expect(draft.hasAttribute("data-qr-sent-hidden")).toBe(false);
  second.remove();
  await waitFor(()=>expect(targets[0].mentions).toHaveLength(1));
  expect(document.getElementById("body")!.textContent).toContain("Main text");
 } finally {dispose();}
 expect(secondary).toHaveLength(1);
 expect(document.querySelectorAll(".qr-sent-anchor")).toHaveLength(1);
 disposeSecondary();
 expect(first.hasAttribute("data-qr-sent-hidden")).toBe(false);
 expect(document.querySelector(".qr-sent-anchor")).toBeNull();
 document.body.replaceChildren();
});
