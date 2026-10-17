import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Linking } from 'react-native';

import { useAppTheme } from '@/core/design/theme';

import { createAppMarkdownStyle } from './markdown-style';

export function AppMarkdown({ content, fontSize = 16, serif = false, allowLinks = true, onLinkPress }: { content: string; fontSize?: number; serif?: boolean; allowLinks?: boolean; onLinkPress?: (url: string) => void }) {
  const { palette } = useAppTheme();
  return (
    <EnrichedMarkdownText
      flavor="github"
      markdown={content || ' '}
      markdownStyle={createAppMarkdownStyle(palette, fontSize, serif)}
      md4cFlags={{ latexMath: true }}
      {...(allowLinks ? { onLinkPress: ({ url }: { url: string }) => { if (onLinkPress) onLinkPress(url); else void Linking.openURL(url); } } : {})}
      selectable
    />
  );
}

