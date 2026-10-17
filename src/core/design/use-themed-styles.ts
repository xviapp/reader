import { useMemo } from 'react';

import { useAppTheme } from './theme';
import type { Palette } from './tokens';

export function useThemedStyles<T>(factory: (palette: Palette) => T): T {
  const { palette } = useAppTheme();
  return useMemo(() => factory(palette), [factory, palette]);
}

