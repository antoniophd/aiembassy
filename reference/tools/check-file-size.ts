// Fails when a source file exceeds 400 lines.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 400;
const ROOTS = ['engine', 'cli', 'tools', 'tests', 'prompts', 'web', 'db'];
const EXTENSIONS = /\.(ts|tsx|js|mjs|sql|css|html)$/;

function* files(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'fixtures') yield* files(path);
    } else if (EXTENSIONS.test(name)) yield path;
  }
}

const over = ROOTS.flatMap((root) => [...files(root)])
  .map((path) => ({ path, lines: readFileSync(path, 'utf8').split('\n').length }))
  .filter((f) => f.lines > LIMIT);
for (const f of over) console.error(`${f.path}: ${f.lines} lines (limit ${LIMIT})`);
if (over.length) process.exit(1);
console.log('File size rule: ok');
