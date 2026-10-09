// SPDX-License-Identifier: MIT
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildBrowser(root, manifest) {
  const output = join(root, 'dist/browser');
  await mkdir(output, { recursive: true });
  const runtimeFiles = { 'engine.wasm': manifest.files['dist/engine.wasm'] };
  for (const name of manifest.fonts) runtimeFiles['fonts/' + name] = manifest.files['assets/fonts/' + name];
  const define = {
    __FULLBLEED_PACKAGE_VERSION__: JSON.stringify(manifest.packageVersion),
    __FULLBLEED_ENGINE_VERSION__: JSON.stringify(manifest.engineVersion),
    __FULLBLEED_RUNTIME_FILES__: JSON.stringify(runtimeFiles),
    __FULLBLEED_FONT_NAMES__: JSON.stringify(manifest.fonts),
  };
  for (const [input, name] of [['browser.js', 'client.js'], ['browser-worker.js', 'worker.js']]) {
    const result = await build({ absWorkingDir: root, entryPoints: ['src/' + input],
      outfile: join(output, name), bundle: true, platform: 'browser', format: 'esm',
      target: 'es2022', legalComments: 'inline', minify: false, metafile: true, define });
    if (Object.values(result.metafile.outputs).some(item => item.imports.length)) throw new Error('Browser assets must not import external runtime modules.');
  }
  const sources = {
    'client.js': 'dist/browser/client.js', 'worker.js': 'dist/browser/worker.js',
    'engine.wasm': 'dist/engine.wasm', 'THIRD_PARTY_NOTICES.txt': 'dist/THIRD_PARTY_NOTICES.txt', 'LICENSE.txt': 'LICENSE',
  };
  for (const name of Object.keys(manifest.files).filter(name => name.startsWith('assets/fonts/'))) sources[name.slice('assets/'.length)] = name;
  const files = {};
  for (const [name, source] of Object.entries(sources)) {
    const data = await readFile(join(root, source));
    files[name] = { source, bytes: data.length, sha256: hash(data) };
  }
  const publicManifest = { schema: 'fullbleed.browser-assets.v1', packageVersion: manifest.packageVersion,
    engineVersion: manifest.engineVersion, engineFeatures: manifest.engineFeatures, files };
  await writeFile(join(output, 'asset-manifest.json'), JSON.stringify(publicManifest, null, 2) + '\n');
  const outputs = {};
  for (const name of ['client.js', 'worker.js', 'asset-manifest.json']) {
    const path = 'dist/browser/' + name;
    const bytes = await readFile(join(root, path));
    outputs[path] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, 'dist/build.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  manifest.packageVersion = pkg.version;
  if (manifest.engineVersion !== pkg.fullbleed.engineVersion) throw new Error('Build the pinned engine before browser assets.');
  Object.assign(manifest.files, await buildBrowser(root, manifest));
  await writeFile(join(root, 'dist/build.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, browser: manifest.packageVersion, engine: manifest.engineVersion }));
}
