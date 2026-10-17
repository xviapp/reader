#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  androidBuildEnvironment,
  androidProjectPath as androidPath,
  gradleCommand,
  projectRoot as root,
  run,
  syncAndroidProject,
} from './android-tooling.mjs';

const packagePath = resolve(root, 'package.json');
const appPath = resolve(root, 'app.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const archOption = readOption('--arch');

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const supportedArchitectures = new Set(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);
const architectures = (archOption ? archOption.split(',') : ['arm64-v8a', 'x86_64'])
  .map((value) => value.trim())
  .filter(Boolean);
if (architectures.length === 0 || architectures.some((value) => !supportedArchitectures.has(value))) {
  fail(`Invalid architecture list: ${archOption}. Use arm64-v8a, armeabi-v7a, x86 or x86_64.`);
}

const packageBefore = readFileSync(packagePath, 'utf8');
const appBefore = readFileSync(appPath, 'utf8');
const packageConfig = JSON.parse(packageBefore);
const appConfig = JSON.parse(appBefore);
const expoConfig = appConfig.expo;

if (!expoConfig || typeof expoConfig !== 'object') fail('app.json is missing expo configuration');
if (packageConfig.version !== expoConfig.version) {
  fail(`package.json (${packageConfig.version}) and app.json (${expoConfig.version}) versions differ`);
}

const nextVersion = bumpPatch(packageConfig.version);
const currentVersionCode = integerValue(expoConfig.android?.versionCode, 'expo.android.versionCode');
const nextVersionCode = currentVersionCode + 1;
const buildEnvironment = androidBuildEnvironment();

const packageAfter = replaceStringProperty(packageBefore, 'version', nextVersion, 'package.json');
let appAfter = replaceStringProperty(appBefore, 'version', nextVersion, 'app.json');
appAfter = replaceNumberProperty(appAfter, 'versionCode', nextVersionCode, 'app.json');

console.log(`Version: ${packageConfig.version} -> ${nextVersion}`);
console.log(`Android versionCode: ${currentVersionCode} -> ${nextVersionCode}`);
console.log(`Android architectures: ${architectures.join(', ')}`);
if (buildEnvironment.ANDROID_SDK_ROOT) console.log(`Android SDK: ${buildEnvironment.ANDROID_SDK_ROOT}`);

if (dryRun) {
  console.log('Dry run: no files changed and no build started.');
  process.exit(0);
}

writeFileSync(packagePath, packageAfter);
writeFileSync(appPath, appAfter);

let restored = false;
const restoreVersionFiles = () => {
  if (restored) return;
  restored = true;
  writeFileSync(packagePath, packageBefore);
  writeFileSync(appPath, appBefore);
  console.error('Build failed; restored package.json and app.json version fields.');
};

try {
  const prebuildStatus = syncAndroidProject(buildEnvironment);
  if (prebuildStatus !== 0) {
    restoreVersionFiles();
    process.exit(prebuildStatus || 1);
  }

  // The bundler never removes assets an older build exported, so stale images would ship in the APK.
  for (const kind of ['res', 'assets']) {
    rmSync(resolve(androidPath, 'app/build/generated', kind, 'react/release'), { recursive: true, force: true });
  }

  const gradle = gradleCommand();
  const artifactDirectory = resolve(root, '.artifacts', 'android');
  mkdirSync(artifactDirectory, { recursive: true });

  for (const architecture of architectures) {
    const gradleArgs = [':app:assembleRelease', `-PreactNativeArchitectures=${architecture}`];
    const buildStatus = run(gradle, gradleArgs, androidPath, buildEnvironment);
    if (buildStatus !== 0) {
      restoreVersionFiles();
      process.exit(buildStatus || 1);
    }

    const apk = resolve(androidPath, 'app/build/outputs/apk/release/app-release.apk');
    const artifact = resolve(artifactDirectory, `reader-${nextVersion}-${architecture}.apk`);
    copyFileSync(apk, artifact);
    console.log(`APK (${architecture}): ${artifact}`);
  }
} catch (error) {
  restoreVersionFiles();
  throw error;
}

function readOption(name) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) fail(`Expected a semantic version such as 4.1.2, received: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function integerValue(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail(`${label} must be a non-negative integer`);
  return number;
}

function replaceStringProperty(source, property, value, fileLabel) {
  const pattern = new RegExp(`(\\"${property}\\"\\s*:\\s*\\")[^\\"]*(\\")`);
  if (!pattern.test(source)) fail(`${fileLabel} is missing string property ${property}`);
  return source.replace(pattern, `$1${value}$2`);
}

function replaceNumberProperty(source, property, value, fileLabel) {
  const pattern = new RegExp(`(\\"${property}\\"\\s*:\\s*)\\d+`);
  if (!pattern.test(source)) fail(`${fileLabel} is missing numeric property ${property}`);
  return source.replace(pattern, `$1${value}`);
}

function printHelp() {
  console.log(`Usage: pnpm build:android-apk [--arch=<architectures>] [--dry-run]

Increments the app patch version and Android versionCode, then syncs the Android
native project and assembles one APK per architecture.
Without --arch, arm64-v8a and x86_64 are both built.
Artifacts are written to .artifacts/android/.

Examples:
  pnpm build:android-apk
  pnpm build:android-apk:emulator
  pnpm build:android-apk -- --arch=arm64-v8a
  pnpm build:android-apk -- --arch=arm64-v8a,x86_64
  pnpm build:android-apk -- --dry-run`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
