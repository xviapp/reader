import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { localState } from '@/core/storage/local-state';

import { isThemeMode, paletteFor } from './theme-values';
import type { Palette, ThemeMode } from './tokens';

export interface AppThemeValue {
  mode: ThemeMode;
  palette: Palette;
  isDark: boolean;
  ready: boolean;
  setMode(mode: ThemeMode): Promise<void>;
}

export interface ThemeProviderProps extends PropsWithChildren {
  storageKey: string;
}

const ThemeContext = createContext<AppThemeValue | null>(null);

export function ThemeProvider({ children, storageKey }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void localState.getItem(storageKey).then((stored) => {
      if (!active) return;
      if (isThemeMode(stored)) setModeState(stored);
      setReady(true);
    }).catch(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [storageKey]);

  const setMode = useCallback(async (nextMode: ThemeMode) => {
    setModeState(nextMode);
    await localState.setItem(storageKey, nextMode);
  }, [storageKey]);

  const value = useMemo<AppThemeValue>(() => ({
    ...paletteFor(mode, systemScheme === 'dark'),
    ready,
    setMode,
  }), [mode, ready, setMode, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): AppThemeValue {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useAppTheme must be used inside ThemeProvider');
  return theme;
}
