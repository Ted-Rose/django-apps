/**
 * Per-entry OpenAPI type generation (`npm run gen:types`): runs
 * openapi-typescript on ../frontend/openapi.json once per SPA entry,
 * writing src/<entry>/api-types.ts. Replaces the old inline bash
 * loop so package.json stays under the 79-char line limit.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = ['tasks', 'notes', 'finance', 'gmail', 'single_pages'];
const SPEC = join(ROOT, '../frontend/openapi.json');
const BIN = join(ROOT, 'node_modules/.bin/openapi-typescript');

for (const entry of ENTRIES) {
  const out = join(ROOT, 'src', entry, 'api-types.ts');
  execFileSync(BIN, [SPEC, '-o', out], { stdio: 'inherit' });
}
