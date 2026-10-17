#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { androidBuildEnvironment, projectRoot, run } from './android-tooling.mjs';

export function parseOptions(args) {
  const options = { serial: '', arch: '', dryRun: false, skipBuild: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (/^--(?:device|arch)(?:=|$)/u.test(arg)) {
      const key = arg.split('=')[0];
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++index];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${key}`);
      options[key === '--device' ? 'serial' : 'arch'] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.arch && !['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'].includes(options.arch)) {
    throw new Error('Unsupported architecture');
  }
  return options;
}

export function selectDevice(output, serial) {
  const devices = output
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 2 && !['List', '*'].includes(parts[0]));
  if (serial) {
    const device = devices.find((parts) => parts[0] === serial);
    if (!device || device[1] !== 'device') throw new Error(`Device ${serial} is not connected and authorized`);
    return serial;
  }
  if (devices.length !== 1 || devices[0][1] !== 'device') {
    throw new Error('Connect and authorize one device, or specify --device=<serial>');
  }
  return devices[0][0];
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: pnpm install:android [--device=<serial>] [--arch=<abi>] [--skip-build] [--dry-run]\nBuilds a release APK for the connected device, then installs it with adb install -r. The build increments the patch version. --skip-build installs the current artifact from .artifacts/android/.');
    return;
  }
  if (options.dryRun) {
    console.log(`Plan: ${options.skipBuild ? 'use current APK' : 'build release (increments patch version)'}; architecture=${options.arch || 'detect from device'}; device=${options.serial || 'require one authorized device'}; install with adb -s <device> install -r <apk>. No changes made.`);
    return;
  }

  const environment = androidBuildEnvironment();
  const adb = environment.ANDROID_SDK_ROOT
    ? resolve(environment.ANDROID_SDK_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    : 'adb';
  const query = (args) => {
    const result = spawnSync(adb, args, { env: environment, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'adb failed');
    return result.stdout.trim();
  };
  const serial = selectDevice(query(['devices']), options.serial);
  const supported = query(['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abilist']).split(',');
  const arch = options.arch || supported[0];
  if (!['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'].includes(arch) || !supported.includes(arch)) {
    throw new Error(`Architecture ${arch} is not supported by this device`);
  }

  if (!options.skipBuild) {
    const status = run(
      process.execPath,
      [resolve(projectRoot, 'scripts/build-android-apk.mjs'), `--arch=${arch}`],
      projectRoot,
      environment,
    );
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
  }

  const { version } = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const apk = resolve(projectRoot, '.artifacts/android', `reader-${version}-${arch}.apk`);
  if (!existsSync(apk)) throw new Error(`APK not found: ${apk}. Run without --skip-build first.`);
  process.exitCode = run(adb, ['-s', serial, 'install', '-r', apk], projectRoot, environment);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
