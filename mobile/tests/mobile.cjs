const { JSDOM } = require('jsdom');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function setup(mobile = true) {
  const dom = new JSDOM('<html><head></head><body></body></html>', { pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'userAgent', { value: mobile ? 'Mozilla/5.0 (iPhone)' : 'Desktop Mac' });
  w.matchMedia = () => ({ matches: false });
  const load = require('./load.cjs')(w);
  const api = load('mobile');
  return { dom, w, d: w.document, api };
}
function fixture(d, id) {
  const thread = d.createElement('section');
  thread.setAttribute('data-thread-window', '');
  thread.innerHTML = `<div data-message-column><div data-sidebar-swipe-selectable><p>Quote ${id}</p></div></div><div data-promptbox-editor-content><div contenteditable="true" role="textbox" tabindex="0"><p>Draft ${id}</p></div></div>`;
  d.body.append(thread);
  return { thread, prose: thread.querySelector('p'), editor: thread.querySelector('[role=textbox]') };
}
function select(w, d, el) {
  const range = d.createRange(); range.selectNodeContents(el);
  const s = w.getSelection(); s.removeAllRanges(); s.addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
}
function button(d) {
  const b = d.createElement('button'); b.textContent = 'Add to chat'; d.body.append(b); return b;
}
function checkEnd(w, editor) {
  assert.equal(w.document.activeElement, editor);
  const s = w.getSelection(); assert.ok(s.isCollapsed);
  const tail = w.document.createRange(); tail.selectNodeContents(editor);
  tail.setStart(s.anchorNode, s.anchorOffset);
  assert.equal(tail.toString(), '', 'caret is at the end, beyond all quote text');
  assert.equal(s.anchorNode.nodeType === 1 ? s.anchorNode.closest('blockquote') : s.anchorNode.parentElement.closest('blockquote'), null, 'caret must be outside the quote');
  if (!editor.lastElementChild.textContent) {
    assert.equal(s.anchorNode, editor.lastElementChild);
    assert.equal(s.anchorOffset, 0, 'empty line position is BEFORE the trailing BR on iOS');
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
(async () => {
  {
    const { api, dom, d } = setup(false);
    assert.equal(api.mountMobile({ signal: new AbortController().signal }), undefined);
    assert.equal(d.querySelector('style'), null); dom.window.close();
  }
  const { api, dom, w, d } = setup();
  const a = fixture(d, 'A'), b = fixture(d, 'B');
  const controller = new AbortController();
  const dispose = api.mountMobile({ signal: controller.signal });
  const style = d.querySelector('style');
  assert.ok(!style.textContent.includes('touch-callout'), 'native iOS menu stays intact');
  assert.ok(!style.textContent.includes('[data-sidebar-swipe-selectable]'), 'transcript selection remains native');
  let event = new w.Event('contextmenu', { bubbles: true, cancelable: true });
  a.prose.dispatchEvent(event); assert.ok(!event.defaultPrevented);
  event = new w.Event('contextmenu', { bubbles: true, cancelable: true });
  a.editor.dispatchEvent(event); assert.ok(!event.defaultPrevented, 'composer copy/paste remains native');
  event = new w.Event('touchstart', { bubbles: true, cancelable: true });
  a.prose.dispatchEvent(event); assert.ok(!event.defaultPrevented, 'native handles retain gestures');

  // A floating menu originates in the second thread, while the first composer is focused.
  a.editor.focus(); select(w, d, b.prose);
  const add = button(d);
  add.addEventListener('pointerup', () => {
    b.editor.innerHTML += '<blockquote><p>Quoted B</p></blockquote><p><br></p>';
    b.editor.focus();
    w.getSelection().removeAllRanges(); // stock BB removes the timeline range after its action
  }, { once: true });
  add.dispatchEvent(new w.Event('pointerup', { bubbles: true }));
  checkEnd(w, b.editor);
  // Simulate Tiptap's animation-frame focus restoring its previous position inside the quote.
  w.requestAnimationFrame(() => select(w, d, b.editor.querySelector('blockquote p')));
  await new Promise(resolve => setTimeout(resolve, 65));
  checkEnd(w, b.editor);
  assert.equal(a.editor.textContent, 'Draft A');

  // Do not settle on an intermediate DOM commit that still ends in the blockquote.
  select(w, d, a.prose);
  const intermediate = button(d);
  intermediate.addEventListener('click', () => {
    a.editor.innerHTML = '<blockquote><p>Intermediate quote</p></blockquote>';
    queueMicrotask(() => { a.editor.innerHTML += '<p><br class="ProseMirror-trailingBreak"></p>'; });
  }, { once: true });
  intermediate.click(); await tick(); checkEnd(w, a.editor);

  // Deferred host draft reconciliation is observed only within the originating window.
  select(w, d, a.prose);
  const delayed = button(d);
  delayed.addEventListener('click', () => queueMicrotask(() => {
    a.editor.innerHTML += '<blockquote><p>Late quote</p></blockquote><p>after</p>';
  }), { once: true });
  delayed.click(); await tick(); checkEnd(w, a.editor);

  // A button which did not modify a draft must not focus an arbitrary composer.
  select(w, d, b.prose); a.editor.focus();
  const nothing = button(d); nothing.click(); await tick();
  assert.equal(d.activeElement, a.editor);
  d.dispatchEvent(new w.Event('keydown', { bubbles: true }));
  b.editor.innerHTML += '<p>Unrelated update</p>'; await tick();
  assert.equal(d.activeElement, a.editor, 'typing cancels the outstanding quote correction');

  // Teardown removes behavior and cancels a deferred action.
  select(w, d, b.prose); const abort = button(d); abort.click();
  controller.abort(); dispose();
  b.editor.innerHTML += '<p>after disposal</p>'; await tick();
  assert.equal(d.querySelector('style'), null);
  event = new w.Event('contextmenu', { bubbles: true, cancelable: true });
  b.prose.dispatchEvent(event); assert.ok(!event.defaultPrevented);
  dom.window.close();
  console.log('PASS: mobile-only, native menu/handles preserved, synchronous and deferred quote caret, split chats, cancellation and teardown');
})().catch(e => { console.error(e); process.exitCode = 1; });
