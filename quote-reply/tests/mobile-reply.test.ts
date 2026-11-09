// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mountMobileReply, registerReplyComposer, MOBILE_REPLY_EVENT } from "../mobile-reply";
it("opens a saved mobile selection directly even after its source leaves the DOM",()=>{
 const open=vi.fn(),dispose=mountMobileReply(open);
 const composer={key:"own-key",scope:{kind:"thread",threadId:"t"}};
 const unregister=registerReplyComposer(composer as any);
 const event=new CustomEvent(MOBILE_REPLY_EVENT,{cancelable:true,detail:{
  composer:{key:"other-plugin-key",scope:{kind:"thread",threadId:"t"}},threadId:"t",messageId:"message",text:"Exact excerpt",
  rect:{left:20,right:250,top:720,bottom:760},
 }});
 try{
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(open).toHaveBeenCalledWith(composer,{threadId:"t",messageId:"message",messageSeq:null,quote:"Exact excerpt",reply:""},expect.objectContaining({rect:{left:20,right:250,top:720,bottom:760}}));
 }finally{dispose();unregister();}
});
it("does not hand a selection to the wrong thread and cleans up its listener",()=>{
 const open=vi.fn(),dispose=mountMobileReply(open);
 const event=new CustomEvent(MOBILE_REPLY_EVENT,{cancelable:true,detail:{
  composer:{scope:{kind:"thread",threadId:"other"}},threadId:"t",messageId:"m",text:"quote",rect:{left:0,right:20,top:10,bottom:30}
 }});
 document.dispatchEvent(event);
 expect(open).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(false);
 dispose();
});

it("retains fallback for malformed events and absent or ambiguous own composers",()=>{
 const open=vi.fn(),dispose=mountMobileReply(open);
 const valid={threadId:"t",messageId:"m",text:"quote",rect:{left:0,right:20,top:10,bottom:30}};
 const send=(detail:unknown)=>{const event=new CustomEvent(MOBILE_REPLY_EVENT,{cancelable:true,detail});document.dispatchEvent(event);return event.defaultPrevented;};
 expect(send(valid)).toBe(false);
 expect(send({...valid,composer:{}})).toBe(false);
 const first=registerReplyComposer({key:"a",scope:{kind:"thread",threadId:"t"}} as any);
 const second=registerReplyComposer({key:"b",scope:{kind:"thread",threadId:"t"}} as any);
 try {expect(send(valid)).toBe(false);expect(open).not.toHaveBeenCalled();}
 finally{first();second();dispose();}
});
