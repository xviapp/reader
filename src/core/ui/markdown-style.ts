import type { MarkdownStyle } from 'react-native-enriched-markdown';

import type { Palette } from '@/core/design/tokens';

export function createAppMarkdownStyle(
  palette: Palette,
  fontSize: number,
  serif = false,
): MarkdownStyle {
  const font = serif ? { fontFamily: 'serif' } : {};
  return {
    paragraph: { color: palette.text, fontSize, lineHeight: Math.round(fontSize * 1.62), marginBottom: 10, ...font },
    h1: { color: palette.text, fontSize: fontSize + 8, lineHeight: fontSize + 14, ...font },
    h2: { color: palette.text, fontSize: fontSize + 5, lineHeight: fontSize + 11, ...font },
    h3: { color: palette.text, fontSize: fontSize + 2, lineHeight: fontSize + 8, ...font },
    h4: { color: palette.text, fontSize: fontSize + 1, lineHeight: fontSize + 7, ...font },
    h5: { color: palette.text, fontSize, lineHeight: Math.round(fontSize * 1.5), ...font },
    h6: { color: palette.textMuted, fontSize, lineHeight: Math.round(fontSize * 1.5), ...font },
    list: {
      color: palette.text,
      fontSize,
      lineHeight: Math.round(fontSize * 1.62),
      marginBottom: 10,
      bulletColor: palette.textMuted,
      markerColor: palette.textMuted,
      markerFontWeight: '600',
      ...(serif ? { fontFamily: 'serif' } : {}),
    },
    blockquote: { color: palette.text, borderColor: palette.brand, backgroundColor: palette.surfaceSoft, borderWidth: 3, gapWidth: 10 },
    link: { color: palette.info, underline: true },
    strong: { color: palette.text },
    em: { color: palette.text },
    code: { color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: Math.max(13, fontSize - 2) },
    codeBlock: { color: palette.text, backgroundColor: palette.surfaceMuted, borderColor: palette.border, borderWidth: 1, borderRadius: 6, padding: 10 },
    table: {
      color: palette.text,
      fontSize: Math.max(13, fontSize - 1),
      lineHeight: Math.round(fontSize * 1.45),
      borderColor: palette.border,
      borderWidth: 1,
      headerBackgroundColor: palette.surfaceMuted,
      headerTextColor: palette.text,
      rowEvenBackgroundColor: palette.surface,
      rowOddBackgroundColor: palette.surfaceSoft,
    },
    thematicBreak: { color: palette.border, height: 1, marginTop: 12, marginBottom: 12 },
    math: { color: palette.text, fontSize, backgroundColor: palette.surfaceSoft, padding: 8, textAlign: 'center' },
    inlineMath: { color: palette.text },
  };
}

