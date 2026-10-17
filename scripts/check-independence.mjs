#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;
assert.equal(pkg.name, 'app.xvi.reader');
assert.equal(app.android.package, pkg.name);
assert.equal(app.version, pkg.version);
assert.equal(app.slug, 'reader');
assert.equal(app.scheme, 'xvi-reader');
assert.deepEqual(app.platforms, ['android']);
assert.equal(app.android.allowBackup, false);
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  assert(!/^(?:workspace:|file:|link:|\.\.?\/|\/)/.test(version), `External filesystem dependency: ${name}`);
}
for (const asset of [app.icon, app.android.adaptiveIcon.foregroundImage]) {
  assertLocal(resolve(root, asset));
  assert(existsSync(resolve(root, asset)), `Missing local asset: ${asset}`);
}

let count = 0;
for (const entry of readdirSync(root)) {
  if (entry.startsWith('.') || ['node_modules', 'android', 'ios', 'dist', 'coverage'].includes(entry)) continue;
  visit(resolve(root, entry));
}
console.log(`Independent project verified: ${count} local files; package ${pkg.name}; no external project dependencies.`);

function assertLocal(path) {
  const local = relative(root, realpathSync(path));
  assert(!local.startsWith(`..${sep}`) && local !== '..' && !isAbsolute(local), `External file reference: ${path}`);
}

function visit(path) {
  assertLocal(path);
  const stat = lstatSync(path);
  assert(!stat.isSymbolicLink(), `Project-owned symlink: ${path}`);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) visit(resolve(path, entry));
    return;
  }
  count += 1;
  if (!/\.(?:[cm]?js|tsx?|json|ya?ml|kt|gradle|xml)$/.test(path)) return;
  // The guard script necessarily contains the names it rejects.
  if (path.endsWith('/scripts/check-independence.mjs')) return;
  const source = readFileSync(path, 'utf8');
  assert(!/(?:app\.xvi\/shared|(?:\.\.\/)+shared(?:\/|['"]))/u.test(source), 'External shared reference: ' + path);
  assert(!/(?:\.\.\/|\/home\/)[^'"\s]*app\.xvi\.one/.test(source), `Source-project reference: ${path}`);
  assert(!/from\s+['"]@\/modules\/(?!reader(?:['"/]))/.test(source), `Other module import: ${path}`);
  assert(!/one-module-tasks|one-ai-execution|one-native-media|app\.xvi\.(?:one|chase)/.test(source), `Collection dependency: ${path}`);
}
