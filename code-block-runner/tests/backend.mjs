import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createFakePluginHost,makeThreadResponse,experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';
const root=new URL('../',import.meta.url),dir=await mkdtemp(join(tmpdir(),'bb-code-runner-'));
let host,service;
const sessions=new Map(),sent=[],starts=[];let sendFailures=0,loseCreateResponse=false,failAfterCreateSave=false;
const output=s=>({status:s.status,exitCode:s.exitCode,closeReason:s.closeReason,chunks:[{seq:1,dataBase64:Buffer.from(s.text).toString('base64')}],nextSeq:1,truncated:false});
const wait=async(predicate)=>{for(let i=0;i<80;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out')};
try{
 const source=await readFile(new URL('server.ts',root),'utf8');
 let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 code=code.replace(/from "([^"]+)"/g,(_,n)=>`from ${JSON.stringify(import.meta.resolve(n))}`);
 await writeFile(join(dir,'server.mjs'),code);
 const {default:plugin}=await import(pathToFileURL(join(dir,'server.mjs')).href);
 host=createFakePluginHost({pluginId:'code-block-runner',sdk:{threads:{get:async({threadId})=>makeThreadResponse({id:threadId}),send:async input=>{if(sendFailures-->0)throw new Error('offline');sent.push(input);return {}}},terminals:{
 create:async input=>{assert.match(input.id,/^term_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/,'ID must satisfy real BB terminal schema');starts.push(input);const id=input.id??'term_'+starts.length;const s={id,threadId:input.scope.threadId,status:'running',exitCode:null,closeReason:null,text:'\u001b[31mhello\u001b[0m\r\n',initialCwd:'/workspace/project',hostId:'host_target'};sessions.set(id,s);
 if(failAfterCreateSave){failAfterCreateSave=false;failNextSave=true}
 if(loseCreateResponse){loseCreateResponse=false;throw new Error('create response lost')}
 return s},
 output:async({terminalId})=>output(sessions.get(terminalId)),get:async({terminalId})=>sessions.get(terminalId),
 close:async({terminalId})=>{const s=sessions.get(terminalId);Object.assign(s,{status:'exited',closeReason:'user',exitCode:null});return s},
 }}});
 let harness=host.harness;
 let failNextSave=false;
 function wrapStorage(){
   const realSet=host.bb.storage.kv.set.bind(host.bb.storage.kv);
   host.bb.storage.kv.set=async(key,value)=>{if(failNextSave){failNextSave=false;throw new Error('post-create KV failure')}return realSet(key,value)};
 }
 wrapStorage();await plugin(host.bb);
 const block={threadId:'thread_origin',messageId:'message_1',language:'bash',index:0};
 const input={block,code:"printf 'hello\\n'",requestId:'11111111-1111-4111-8111-111111111111'};
 const rpc=(method,value)=>harness.behavior.callRpc(method,value);
 const [first,duplicate]=await Promise.all([rpc('start',input),rpc('start',{...input,requestId:'22222222-2222-4222-8222-222222222222'})]);
 assert.equal(first.id,duplicate.id);assert.equal(starts.length,1);
 assert.deepEqual(starts[0].scope,{kind:'thread',threadId:block.threadId});
 assert.deepEqual(starts[0].start,{mode:'argv',argv:['bash','-c',input.code]});
 assert.equal(first.cwd,'/workspace/project');
 assert.match(starts[0].id,/^term_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/);
 assert.equal(first.terminalId,starts[0].id);
 assert.equal((await rpc('start',input)).id,first.id);assert.equal(starts.length,1);
 await assert.rejects(rpc('start',{...input,block:{...block,threadId:'other'}}));
 await assert.rejects(rpc('start',{...input,block:{...block,index:1},requestId:crypto.randomUUID(),code:'ssh makenna\ncd /opt/smb\nnano .env'}));assert.equal(starts.length,1);
 service=harness.behavior.runService('completion-monitor');
 await wait(async()=> (await rpc('get',block)).output.includes('hello'));
 assert.equal(sent.length,0,'never announce completion while running');
 Object.assign(sessions.get(first.terminalId),{status:'exited',exitCode:0,closeReason:'process-exit'});
 await wait(async()=> (await rpc('get',block)).notified);
 assert.equal(sent.length,1);assert.equal(sent[0].threadId,block.threadId);assert.equal(sent[0].mode,'queue-if-active');
 assert.equal(sent[0].input[0].visibility,'agent-only','completion details must stay out of visible chat');
 assert.ok(sent[0].input.every(part=>part.visibility==='agent-only'),'no visible technical payload');
 assert.match(sent[0].input[0].text,/Не пиши отдельный ответ/);
 assert.match(sent[0].input[0].text,/hello/,'hidden delivery retains command output for the agent');
 assert.match(sent[0].input[0].text,/код завершения: 0/);assert.ok(!sent[0].input[0].text.includes('\u001b'));
 assert.equal((await rpc('get',block)).state,'succeeded');
 const failedBlock={...block,index:2};
 const failure=await rpc('start',{block:failedBlock,code:'exit 7',requestId:crypto.randomUUID()});
 Object.assign(sessions.get(failure.terminalId),{status:'exited',exitCode:7,closeReason:'process-exit'});
 await wait(async()=> (await rpc('get',failedBlock)).notified);assert.equal((await rpc('get',failedBlock)).state,'failed');
 const stopBlock={...block,index:3};const stopping=await rpc('start',{block:stopBlock,code:'sleep 10',requestId:crypto.randomUUID()});
 await rpc('stop',{block:stopBlock,runId:stopping.id});assert.equal((await rpc('get',stopBlock)).state,'stopped');
 assert.equal(sent.length,3);
 const longBlock={...block,index:4};const long=await rpc('start',{block:longBlock,code:'sleep 10',requestId:crypto.randomUUID()});
 service.controller.abort();await service.done;service=null;
 host=await harness.lifecycle.reload(plugin);harness=host.harness;wrapStorage();
 assert.equal((await rpc('get',longBlock)).terminalId,long.terminalId,'run survives generation reload');
 service=harness.behavior.runService('completion-monitor');
 sendFailures=1;Object.assign(sessions.get(long.terminalId),{status:'exited',exitCode:0,closeReason:'process-exit'});
 await wait(async()=> (await rpc('get',longBlock)).notificationError==='Error: offline');
 await wait(async()=> (await rpc('get',longBlock)).notified);assert.equal(sent.length,4);
 await new Promise(r=>setTimeout(r,1100));assert.equal(sent.length,4,'finished run is not announced repeatedly');
 // Lost create response: PTY exists, but the call rejects after creating it.
 const lostBlock={...block,index:5},lostInput={block:lostBlock,code:'sleep 10',requestId:crypto.randomUUID()};
 loseCreateResponse=true;const lost=await rpc('start',lostInput);
 assert.equal(lost.state,'starting');assert.ok(lost.terminalId);assert.ok(sessions.has(lost.terminalId));
 const startsAfterLost=starts.length;
 assert.equal((await rpc('start',{...lostInput,requestId:crypto.randomUUID()})).id,lost.id);
 await wait(async()=> (await rpc('get',lostBlock)).state==='running');
 assert.equal(starts.length,startsAfterLost,'recovery never replays a command');
 Object.assign(sessions.get(lost.terminalId),{status:'exited',exitCode:0,closeReason:'process-exit'});
 await wait(async()=> (await rpc('get',lostBlock)).notified);
 assert.equal((await rpc('get',lostBlock)).cwd,'/workspace/project');
 // Simulate crashing after the first durable write and PTY creation, before saving response.
 service.controller.abort();await service.done;service=null;
 const crashBlock={...block,index:6},crashInput={block:crashBlock,code:'sleep 10',requestId:crypto.randomUUID()};
 failAfterCreateSave=true;await assert.rejects(rpc('start',crashInput),/post-create KV failure/);
 const persisted=await rpc('get',crashBlock);
 assert.equal(persisted.state,'starting');assert.ok(persisted.terminalId);assert.ok(sessions.has(persisted.terminalId));
 const createsBeforeReload=starts.length;
 host=await harness.lifecycle.reload(plugin);harness=host.harness;wrapStorage();
 service=harness.behavior.runService('completion-monitor');
 await wait(async()=> (await rpc('get',crashBlock)).state==='running');
 assert.equal(starts.length,createsBeforeReload);
 await rpc('stop',{block:crashBlock,runId:persisted.id});
 assert.equal((await rpc('get',crashBlock)).state,'stopped');assert.equal((await rpc('get',crashBlock)).notified,true);
 assert.ok(sent.every(message=>message.input.every(part=>part.visibility==='agent-only')));
 console.log('PASS: lost create response and crash before post-create save recover the original PTY without replay; hidden completion delivery retained');
 const scan=experimental_scanPublicSdkOnly(new URL('../',import.meta.url).pathname,{allow:[/^(react|typescript|jsdom|@testing-library\/react|@get-bb\/plugin-sdk\/testing)$/]});
 assert.deepEqual(scan.privateDependencies,[]);
 assert.deepEqual(scan.violations.filter(v=>!(v.reason==='dynamic-specifier'&&(v.file==='tests/backend.mjs'||v.file==='tests/frontend.cjs'&&v.specifier==='n'))),[]);
 console.log('PASS: scoped execution, exact argv, duplicate clicks/requests, SSH ambiguity, live output, exit 0/7, stop, durable reload, agent delivery/retry and public SDK only');
}finally{service?.controller.abort();await service?.done;await host?.harness.lifecycle.dispose();await rm(dir,{recursive:true,force:true})}
