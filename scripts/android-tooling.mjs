import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const androidProjectPath = resolve(projectRoot, 'android');

export function androidBuildEnvironment() {
  const candidates = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME].filter(Boolean);
  const sdk = candidates.find((candidate) => (
    existsSync(join(candidate, 'platform-tools', 'adb'))
    || existsSync(join(candidate, 'platform-tools', 'adb.exe'))
  ));
  if (!sdk) return { ...process.env };
  return { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
}

export function run(command, args, cwd, env) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

export function syncAndroidProject(environment) {
  return run(
    'pnpm',
    ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install', '--no-clean'],
    projectRoot,
    environment,
  );
}

export function gradleCommand() {
  return process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
}
