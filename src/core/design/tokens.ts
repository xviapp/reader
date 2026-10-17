import { createBrandPalettes, type BrandTheme } from './brand-theme';

export * from './brand-theme';

// Local application identity; shared palettes come from the synced brand-theme.ts.
export const { lightPalette, darkPalette, oledPalette } = createBrandPalettes('reader');

export const brandIdentity: BrandTheme = 'reader';
