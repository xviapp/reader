import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseOptions, selectDevice } from '../scripts/install-android.mjs';

describe('Android install command', () => {
  it('previews the command without changing versions or requiring a device', () => {
    const packagePath = new URL('../package.json', import.meta.url);
    const before = readFileSync(packagePath, 'utf8');
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/install-android.mjs', import.meta.url)), '--dry-run'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No changes made');
    expect(readFileSync(packagePath, 'utf8')).toBe(before);
  });

  it('accepts explicit targets and safe preview options', () => {
    expect(parseOptions(['--', '--device=phone', '--arch', 'arm64-v8a', '--skip-build', '--dry-run'])).toMatchObject({
      serial: 'phone',
      arch: 'arm64-v8a',
      skipBuild: true,
      dryRun: true,
    });
    expect(() => parseOptions(['--device'])).toThrow();
    expect(() => parseOptions(['--arch=invalid'])).toThrow();
    expect(() => parseOptions(['--unknown'])).toThrow();
  });

  it('requires one authorized device or an explicit authorized target', () => {
    expect(selectDevice('List of devices attached\nphone\tdevice\n', '')).toBe('phone');
    expect(() => selectDevice('List of devices attached\n', '')).toThrow();
    expect(() => selectDevice('phone\tunauthorized\n', '')).toThrow();
    expect(() => selectDevice('phone\tdevice\nemulator\tdevice', '')).toThrow();
    expect(selectDevice('phone\tdevice\nemulator\tdevice', 'phone')).toBe('phone');
    expect(() => selectDevice('phone\toffline', 'phone')).toThrow();
  });
});
