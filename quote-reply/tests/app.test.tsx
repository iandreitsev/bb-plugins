// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { experimental_makePanelController } from "@get-bb/plugin-sdk/testing";
import { useComposer } from "@get-bb/plugin-sdk/app";
import plugin, { ReplyCards, ReplyPopup } from "../app";
const saved={id:"36b45399-d190-4db9-9387-e9f612d10f60",threadId:"t",messageId:"m",messageSeq:7,quote:"Exact\nexcerpt",reply:"My reply"};
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(cleanup);
async function setup(fail=false, draft=""){
 const app=await loadPluginApp(plugin);
 function Surface(){
  const composer=useComposer();
  return <><button onClick={()=>app.messageActions[0].run({threadId:"t",message:{id:"m",threadId:"t",role:"assistant",text:"whole message",sourceSeqEnd:7,experimental_messageSeq:7},selectedText:"Exact\nexcerpt",composer,experimental_panel:experimental_makePanelController()})}>Select excerpt</button><button onClick={()=>app.messageActions[0].run({threadId:"t",message:{id:"m2",threadId:"t",role:"assistant",text:"Second excerpt",sourceSeqEnd:8,experimental_messageSeq:8},selectedText:"Second excerpt",composer,experimental_panel:experimental_makePanelController()})}>Select second</button><ReplyPopup/><ReplyCards/></>;
 }
 const create=vi.fn(async(input:unknown)=>{if(fail)throw new Error("Storage unavailable");return {...saved,...input as object};});
 const send=vi.fn(async(_request: unknown)=>({ok:true as const,delivery:"sent" as const}));
 const slot=renderSlot({component:Surface},{}, {pluginId:"quote-reply",composer:{text:draft,scope:{kind:"thread",threadId:crypto.randomUUID()}},rpc:{create,get:()=>saved},sdk:{threads:{send}}});
 return {slot,create,send};
}
it("adds exact selection, edits the answer and removes the card",async()=>{
 const {slot,create}=await setup();
 fireEvent.click(slot.getByText("Select excerpt"));
 expect(document.querySelector("blockquote")?.textContent).toBe("Exact\nexcerpt");
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"My reply"}});
 fireEvent.click(slot.getByRole("button",{name:"Добавить в строку"}));
 await waitFor(()=>expect(slot.inspection.composer.draft.mentions).toHaveLength(1));
 expect(create.mock.calls[0][0]).toMatchObject({quote:"Exact\nexcerpt",reply:"My reply"});
 fireEvent.click(slot.getByRole("button",{name:"1 цитата"}));
 fireEvent.click(await slot.findByRole("button",{name:"Редактировать ответ: My reply"}));
 expect(slot.getByRole("textbox")).toHaveProperty("selectionStart",saved.reply.length);
 expect(slot.getByRole("textbox")).toHaveProperty("selectionEnd",saved.reply.length);
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Edited reply"}});
 fireEvent.click(slot.getByRole("button",{name:"Сохранить"}));
 await waitFor(()=>expect(create).toHaveBeenCalledTimes(2));
 expect(create.mock.calls[1][0]).not.toHaveProperty("id");
 await waitFor(()=>expect(slot.queryByRole("button",{name:"Сохранить"})).toBeNull());
 fireEvent.mouseEnter(slot.getByRole("button",{name:"1 цитата"}));
 fireEvent.click(await slot.findByRole("button",{name:"Удалить ответ на цитату"}));
 expect(slot.inspection.composer.draft.mentions).toHaveLength(0);
});
it("keeps the typed reply and draft intact if saving fails",async()=>{
 const {slot}=await setup(true);
 fireEvent.click(slot.getByText("Select excerpt"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Keep this reply"}});
 fireEvent.click(slot.getByRole("button",{name:"Добавить в строку"}));
 expect(await slot.findByRole("alert")).toHaveProperty("textContent","Storage unavailable");
 expect(slot.getByRole("textbox")).toHaveProperty("value","Keep this reply");
 expect(slot.inspection.composer.draft.mentions).toHaveLength(0);
});

it("sends only the reply with Cmd+Enter and preserves an existing composer draft",async()=>{
 const {slot,send}=await setup(false,"Unsent draft stays here");
 fireEvent.click(slot.getByText("Select excerpt"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Direct reply"}});
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter",metaKey:true});
 await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));
 const request=slot.inspection.sdkCalls.find(call=>call.method==="threads.send");
 expect(request).toBeTruthy();
 expect(send.mock.calls[0][0]).toMatchObject({mode:"steer-if-active",input:[{type:"text",mentions:[{resource:{kind:"plugin",pluginId:"quote-reply",itemId:`replies:${saved.id}`}}]}]});
 expect(slot.inspection.composer.text).toBe("Unsent draft stays here");
 expect(slot.inspection.composer.draft.mentions).toHaveLength(0);
});
it("Enter adds a card, Shift+Enter does not submit, Escape preserves the reply",async()=>{
 const {slot,create,send}=await setup();
 fireEvent.click(slot.getByText("Select excerpt"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Keep me"}});
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter",shiftKey:true});
 expect(create).not.toHaveBeenCalled();
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Escape"});
 expect(slot.queryByRole("dialog")).toBeNull();
 fireEvent.click(slot.getByText("Select excerpt"));
 expect(slot.getByRole("textbox")).toHaveProperty("value","Keep me");
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter"});
 await waitFor(()=>expect(slot.inspection.composer.draft.mentions).toHaveLength(1));
 expect(send).not.toHaveBeenCalled();
});
it("retains both reply and main draft when direct sending fails",async()=>{
 const {slot,send}=await setup(false,"Existing draft");
 send.mockRejectedValueOnce(new Error("Send failed"));
 fireEvent.click(slot.getByText("Select excerpt"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Do not lose this"}});
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter",ctrlKey:true});
 expect(await slot.findByRole("alert")).toHaveProperty("textContent","Send failed");
 expect(slot.getByRole("textbox")).toHaveProperty("value","Do not lose this");
 expect(slot.inspection.composer.text).toBe("Existing draft");
});
it("grows down first, then grows up against the bottom boundary without moving on internal scroll",async()=>{
 const height = vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockImplementation(function(this: HTMLElement) {
  if(this.classList.contains("qr-floating")) return 80 + (Number.parseFloat(this.querySelector("textarea")?.style.height ?? "") || 26);
  return Number.parseFloat(this.style.height) || 26;
 });
 const scroll = vi.spyOn(HTMLElement.prototype,"scrollHeight","get").mockImplementation(function(this: HTMLElement) {
  return this instanceof HTMLTextAreaElement ? this.value.split("\n").length * 21 : 0;
 });
 const viewport = vi.spyOn(window,"innerHeight","get").mockReturnValue(300);
 try {
  const {slot}=await setup();
  fireEvent.click(slot.getByText("Select excerpt"));
  const popup=slot.getByRole("dialog");
  const initialTop=popup.style.top;
  const field=slot.getByRole("textbox");
  fireEvent.change(field,{target:{value:"line\nline"}});
  expect(popup.style.top).toBe(initialTop);
  fireEvent.change(field,{target:{value:Array(13).fill("line").join("\n")}});
  fireEvent(window,new Event("resize"));
  expect(Number.parseFloat(popup.style.top)).toBeLessThan(Number.parseFloat(initialTop));
  expect(Number.parseFloat(popup.style.top) + popup.offsetHeight).toBe(288);
  const fieldStyle = getComputedStyle(field);
  expect(Number.parseFloat(field.style.height) - Number.parseFloat(fieldStyle.paddingTop) - Number.parseFloat(fieldStyle.paddingBottom)).toBe(168);
  expect(Number.parseFloat(field.style.height)).toBeLessThan(field.scrollHeight);
  const grownTop = popup.style.top;
  fireEvent.scroll(field);
  expect(popup.style.top).toBe(grownTop);
 } finally {height.mockRestore();scroll.mockRestore();viewport.mockRestore();}
});

it("groups replies in one counter and removes only the selected reply",async()=>{
 const {slot}=await setup(false,"Main draft");
 for (const reply of ["First", "Second"]) {
  fireEvent.click(slot.getByText("Select excerpt"));
  fireEvent.change(slot.getByRole("textbox"),{target:{value:reply}});
  fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter"});
  await waitFor(()=>expect(slot.queryByRole("dialog")).toBeNull());
 }
 expect(slot.getAllByRole("button",{name:"2 цитаты"})).toHaveLength(1);
 expect(slot.queryByText("Выделенный текст:")).toBeNull();
 fireEvent.click(slot.getByRole("button",{name:"2 цитаты"}));
 await waitFor(()=>expect(slot.getAllByText("Выделенный текст:")).toHaveLength(2));
 fireEvent.click(slot.getAllByRole("button",{name:"Удалить ответ на цитату"})[0]);
 expect(slot.getByRole("button",{name:"1 цитата"})).toBeTruthy();
 expect(slot.inspection.composer.text).toContain("Main draft");
 expect(slot.inspection.composer.draft.mentions).toHaveLength(1);
 fireEvent.keyDown(document,{key:"Escape"});
 expect(slot.queryByRole("dialog")).toBeNull();
 fireEvent.click(slot.getByRole("button",{name:"1 цитата"}));
 expect(slot.getByRole("dialog",{name:"Ответы на цитаты"})).toBeTruthy();
 fireEvent.pointerDown(document.body);
 expect(slot.queryByRole("dialog")).toBeNull();
});


it("removes all quotes together while keeping the main draft",async()=>{
 const {slot}=await setup(false,"Keep main text");
 for (const reply of ["One", "Two"]) {
  fireEvent.click(slot.getByText("Select excerpt"));
  fireEvent.change(slot.getByRole("textbox"),{target:{value:reply}});
  fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter"});
  await waitFor(()=>expect(slot.queryByRole("dialog")).toBeNull());
 }
 fireEvent.click(slot.getByRole("button",{name:"Удалить все цитаты"}));
 expect(slot.inspection.composer.draft.mentions).toHaveLength(0);
 expect(slot.inspection.composer.text).toContain("Keep main text");
 expect(slot.queryByRole("button",{name:"2 цитаты"})).toBeNull();
});

it("delays hover and cancels opening when the pointer leaves quickly",async()=>{
 const {slot}=await setup();
 fireEvent.click(slot.getByText("Select excerpt"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Reply"}});
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter"});
 await waitFor(()=>expect(slot.queryByRole("dialog")).toBeNull());
 const trigger=slot.getByRole("button",{name:"1 цитата"});
 fireEvent.mouseEnter(trigger);
 expect(slot.queryByRole("dialog")).toBeNull();
 fireEvent.mouseLeave(trigger);
 await new Promise(resolve=>setTimeout(resolve,250));
 expect(slot.queryByRole("dialog")).toBeNull();
 fireEvent.mouseEnter(trigger);
 expect(await slot.findByRole("dialog",{name:"Ответы на цитаты"})).toBeTruthy();
});

it("repositions the reply when the keyboard shifts and shrinks the visual viewport",async()=>{
 const viewport = Object.assign(new EventTarget(),{offsetLeft:60,offsetTop:90,width:320,height:340});
 vi.stubGlobal("visualViewport",viewport);
 const width=vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(296);
 const height=vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockImplementation(function(this:HTMLElement){
  return this.classList.contains("qr-floating") ? 100+(parseFloat(this.querySelector("textarea")?.style.height??"")||26) : parseFloat(this.style.height)||26;
 });
 try {
  const {slot}=await setup();
  fireEvent.click(slot.getByText("Select excerpt"));
  const popup=slot.getByRole("dialog");
  expect(parseFloat(popup.style.left)).toBeGreaterThanOrEqual(72);
  expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(102);
  expect(popup.style.maxWidth).toBe("296px");
  viewport.offsetLeft=110;viewport.offsetTop=130;viewport.width=280;viewport.height=240;
  viewport.dispatchEvent(new Event("resize"));
  await waitFor(()=>expect(parseFloat(popup.style.left)).toBeGreaterThanOrEqual(122));
  expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(142);
  await waitFor(()=>expect(popup.style.maxWidth).toBe("256px"));
  expect(parseFloat(popup.style.top)+popup.offsetHeight).toBeLessThanOrEqual(358);
 } finally {cleanup();width.mockRestore();height.mockRestore();vi.unstubAllGlobals();}
});

it("leaves mobile Enter available for a newline without adding or sending",async()=>{
 vi.stubGlobal("matchMedia",vi.fn(()=>({matches:true})));
 try {
  const {slot,create,send}=await setup();
  fireEvent.click(slot.getByText("Select excerpt"));
  fireEvent.change(slot.getByRole("textbox"),{target:{value:"First line"}});
  const allowed=fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter",cancelable:true});
  expect(allowed).toBe(true);
  expect(create).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(slot.getByRole("dialog")).toBeTruthy();
 } finally {cleanup();vi.unstubAllGlobals();}
});

it("keeps the mobile editor at the viewport bottom instead of following transcript scroll",async()=>{
 vi.stubGlobal("matchMedia",vi.fn(()=>({matches:true})));
 const viewport=Object.assign(new EventTarget(),{offsetLeft:0,offsetTop:0,width:390,height:430});
 vi.stubGlobal("visualViewport",viewport);
 const height=vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockImplementation(function(this:HTMLElement){
  return this.classList.contains("qr-floating")?100+(parseFloat(this.querySelector("textarea")?.style.height??"")||26):parseFloat(this.style.height)||26;
 });
 try{
  const {slot}=await setup();
  fireEvent.click(slot.getByText("Select excerpt"));
  const popup=slot.getByRole("dialog");
  const top=popup.style.top;
  expect(popup.style.left).toBe("12px");
  expect(parseFloat(top)+popup.offsetHeight).toBe(418);
  window.dispatchEvent(new Event("scroll"));
  await new Promise(r=>setTimeout(r,30));
  expect(popup.style.top).toBe(top);
  fireEvent.change(slot.getByRole("textbox"),{target:{value:"Keep draft"}});
  fireEvent.pointerDown(document.body);
  fireEvent.blur(slot.getByRole("textbox"));
  expect(slot.getByRole("dialog")).toBeTruthy();
  expect(slot.getByRole("textbox")).toHaveProperty("value","Keep draft");
  fireEvent.click(slot.getByRole("button",{name:"Закрыть ответ"}));
  expect(slot.queryByRole("dialog")).toBeNull();
  fireEvent.click(slot.getByText("Select excerpt"));
  expect(slot.getByRole("textbox")).toHaveProperty("value","Keep draft");
 }finally{cleanup();height.mockRestore();vi.unstubAllGlobals();}
});

it("never shows desktop action hints on touch hover or focus",async()=>{
 vi.stubGlobal("matchMedia",vi.fn(()=>({matches:true})));
 try {
  const {slot,create}=await setup();
  fireEvent.click(slot.getByText("Select excerpt"));
  fireEvent.change(slot.getByRole("textbox"),{target:{value:"Mobile reply"}});
  const add=slot.getByRole("button",{name:"Добавить в строку"});
  fireEvent.mouseEnter(add);
  fireEvent.focus(add);
  expect(slot.queryByRole("group",{name:"Действия с ответом"})).toBeNull();
  fireEvent.click(add);
  await waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
  await waitFor(()=>expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.composer.draft.mentions).toHaveLength(1);
 }finally{cleanup();vi.unstubAllGlobals();}
});


it("keeps mobile focus during saving and restores the composer before the exit finishes",async()=>{
 vi.stubGlobal("matchMedia",vi.fn((query:string)=>({matches:query === "(pointer: coarse)"})));
 const originalAnimate=HTMLElement.prototype.animate;
 let finishExit!:()=>void;
 let finishSave!:(value:typeof saved)=>void;
 HTMLElement.prototype.animate=vi.fn((_frames,options)=>({
  finished:typeof options === "object" && options.duration === 140
   ? new Promise<void>(resolve=>{finishExit=resolve;}) : Promise.resolve(),
 })) as unknown as typeof originalAnimate;
 try {
  const {slot,create}=await setup();
  const box=document.createElement("div");box.setAttribute("data-promptbox","");
  slot.getByText("Select excerpt").parentElement!.append(box);
  create.mockImplementationOnce(()=>new Promise(resolve=>{finishSave=resolve;}));
  fireEvent.click(slot.getByText("Select excerpt"));
  const field=slot.getByRole("textbox") as HTMLTextAreaElement;
  expect(document.activeElement).not.toBe(field);
  field.focus(); // Explicit tap to type, rather than automatic focus on opening.
  expect(document.activeElement).toBe(field);
  fireEvent.change(field,{target:{value:"My reply"}});
  expect(box.style.visibility).toBe("hidden");
  fireEvent.click(slot.getByRole("button",{name:"Добавить в строку"}));
  await waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
  expect(field.disabled).toBe(false);
  expect(document.activeElement).toBe(field);
  await act(async()=>{finishSave(saved);});
  expect(box.style.visibility).toBe("");
  expect(document.activeElement).toBe(field);
  expect(slot.queryByRole("dialog")).not.toBeNull();
  await act(async()=>{finishExit();});
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(box.style.visibility).toBe("");
  expect(slot.inspection.composer.draft.mentions).toHaveLength(1);
 }finally{cleanup();HTMLElement.prototype.animate=originalAnimate;vi.unstubAllGlobals();}
});

it("finishes an old save without freezing or closing the newly opened reply",async()=>{
 const {slot,create}=await setup();
 let resolveSave!:(value:typeof saved)=>void;
 create.mockImplementationOnce(()=>new Promise(resolve=>{resolveSave=resolve;}));
 fireEvent.click(slot.getByText("Select excerpt"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"My reply"}});
 fireEvent.click(slot.getByRole("button",{name:"Добавить в строку"}));
 await waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
 fireEvent.click(slot.getByText("Select second"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"New draft"}});
 await act(async()=>{resolveSave(saved);});
 expect(slot.inspection.composer.draft.mentions).toHaveLength(1);
 expect(slot.getByRole("textbox")).toHaveProperty("value","New draft");
 expect(slot.getByRole("textbox")).toHaveProperty("disabled",false);
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Still editable"}});
 expect(slot.getByRole("textbox")).toHaveProperty("value","Still editable");
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Escape"});
 expect(slot.queryByRole("dialog")).toBeNull();
});
