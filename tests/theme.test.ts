import { describe, expect, it } from 'vitest';

import { isThemeMode, paletteFor } from '@/core/design/theme-values';
import { darkPalette, lightPalette, oledPalette } from '@/core/design/tokens';

describe('阅读主题', () => {
  it('resolves system mode against the platform preference', () => {
    expect(paletteFor('system', false)).toMatchObject({ palette: lightPalette, isDark: false });
    expect(paletteFor('system', true)).toMatchObject({ palette: darkPalette, isDark: true });
  });

  it('keeps explicit OLED mode independent from the system preference', () => {
    expect(paletteFor('oled', false)).toMatchObject({ palette: oledPalette, isDark: true });
  });

  it('accepts only persisted theme modes', () => {
    expect(['system', 'light', 'dark', 'oled'].every(isThemeMode)).toBe(true);
    expect(isThemeMode('sepia')).toBe(false);
  });
});
