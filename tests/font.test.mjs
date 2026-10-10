import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('banner inherits Foundry font when legacy font-primary variable is absent', async () => {
  const css = await readFile(new URL('../styles/rp-frame.css', import.meta.url), 'utf8');
  const banner = css.match(/\.rp-frame-banner\s*\{([^}]+)\}/)?.[1];
  assert.ok(banner);
  // Foundry 14 supplies Signika through body inheritance. A generic fallback
  // overrides that font instead of letting the declaration become invalid.
  assert.match(banner, /font-family:\s*var\(--font-primary\)\s*;/);
  assert.doesNotMatch(css, /font-family:[^;]*sans-serif/);
});
