import {
  darkPalette,
  lightPalette,
  oledPalette,
  type Palette,
  type ThemeMode,
} from './tokens';

export interface ResolvedTheme {
  mode: ThemeMode;
  palette: Palette;
  isDark: boolean;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'oled';
}

export function paletteFor(mode: ThemeMode, systemIsDark: boolean): ResolvedTheme {
  const effective = mode === 'system' ? (systemIsDark ? 'dark' : 'light') : mode;
  return {
    mode,
    palette: effective === 'light' ? lightPalette : effective === 'oled' ? oledPalette : darkPalette,
    isDark: effective !== 'light',
  };
}


