// Writes <file>.sha256 in the `shasum -a 256` format, so downloads can be checked with standard tools.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) throw new Error('usage: checksum.mjs <file>');
const sum = createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(`${file}.sha256`, `${sum}  ${basename(file)}\n`);
console.log(`${basename(file)} sha256 ${sum}`);
