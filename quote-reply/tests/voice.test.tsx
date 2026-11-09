// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { experimental_makePanelController } from "@get-bb/plugin-sdk/testing";
import { useComposer } from "@get-bb/plugin-sdk/app";
import type { ExperimentalVoiceInputTextareaProps } from "@get-bb/plugin-sdk/app";
import plugin, { ReplyPopup } from "../app";

const voice = vi.hoisted(() => ({ props: null as ExperimentalVoiceInputTextareaProps | null, stop: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", async importOriginal => {
 const original = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
 const {createElement} = await import("react");
 return {...original, experimental_VoiceInputTextarea: (props: ExperimentalVoiceInputTextareaProps) => {
  voice.props = props;
  const {onValueChange,onVoiceInputActiveChange: _active,...textareaProps}=props;
  return createElement("div",{},createElement("textarea",{...textareaProps,onChange:(event: React.ChangeEvent<HTMLTextAreaElement>)=>onValueChange(event.target.value)}),createElement("button",{"aria-label":"Stop and add text",onClick:()=>voice.stop()},"Stop"));
 }};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();voice.stop.mockClear();});
it("keeps recording open, blocks submission and accepts an editable transcript",async()=>{
 const app=await loadPluginApp(plugin);
 function Surface(){const composer=useComposer();return <><button onClick={()=>app.messageActions[0].run({threadId:"t",message:{id:"m",threadId:"t",role:"assistant",text:"Quoted",sourceSeqEnd:1,experimental_messageSeq:1},composer,experimental_panel:experimental_makePanelController()})}>Reply</button><ReplyPopup/></>;}
 const create=vi.fn();
 const slot=renderSlot({component:Surface},{},{pluginId:"quote-reply",composer:{scope:{kind:"thread",threadId:"voice-test"}},rpc:{create}});
 fireEvent.click(slot.getByText("Reply"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Typed text"}});
 act(()=>voice.props?.onVoiceInputActiveChange?.(true));
 expect(slot.queryByRole("button",{name:"Добавить в строку"})).toBeNull();
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Enter",metaKey:true});
 fireEvent.keyDown(slot.getByRole("textbox"),{key:"Escape"});
 fireEvent.pointerDown(document.body);
 expect(slot.getByRole("dialog")).toBeTruthy();
 expect(create).not.toHaveBeenCalled();
 fireEvent.click(slot.getByRole("button",{name:"Закрыть ответ"}));
 expect(slot.queryByRole("dialog")).toBeNull();
 fireEvent.click(slot.getByText("Reply"));
 expect(slot.getByRole("textbox")).toHaveProperty("value","Typed text");
 act(()=>{voice.props?.onValueChange("Typed text Распознанная речь");voice.props?.onVoiceInputActiveChange?.(false);});
 expect(slot.getByRole("textbox")).toHaveProperty("value","Typed text Распознанная речь");
 expect(slot.getByRole("button",{name:"Добавить в строку"})).toHaveProperty("disabled",false);
 expect(create).not.toHaveBeenCalled();
});

async function mobileRecording(){
 vi.stubGlobal("matchMedia",vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 const app=await loadPluginApp(plugin);
 function Surface(){const composer=useComposer();return <><button onClick={()=>app.messageActions[0].run({threadId:"t",message:{id:"m",threadId:"t",role:"assistant",text:"Quoted",sourceSeqEnd:1,experimental_messageSeq:1},composer,experimental_panel:experimental_makePanelController()})}>Reply</button><ReplyPopup/></>;}
 const create=vi.fn(async(input)=>({...input,id:"native-voice"}));
 const slot=renderSlot({component:Surface},{},{pluginId:"quote-reply",composer:{scope:{kind:"thread",threadId:crypto.randomUUID()}},rpc:{create}});
 fireEvent.click(slot.getByText("Reply"));
 fireEvent.change(slot.getByRole("textbox"),{target:{value:"Typed"}});
 act(()=>voice.props?.onVoiceInputActiveChange?.(true));
 const add=slot.getByRole("button",{name:"Остановить и добавить цитату"});
 await waitFor(()=>expect(add).toHaveProperty("disabled",false));
 return {slot,create,add};
}
it("uses native Stop and adds only after the native transcript arrives",async()=>{
 const {slot,create,add}=await mobileRecording();
 fireEvent.click(add);fireEvent.click(add);
 expect(voice.stop).toHaveBeenCalledTimes(1);
 expect(create).not.toHaveBeenCalled();
 act(()=>voice.props?.onValueChange("Typed speech"));
 expect(create).not.toHaveBeenCalled();
 act(()=>voice.props?.onVoiceInputActiveChange?.(false));
 await waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
 expect(create.mock.calls[0][0].reply).toBe("Typed speech");
 expect(slot.inspection.composer.draft.mentions).toHaveLength(1);
});
it("does not add on native cancellation/failure, or on a later retry",async()=>{
 const {create,add}=await mobileRecording();
 fireEvent.click(add);
 act(()=>voice.props?.onVoiceInputActiveChange?.(false));
 expect(create).not.toHaveBeenCalled();
 act(()=>{voice.props?.onVoiceInputActiveChange?.(true);voice.props?.onValueChange("Typed retry");voice.props?.onVoiceInputActiveChange?.(false);});
 expect(create).not.toHaveBeenCalled();
});
it("leaves ordinary native Stop as text-only",async()=>{
 const {slot,create}=await mobileRecording();
 fireEvent.click(slot.getByRole("button",{name:"Stop and add text"}));
 act(()=>{voice.props?.onValueChange("Typed speech");voice.props?.onVoiceInputActiveChange?.(false);});
 expect(create).not.toHaveBeenCalled();
 expect(slot.getByRole("textbox")).toHaveProperty("value","Typed speech");
});
