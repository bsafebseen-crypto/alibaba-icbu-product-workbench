import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const stylesPath = fileURLToPath(new URL('../public/styles.css', import.meta.url));

test('Obsidian batch warnings have a distinct warning status color', async () => {
  const styles = await readFile(stylesPath, 'utf8');

  assert.match(
    styles,
    /\.obsidian-status\[data-kind="warning"\]\s*\{\s*color:\s*var\(--orange-dark\);\s*\}/,
  );
});
