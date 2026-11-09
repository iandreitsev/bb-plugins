const {JSDOM}=require('jsdom');
const ts=require('typescript'),fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..')+'/';
const dom=new JSDOM('<html><head></head><body><aside data-testid="app-sidebar-body"></aside></body></html>',{pretendToBeVisual:true});
const {window:w}=dom,document=w.document;
const source=ts.transpileModule(fs.readFileSync(root+'native-project-limit.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exportsObject={};vm.runInNewContext(source,{exports:exportsObject,document,window:w,HTMLElement:w.HTMLElement,MutationObserver:w.MutationObserver,console});
const tick=()=>new Promise(resolve=>setTimeout(resolve,45));
const sidebar=document.querySelector('aside');
function project(id,count) {
 const el=document.createElement('section');el.setAttribute('data-sidebar-sticky-project-item','');el.setAttribute('data-sidebar-project-id',id);
 const content=document.createElement('div'),list=document.createElement('div');list.setAttribute('data-sidebar-sticky-section','');
 for(let i=0;i<count;i++) {
  const item=document.createElement('div');item.setAttribute('data-sidebar-windowed-item','');item.id=id+i;
  // Offscreen roots have only the navigation placeholder, no row DOM.
  if(i===count-1)item.setAttribute('data-sidebar-windowed-nav',`${id+i}:project`);
  else item.innerHTML=`<div><a href="#" data-sidebar-thread-id="${id+i}">${id+i}</a></div>`;
  list.append(item);
 }
 content.append(list);el.append(content);sidebar.append(el);return {el,list};
}
const hidden=id=>document.getElementById(id).hasAttribute('data-codex-native-limit-hidden');
const control=p=>p.list.nextElementSibling;
(async()=>{
 const a=project('a',8),b=project('b',6),small=project('s',5);
 // Descendant windows must not consume the five-root allowance.
 a.list.children[0].firstElementChild.insertAdjacentHTML('beforeend','<div data-sidebar-windowed-item><a data-sidebar-thread-id="kid">kid</a></div>');
 // A root project can itself be inside a native windowed wrapper.
 const wrapper=document.createElement('div');wrapper.setAttribute('data-sidebar-windowed-item','');a.el.before(wrapper);wrapper.append(a.el);
 const nativeRow=a.list.children[0].firstElementChild;
 const controller=new w.AbortController();const dispose=exportsObject.mountNativeProjectLimit({signal:controller.signal});
 assert.equal(hidden('a4'),false);assert.equal(hidden('a5'),true);assert.equal(hidden('a7'),true);assert.equal(hidden('b5'),true);assert.equal(control(small),null);
 assert.equal(control(a).textContent,'Показать больше');assert.equal(control(a).getAttribute('aria-expanded'),'false');
 control(a).click();assert.equal(hidden('a7'),false);assert.equal(hidden('b5'),true);assert.equal(control(a).textContent,'Показать меньше');
 control(a).click();assert.equal(hidden('a7'),true);assert.equal(a.list.children[0].firstElementChild,nativeRow,'native nodes untouched');
 a.list.children[6].firstElementChild.setAttribute('data-sidebar-thread-selected','');await tick();assert.equal(hidden('a6'),false);assert.equal(hidden('a5'),true);
 a.list.children[6].firstElementChild.removeAttribute('data-sidebar-thread-selected');await tick();assert.equal(hidden('a6'),true);
 a.list.children[5].querySelector('a').focus();assert.equal(hidden('a5'),false);control(a).focus();assert.equal(hidden('a5'),true);
 // Native collapse/unmount removes the injected control, then remount reapplies.
 const content=b.list.parentElement;content.removeChild(b.list);await tick();assert.equal(content.children.length,0);assert.equal(b.list.children[5].hasAttribute('data-codex-native-limit-hidden'),false);
 content.append(b.list);await tick();assert.ok(control(b));assert.equal(hidden('b5'),true);
 // Unknown layout fails open and removes all plugin-owned state.
 const unknown=document.createElement('span');a.list.append(unknown);await tick();assert.equal(control(a),null);assert.equal(hidden('a5'),false);
 unknown.remove();await tick();assert.ok(control(a));assert.equal(hidden('a5'),true);
 // Realtime shrink below the limit needs no control.
 while(b.list.children.length>5)b.list.lastElementChild.remove();await tick();assert.equal(control(b),null);
 const detachedButton=control(a);controller.abort();dispose();await tick();
 assert.equal(document.querySelector('[data-codex-native-limit-hidden]'),null);assert.equal(document.querySelector('[data-codex-native-limit-button]'),null);assert.equal(document.head.children.length,0);
 detachedButton.click();assert.equal(document.querySelector('[data-codex-native-limit-hidden]'),null);
 // An already-aborted mount leaves no resources or changes behind.
 const stopped=new w.AbortController();stopped.abort();exportsObject.mountNativeProjectLimit({signal:stopped.signal});assert.equal(document.head.children.length,0);
 console.log('PASS: native project enhancement, five roots, placeholders, nesting, selection, focus, independent expansion, collapse/remount, realtime shrink, unknown-layout fallback and disposal');
 dom.window.close();
})().catch(error=>{console.error(error);dom.window.close();process.exitCode=1});
