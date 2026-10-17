import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('browser and Apps Script vocabularies are identical', async () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../../apps-script/Taxonomy.js', import.meta.url), 'utf8') + '\nthis.T = TAXONOMY;', ctx);
  const { TAXONOMY } = await import('../../public/js/taxonomy.js');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.T)), JSON.parse(JSON.stringify(TAXONOMY)));
});

test('Drive roots match between site config and backend defaults', async () => {
  const { CONFIG } = await import('../../public/js/config.js');
  const code = fs.readFileSync(new URL('../../apps-script/Code.js', import.meta.url), 'utf8');
  for (const [k, f] of Object.entries(CONFIG.folders)) assert.match(code, new RegExp(`${k}: '${f.id}'`));
});
