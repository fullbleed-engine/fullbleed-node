// SPDX-License-Identifier: MIT
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function buildCloudflare(root, manifest) {
  const path = 'dist/cloudflare.js';
  const result = await build({ absWorkingDir: root, entryPoints: ['src/cloudflare.js'],
    outfile: join(root, path), bundle: true, platform: 'browser', format: 'esm',
    target: 'es2022', legalComments: 'inline', metafile: true,
    external: ['*.wasm', '*.ttf'],
    define: { __FULLBLEED_PACKAGE_VERSION__: JSON.stringify(manifest.packageVersion),
      __FULLBLEED_ENGINE_VERSION__: JSON.stringify(manifest.engineVersion) } });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  if (imports.length !== 5 || imports.some(item => !item.external || !/\.(?:wasm|ttf)$/.test(item.path))) {
    throw new Error('The Workers adapter must only import its packaged Wasm and four font files.');
  }
  const bytes = await readFile(join(root, path));
  return { [path]: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}
