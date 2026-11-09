(async () => {
const { JSDOM } = require("jsdom");
const assert = require("node:assert/strict");
const dom = new JSDOM('<html><head></head><body></body></html>', {url:"https://bb.test/thread/a", pretendToBeVisual:true});
const w=dom.window, d=w.document;
w.Range.prototype.getBoundingClientRect = () => ({left:20,right:200,bottom:160});
const load = require("./load.cjs")(w);
const { mountSavedQuote, selectedMarkdown } = load("saved-quote");
const { bindComposer } = load("bindings");
function fixture(id) {
  const thread=d.createElement("section");thread.setAttribute("data-thread-window","");
  thread.innerHTML='<div data-message-column><div data-sidebar-swipe-selectable><p>A <strong>bold choice</strong> and <a href="https://example.org">a link</a></p><pre><code class="language-bash">echo saved</code></pre></div></div><span data-marker></span>';
  d.body.append(thread);
  const calls=[];const composer={scope:{kind:"thread",threadId:id},key:id,insert:(...args)=>calls.push(args),focus:()=>calls.push("focus")};
  const unbind=bindComposer(thread.querySelector('[data-marker]'),composer);
  return {thread, prose:thread.querySelector('[data-sidebar-swipe-selectable]'),calls,composer,unbind};
}
const a=fixture("a"), b=fixture("b");
const mounted=mountSavedQuote({insertQuote:(_button,_thread,operation)=>operation()});
const menu=d.querySelector('[data-bb-mobile-saved-quote]'),add=[...menu.querySelectorAll('button')].find(b=>b.textContent==='Цитировать');
function select(node,from,to) {
  const range=d.createRange();range.setStart(node,from??0);range.setEnd(node,to??node.textContent.length);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));return range;
}
function collapse() {w.getSelection().removeAllRanges();d.dispatchEvent(new w.Event('selectionchange'));}
select(b.prose.querySelector('strong').firstChild,0,2);collapse();
d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
assert.equal(menu.hidden,false,'outside taps preserve saved actions');
select(b.prose.querySelector('strong').firstChild,0,4);
assert.equal(menu.hidden,true,'only OS menu is shown during live selection');
d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
collapse();
assert.equal(menu.hidden,false,'first tap dismissing Apple menu must retain saved quote');
assert.equal(menu.querySelector('[data-mobile-quote-preview]').textContent,'bold');
const more=menu.querySelector('[data-mobile-quote-more]');
const extra=menu.querySelector('[data-mobile-quote-extra]');
assert.equal(extra.hidden,true,'secondary actions start hidden');
more.click();
assert.equal(extra.hidden,false);
assert.equal(more.getAttribute('aria-expanded'),'true');
assert.deepEqual([...extra.querySelectorAll('button')].map(b=>b.textContent),['В боковой чат','Цитировать','Отменить']);
d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));
assert.equal(extra.hidden,true);
assert.equal(menu.hidden,false,'first Escape closes secondary actions only');
more.click();more.click();
assert.equal(extra.hidden,true);

add.click();add.click();
assert.equal(b.calls.length,2,'one insert and one focus; repeated click cannot duplicate');
assert.equal(a.calls.length,0,'quote stays in side chat of origin');
assert.equal(b.calls[0][0],'> **bold**\n\n');
assert.equal(b.calls[0][1].at,'end');assert.equal(b.calls[0][1].block,true);
assert.equal(menu.hidden,true);

// Native selection menu stays hidden; retained actions invoke its handlers explicitly.
const stock=d.createElement('div');stock.setAttribute('data-radix-popper-content-wrapper','');
stock.innerHTML='<div role="dialog" data-state="open"><button>Add to chat</button><button>Reply in side chat</button></div>';
b.thread.append(stock);
await Promise.resolve();
assert.equal(stock.hasAttribute('data-bb-mobile-native-selection'),true,'native web menu is suppressed on mobile');
const unrelated=d.createElement('div');
unrelated.setAttribute('data-radix-popper-content-wrapper','');
unrelated.innerHTML='<div role="dialog"><button>Settings</button></div>';
d.body.append(unrelated);
await Promise.resolve();
assert.equal(unrelated.hasAttribute('data-bb-mobile-native-selection'),false,'unrelated popovers stay visible');
unrelated.remove();
stock.remove();

let range=select(a.prose.querySelector('code').firstChild,0,4);
assert.equal(selectedMarkdown(range,a.prose),'```bash\necho\n```','partial code retains pre/code language');
range=select(a.prose.querySelector('a').firstChild,0,1);
assert.equal(selectedMarkdown(range,a.prose),'[a](https://example.org)','partial link retains target');
// Syntax highlighters and styled spans must not hide semantic ancestors.
a.prose.querySelector('code').innerHTML='<span>echo nested</span>';
range=select(a.prose.querySelector('code span').firstChild,0,4);
assert.equal(selectedMarkdown(range,a.prose),'```bash\necho\n```');
a.prose.querySelector('strong').innerHTML='<span>bold nested</span>';
range=select(a.prose.querySelector('strong span').firstChild,0,4);
assert.equal(selectedMarkdown(range,a.prose),'**bold**');
collapse();a.unbind();assert.equal(menu.hidden,true,'unmount clears snapshot');add.click();assert.equal(a.calls.length,0);

select(b.prose.querySelector('strong').firstChild);collapse();
d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
const input=d.createElement('textarea');d.body.append(input);input.dispatchEvent(new w.Event('beforeinput',{bubbles:true}));
assert.equal(menu.hidden,false,'typing does not cancel saved quote');
more.click();
d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
assert.equal(extra.hidden,true,'outside tap closes only the secondary list');
assert.equal(menu.hidden,false);
more.click();
menu.querySelector('[data-mobile-quote-cancel]').click();
assert.equal(menu.hidden,true,'explicit Cancel removes the panel');
select(b.prose.querySelector('strong').firstChild);collapse();
w.history.pushState({},'', '/thread/elsewhere');add.click();
assert.equal(b.calls.length,2,'navigation invalidates even a surviving marker');
assert.equal(menu.hidden,true);

w.history.pushState({},'', '/thread/a');select(b.prose.querySelector('strong').firstChild);collapse();
b.composer.insert=()=>{throw Error('host editor unavailable')};add.click();
assert.equal(menu.hidden,false,'failed insert preserves quote for retry');
assert.equal(menu.querySelector('[role=status]').hidden,false);
b.composer.insert=(...args)=>b.calls.push(args);
b.composer.focus=()=>{throw Error('focus failed after successful insert')};
add.click();add.click();assert.equal(b.calls.length,3,'focus failure must not offer duplicate insertion');
assert.equal(menu.hidden,true);
const actions=d.createElement('div');actions.setAttribute('data-radix-popper-content-wrapper','');
actions.innerHTML='<div role="dialog" data-state="open"><button>Ответить</button><button>В боковой чат</button><button>Цитировать</button></div>';
b.thread.append(actions);
let selectedText="", replyCalls=0, sideCalls=0;
actions.querySelectorAll('button')[0].onclick=()=>{selectedText=w.getSelection().toString();replyCalls++;};
actions.querySelectorAll('button')[1].onclick=()=>{selectedText=w.getSelection().toString();sideCalls++;};
select(b.prose.querySelector('strong').firstChild,0,4);collapse();
[...menu.querySelectorAll('button')].find(b=>b.textContent==='Ответить').click();
await new Promise(r=>setTimeout(r,80));
assert.equal(replyCalls,1);assert.equal(selectedText,'bold');assert.equal(menu.hidden,true);
select(b.prose.querySelector('strong').firstChild,0,3);collapse();
[...menu.querySelectorAll('button')].find(b=>b.textContent==='В боковой чат').click();
await new Promise(r=>setTimeout(r,80));
assert.equal(sideCalls,1);assert.equal(selectedText,'bol');assert.equal(menu.hidden,true);
actions.remove();
select(b.prose.querySelector('strong').firstChild,0,3);collapse();
[...menu.querySelectorAll('button')].find(b=>b.textContent==='Ответить').click();
await new Promise(r=>setTimeout(r,950));
assert.equal(menu.hidden,false,'missing native action leaves a retryable selection');
assert.equal(menu.querySelector('[role=status]').hidden,false);
// A saved message opens directly without a native selection popup.
b.prose.setAttribute("data-timeline-row-id","source-message");
w.Range.prototype.getBoundingClientRect=()=>({left:20,right:200,top:700,bottom:740});
select(b.prose.querySelector('strong').firstChild,0,4);collapse();
let handedOff=null;
function receiveReply(event){handedOff=event.detail;event.preventDefault();}
d.addEventListener("bb-quote-reply:open-v1",receiveReply);
[...menu.querySelectorAll("button")].find(button=>button.textContent==="Ответить").click();
assert.equal(handedOff.text,"bold");
assert.equal(handedOff.messageId,"source-message");
assert.equal(handedOff.composer,b.composer);
assert.equal(menu.hidden,true);
d.removeEventListener("bb-quote-reply:open-v1",receiveReply);
mounted();assert.equal(d.querySelector('[data-bb-mobile-saved-quote]'),null);
b.unbind();dom.window.close();
console.log('PASS: saved selection survives collapse/first tap, exact composer binding, markdown fragments, once-only insert, stale navigation/unmount, typing persistence and explicit cancellation, retry and cleanup');

})().catch(error=>{console.error(error);process.exitCode=1;});
