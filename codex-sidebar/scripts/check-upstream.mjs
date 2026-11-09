// Supply a BB checkout to compare the vendored policy without network access.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const checkout = process.argv[2];
if (!checkout) throw new Error('Usage: npm run check:upstream -- /path/to/bb');
const source = readFileSync(resolve(checkout, 'plugins/thread-list/app/model/thread-activity.ts'), 'utf8');
const local = readFileSync(new URL('../native-thread-activity.ts', import.meta.url), 'utf8').split('\n').slice(2).join('\n');
const hash = createHash('sha256').update(source).digest('hex');
assert.equal(source, local, 'BB activity policy changed: review upstream diff, port it, and rerun activity/UI tests.');
console.log(`PASS: vendored BB activity policy matches checkout (sha256 ${hash})`);
