// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { experimental_promptMentionClipboardAttributes } from "@get-bb/plugin-sdk/app";
import plugin from "../app";
import { bindInlineCards, mountInlineCards } from "../inline-cards";
const cleanups: (()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();document.body.replaceChildren();});
it("decorates only this composer's own pills and cleans up on disable",async()=>{
 await loadPluginApp(plugin);
 document.body.innerHTML='<section><div><span id="anchor"></span></div><form data-promptbox><span id="pill" data-prompt-mention></span></form></section><form data-promptbox><span id="other" data-prompt-mention></span></form>';
 const pill=document.getElementById("pill")!;
 function attributes(id:string){
  for(const [name,value] of Object.entries(experimental_promptMentionClipboardAttributes({kind:"plugin",pluginId:"quote-reply",provider:"replies",id,label:"Reply"},"@Reply")))pill.setAttribute(name,value);
 }
 attributes("first");
 cleanups.push(mountInlineCards());
 cleanups.push(bindInlineCards(document.getElementById("anchor")! ,"quote-reply"));
 await waitFor(()=>expect(pill.hasAttribute("data-qr-decorated")).toBe(true));
 expect(pill.hasAttribute("data-qr-decorated")).toBe(true);
 expect(document.getElementById("other")!.children).toHaveLength(0);
 attributes("second");
 pill.setAttribute("data-prompt-mention-resource","updated");
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(pill.hasAttribute("data-qr-decorated")).toBe(true);
 expect(pill.querySelectorAll(".qr-inline-portal")).toHaveLength(0);
 cleanups.pop()!();
 expect(pill.hasAttribute("data-qr-decorated")).toBe(false);
 expect(pill.querySelectorAll(".qr-inline-portal")).toHaveLength(0);
});
