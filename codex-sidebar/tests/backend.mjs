// Real SDK registration, validation, storage and lifecycle; no hand-written bb mock.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createFakePluginHost, makeThreadResponse, experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';
const root = new URL('../', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'codex-sidebar-test-'));
let host;
try {
  // Transpile the actual factory to temporary ESM, resolving package imports
  // from this package rather than mocking its imports or evaluating in a VM.
  for (const name of ['shared', 'server']) {
    const source = await readFile(new URL(`${name}.ts`, root), 'utf8');
    let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    code = code.replace(/from "([^\"]+)"/g, (_, specifier) => `from ${JSON.stringify(specifier === './shared' ? './shared.mjs' : import.meta.resolve(specifier))}`);
    await writeFile(join(directory, `${name}.mjs`), code);
  }
  const { default: plugin } = await import(pathToFileURL(join(directory, 'server.mjs')).href);
  const key = 'sidebar.threadListProvider';
  let preference = { value: '__automatic__', revision: 1 }, retries = 0;
  host = createFakePluginHost({ pluginId: 'codex-sidebar', sdk: { system: { uiPreferences: {
    list: async () => ({ preferences: { [key]: preference } }),
    set: async input => { if (retries++ === 0) throw new Error('revision conflict'); assert.equal(input.expectedRevision, preference.revision); preference = { value: input.value, revision: preference.revision + 1 }; return {}; },
  } } } });
  const { bb } = host;
  let harness = host.harness;
  await plugin(bb);
  const call = (method, input = null) => harness.behavior.callRpc(method, input);
  assert.deepEqual(await call('priority_list'), { priority: {} });
  await Promise.all(Array.from({ length: 40 }, (_, i) => call('priority_add', { threadIds: [`thread-${i}`] })));
  assert.equal(Object.keys((await call('priority_list')).priority).length, 40, 'concurrent updates retain every entry');
  await assert.rejects(call('priority_add', { threadIds: [''] }));
  await assert.rejects(call('priority_remove', { threadIds: Array(1001).fill('x') }));
  const event = (name, id, visibility = 'visible') => harness.behavior.emitThreadEvent(name, { thread: makeThreadResponse({ id, visibility }) });
  await event('thread.active', 'active');
  await event('thread.failed', 'failed');
  await event('thread.active', 'hidden', 'hidden');
  let priority = (await call('priority_list')).priority;
  assert.ok(priority.active); assert.ok(priority.failed); assert.equal(priority.hidden, undefined);
  const signalCount = harness.realtimeSignals.length;
  await call('priority_add', { threadIds: ['active'] });
  assert.equal(harness.realtimeSignals.length, signalCount, 'idempotent updates do not broadcast');
  await event('thread.deleted', 'active');
  assert.equal((await call('priority_list')).priority.active, undefined);
  await call('priority_add', { threadIds: Array.from({ length: 600 }, (_, i) => `cap-${i}`) });
  assert.equal(Object.keys((await call('priority_list')).priority).length, 500);
  const saved = await call('priority_list');
  host = await harness.lifecycle.reload(plugin);
  harness = host.harness;
  assert.deepEqual(await call('priority_list'), saved, 'priority survives reload');
  const response = await harness.behavior.fetchHttp('POST', '/toggle-view');
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { view: 'projects' });
  assert.equal(retries, 2); assert.equal(preference.value, 'thread-list/thread-list');
  const back = await harness.behavior.fetchHttp('POST', '/toggle-view');
  assert.deepEqual(await back.json(), { view: 'priority' });
  assert.equal(preference.value, 'codex-sidebar/codex-list');
  const scan = experimental_scanPublicSdkOnly(new URL('../', import.meta.url).pathname, {
    allow: [/^(react|typescript|jsdom|@testing-library\/react|@get-bb\/plugin-sdk\/testing)$/],
  });
  // Two audited test-only loaders: temporary ESM factory above and the legacy
  // UI fixture loader. Production dynamic imports remain forbidden.
  const exceptions = new Map([
    ['tests/backend.mjs', new Set(["pathToFileURL(join(directory, 'server.mjs')).href"])],
    ['tests/sidebar.cjs', new Set(['n'])],
  ]);
  assert.deepEqual(scan.violations.filter(v => !(v.reason === 'dynamic-specifier' && exceptions.get(v.file)?.has(v.specifier))), []); assert.deepEqual(scan.privateDependencies, []);
  console.log('PASS: SDK backend contracts, concurrent priority storage, event visibility, cap, lifecycle persistence, toggle retry and public API imports');
} finally {
  await host?.harness.lifecycle.dispose();
  await rm(directory, { recursive: true, force: true });
}
