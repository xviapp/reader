#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist/lan-web');
const contract = readFileSync(join(root, 'src/modules/reader/lan/contracts.ts'), 'utf8');
const protocolVersion = Number(/READER_LAN_PROTOCOL_VERSION = (\d+)/u.exec(contract)?.[1]);
if (!Number.isSafeInteger(protocolVersion)) throw new Error('Missing LAN protocol version');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const list = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === 'node_modules') return [];
  const path = prefix + entry.name;
  return entry.isDirectory() ? list(join(directory, entry.name), `${path}/`) : [path];
}).sort();
const inputs = [...list(join(root, 'web')).map((path) => `web/${path}`),
  'src/modules/reader/lan/contracts.ts', 'scripts/build-reader-web.mjs', 'package.json', 'pnpm-lock.yaml'];
const sourceHash = hash(inputs.map((path) => `${path}\0${hash(readFileSync(join(root, path)))}`).join('\n'));

if (!process.argv.includes('--check')) {
  await build({ configFile: join(root, 'web/vite.config.ts') });
  const files = Object.fromEntries(list(output).map((path) => {
    if (path !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+$/u.test(path)) throw new Error(`Unexpected web output: ${path}`);
    return [path, hash(readFileSync(join(output, path)))];
  }));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ protocolVersion, sourceHash, files }, null, 2));
}
if (!existsSync(join(output, 'manifest.json'))) throw new Error('Missing web manifest; run pnpm build:web');
const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
if (manifest.protocolVersion !== protocolVersion || manifest.sourceHash !== sourceHash) throw new Error('Stale web assets or incompatible protocol');
if (!manifest.files['index.html']) throw new Error('Web entry is missing');
for (const [path, digest] of Object.entries(manifest.files)) {
  if ((path !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+$/u.test(path)) || hash(readFileSync(join(output, path))) !== digest) throw new Error('Web asset hash mismatch');
}
const assetIndex = process.argv.indexOf('--assets');
if (assetIndex >= 0) {
  const target = process.argv[assetIndex + 1];
  if (!target) throw new Error('--assets requires an output directory');
  const previousPath = join(target, 'manifest.json');
  const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : null;
  mkdirSync(target, { recursive: true });
  cpSync(output, target, { recursive: true });
  // A previous manifest identifies this as generated output. Include orphaned
  // assets from older builds, while preserving files outside the assets whitelist.
  for (const path of previous?.files ? list(target) : []) {
    if (/^assets\/[a-zA-Z0-9_.-]+$/u.test(path) && !Object.hasOwn(manifest.files, path) && existsSync(join(target, path))) unlinkSync(join(target, path));
  }
}
console.log(`Reader LAN web verified: protocol ${protocolVersion}, ${Object.keys(manifest.files).length} files`);
