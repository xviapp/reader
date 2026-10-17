import type { ComponentType } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/core/design/theme';
import { iconography } from '@/core/design/tokens';
import { brandArtwork } from '@/core/design/brand-artwork';

type ContextIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

/** Decorative paper artwork; meaning stays in the adjacent title and action. */
export function BrandIllustration({ icon: Icon, completed = false, compact = false }: {
  icon?: ContextIcon;
  completed?: boolean;
  compact?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      pointerEvents="none" style={[styles.artwork, { width: compact ? 80 : 224 }]}>
      <Image source={completed ? brandArtwork.complete : brandArtwork.empty}
        style={styles.image} resizeMode="contain" fadeDuration={0} />
      {Icon && !compact && !completed ? <View style={[styles.badge, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Icon color={palette.primary} size={iconography.action} strokeWidth={iconography.stroke} />
      </View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  artwork: { maxWidth: '100%', aspectRatio: 1.5 },
  image: { width: '100%', height: '100%' },
  badge: { position: 'absolute', right: 0, bottom: 0, width: 36, height: 36, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
