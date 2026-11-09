// Exercise the actual calendar hook across DST, suspended timers and wake events.
process.env.TZ = 'Europe/Berlin';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname,'../app.tsx'),'utf8');
const compiled = ts.transpileModule(source + '\nexport { useToday, dayGroup };', {
  compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}
}).outputText;
let now, state, timer, delay, effect, clearTimerCount=0;
class Clock extends Date { static now() { return now; } }
const window = Object.assign(new EventTarget(), {
  setTimeout(fn,ms){timer=fn;delay=ms;return 1},clearTimeout(){clearTimerCount++},
  setInterval(){throw new Error("Calendar must not poll periodically")},
});
const document = Object.assign(new EventTarget(), {visibilityState:'visible'});
const exportsObject={};
vm.runInNewContext(compiled, {
  exports:exportsObject, Date:Clock, Intl, window, document,
  require(name) {
    if(name==='react') return {
      useState(init){if(state===undefined)state=init();return [state,v=>state=v]},
      useEffect(fn){effect=fn},
    };
    if(name==='@get-bb/plugin-sdk/app')return {definePluginApp(){}};
    return {};
  },
});
function mount(at) {
  state=undefined;timer=undefined;now=new Date(at).getTime();document.visibilityState='visible';
  exportsObject.useToday();return effect();
}
process.env.TZ='Asia/Bangkok';
let cleanup=mount('2026-10-31T13:36:00');
const oldThread=now;
assert.equal(exportsObject.dayGroup(oldThread,state).label,'Сегодня');
// Simulate sleep: wall clock advances, the queued midnight timeout never fires.
now=new Date('2026-11-01T11:08:00').getTime();
window.dispatchEvent(new Event('focus'));
assert.equal(exportsObject.dayGroup(oldThread,state).label,'Вчера','focus must fix the old Today bucket without reloading BB');
cleanup();
cleanup=mount('2026-10-31T23:50:00');
now=new Date('2026-11-02T08:00:00').getTime();
document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));
assert.equal(new Date(state).getDate(),31,'a hidden window does not need a wake refresh');
document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));
assert.equal(new Date(state).getDate(),2,'becoming visible catches up across several days');
cleanup();
cleanup=mount('2026-10-31T23:50:00');
now=new Date('2026-11-01T08:00:00').getTime();
window.dispatchEvent(new Event('pageshow'));assert.equal(new Date(state).getDate(),1);
cleanup();
cleanup=mount('2026-10-31T23:50:00');
assert.ok(delay>1000,'next midnight is scheduled from the actual current date');
// Clock and timezone changes also require rescheduling even if React bails out.
now=new Date('2026-10-30T12:00:00').getTime();window.dispatchEvent(new Event('focus'));
assert.equal(new Date(state).getDate(),30);assert.equal(delay,12*3600000+1000);
const before=state,clearedTimers=clearTimerCount;
cleanup();assert.ok(clearTimerCount>clearedTimers);
now=new Date('2026-11-03T10:00:00').getTime();
window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));
assert.equal(state,before,'unmounted hook removes all wake listeners');
process.env.TZ='Europe/Berlin';
for(const [day,hours] of [['2026-10-25',25],['2026-03-29',23]]) {
  const cleanup=mount(day+'T00:00:00');const first=state;
  assert.equal(delay,hours*3600000+1000);
  now+=delay;timer();assert.ok(state>first);
  assert.ok(delay>0 && delay<=86401000,'midnight callback rearms without needing a React effect');
  cleanup();
}
console.log('PASS: DST midnight rollover; missed timers after sleep; focus, visibility and pageshow catch-up; clock rollback; listener/timer disposal');
