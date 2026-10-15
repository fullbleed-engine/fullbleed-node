// SPDX-License-Identifier: MIT
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { writeInvoice } from './invoice.mjs';

const output = resolve(process.argv[2] ?? 'output/components-tsx');
await mkdir(output, { recursive: true });
const compiled = join(output, 'invoice.mjs');
await build({ entryPoints: [fileURLToPath(new URL('./invoice.tsx', import.meta.url))], outfile: compiled,
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' });
const { Invoice } = await import(pathToFileURL(compiled).href);
const data = JSON.parse(await readFile(new URL('./data.json', import.meta.url), 'utf8'));
await writeInvoice(Invoice({ data }), output);
