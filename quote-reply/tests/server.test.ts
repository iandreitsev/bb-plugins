import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
const hosts: ReturnType<typeof createFakePluginHost>[]=[];
afterEach(async()=>{for(const host of hosts.splice(0)) await host.harness.lifecycle.dispose();});
function host(){const h=createFakePluginHost({pluginId:"quote-reply"});hosts.push(h);plugin(h.bb);return h.harness;}
const input={threadId:"t",messageId:"m",messageSeq:7,quote:"Полная цитата\nсо второй строкой",reply:"Ответ"};
describe("durable replies",()=>{
 it("resolves full payload and retains the original when a new version is created",async()=>{
  const h=host();
  const first=await h.behavior.callRpc("create",input) as {id:string};
  const second=await h.behavior.callRpc("create",{...input,reply:"Новая версия"}) as {id:string};
  expect(first.id).not.toBe(second.id);
  const reloaded = await h.lifecycle.reload(plugin);
  const resolved=await reloaded.harness.registrations.mentionProviders[0].resolve(first.id);
  expect(resolved.context).toContain("Полная цитата\\nсо второй строкой");
  expect(resolved.context).toContain('"userReply": "Ответ"');
  expect(resolved.context).not.toContain("Новая версия");
 });
 it("fails visibly for missing, malformed, or oversized data",async()=>{
  const h=host();
  await expect(h.behavior.callRpc("create",{...input,quote:"\u0000".repeat(40000),reply:"\u0000".repeat(40000)})).rejects.toThrow("слишком велики");
  await expect(h.behavior.callRpc("create",{...input,reply:""})).rejects.toThrow();
  await expect(h.behavior.callRpc("create",{...input,quote:"a".repeat(40001)})).rejects.toThrow();
  await expect(h.registrations.mentionProviders[0].resolve("invalid")).rejects.toThrow();
  await expect(h.registrations.mentionProviders[0].resolve("36b45399-d190-4db9-9387-e9f612d10f60")).rejects.toThrow("не найдена");
 });
 it("uses public SDK imports",async()=>{
  const scan=await experimental_scanPublicSdkOnly(process.cwd(),{allow:[/^react$/, /^react-dom$/, /^sonner$/, /^@testing-library\/react$/]});
  expect(scan.violations).toEqual([]);expect(scan.privateDependencies).toEqual([]);
 });
});
