import { expect, it } from "vitest";
import { popupPosition, replyFieldHeight, growingPopupTop } from "../selection-anchor";
it("anchors above the selection and clamps horizontally at the viewport edge",()=>{
 expect(popupPosition({left:950,right:980,top:400,bottom:420},340,120,{width:1000,height:800})).toEqual({left:648,top:270});
});
it("flips below near the top and keeps a growing popup on screen",()=>{
 expect(popupPosition({left:20,right:80,top:40,bottom:60},340,120,{width:1000,height:800})).toEqual({left:20,top:70});
 const position=popupPosition({left:5,right:50,top:100,bottom:120},340,380,{width:375,height:400});
 expect(position).toEqual({left:12,top:12});
});

it("caps the answer at eight visible lines and scrolls earlier near the screen edge",()=>{
 expect(replyFieldHeight(7 * 21, 21, 500)).toBe(147);
 expect(replyFieldHeight(8 * 21, 21, 500)).toBe(168);
 expect(replyFieldHeight(9 * 21, 21, 500)).toBe(168);
 expect(replyFieldHeight(13 * 21, 21, 100)).toBe(100);
});

it("grows continuously down until the lower boundary and then upwards",()=>{
 expect(growingPopupTop(400, 100, 600)).toBe(400);
 expect(growingPopupTop(400, 188, 600)).toBe(400);
 expect(growingPopupTop(400, 189, 600)).toBe(399);
 expect(growingPopupTop(400, 250, 600)).toBe(338);
});
