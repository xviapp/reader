import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../metro.config.js');
class FailedToResolvePathError extends Error {}

function context(resolveRequest: ReturnType<typeof vi.fn>) {
  return {
    originModulePath: resolve('src/core/ai/direct-ai-adapter.ts'),
    resolveRequest,
  };
}

describe('Metro relative ESM imports', () => {
  it('retries a missing local .js import without its extension', () => {
    const result = { type: 'sourceFile', filePath: resolve('src/core/ai/ai-engine.ts') };
    const delegate = vi.fn()
      .mockImplementationOnce(() => { throw new FailedToResolvePathError(); })
      .mockReturnValueOnce(result);
    const ctx = context(delegate);
    expect(config.resolver.resolveRequest(ctx, './ai-engine.js', 'android')).toBe(result);
    expect(delegate).toHaveBeenNthCalledWith(2, ctx, './ai-engine', 'android');
  });

  it('preserves an existing JavaScript resolution', () => {
    const result = { type: 'sourceFile', filePath: '/existing.js' };
    const delegate = vi.fn().mockReturnValue(result);
    expect(config.resolver.resolveRequest(context(delegate), './existing.js', 'android')).toBe(result);
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  it.each(['some-package.js', './ai-engine', '../../../../outside.js'])(
    'does not rewrite %s', (name) => {
      const error = new FailedToResolvePathError();
      const delegate = vi.fn(() => { throw error; });
      expect(() => config.resolver.resolveRequest(context(delegate), name, 'android')).toThrow(error);
      expect(delegate).toHaveBeenCalledTimes(1);
    },
  );

  it('does not hide unrelated resolver failures', () => {
    const error = new Error('Invalid package configuration');
    const delegate = vi.fn(() => { throw error; });
    expect(() => config.resolver.resolveRequest(context(delegate), './ai-engine.js', 'android')).toThrow(error);
    expect(delegate).toHaveBeenCalledTimes(1);
  });
});
