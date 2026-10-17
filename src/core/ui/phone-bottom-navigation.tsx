import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { iconography, bottomNavigationItemHeight, interaction, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { useKeyboardVisible } from '@/core/ui/keyboard-layout';
import { useReducedMotion } from '@/core/ui/reduced-motion';
import { UnreadDot } from '@/core/ui/ai-activity';

const NAV_ANIMATION_MS = 160;

export interface PhoneBottomNavigationItem<Value extends string> {
  value: Value;
  label: string;
  icon: LucideIcon;
  unread?: boolean;
  unreadLabel?: string;
}

interface PhoneBottomNavigationProps<Value extends string> {
  active: Value;
  items: readonly PhoneBottomNavigationItem<Value>[];
  onSelect(value: Value): void;
  bottomInset?: number;
}

export function PhoneBottomNavigation<Value extends string>({
  active,
  items,
  onSelect,
  bottomInset = 0,
}: PhoneBottomNavigationProps<Value>) {
  const styles = useThemedStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const keyboardVisible = useKeyboardVisible();
  const { fontScale } = useWindowDimensions();
  const itemHeight = Math.max(bottomNavigationItemHeight, 30 + typography.caption.lineHeight * fontScale);

  if (keyboardVisible) return null;

  return (
    <View
      accessibilityLabel="主导航"
      accessibilityRole="tablist"
      style={[styles.bar, { height: itemHeight + bottomInset, paddingBottom: bottomInset }]}
    >
      {items.map((item) => (
        <PhoneBottomNavigationButton
          item={item}
          itemHeight={itemHeight}
          key={item.value}
          onPress={() => onSelect(item.value)}
          reduceMotion={reduceMotion}
          selected={active === item.value}
        />
      ))}
    </View>
  );
}

function PhoneBottomNavigationButton<Value extends string>({
  item,
  itemHeight,
  onPress,
  reduceMotion,
  selected,
}: {
  item: PhoneBottomNavigationItem<Value>;
  itemHeight: number;
  onPress(): void;
  reduceMotion: boolean;
  selected: boolean;
}) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [progress] = useState(() => new Animated.Value(selected ? 1 : 0));

  useEffect(() => {
    progress.stopAnimation();
    if (reduceMotion) {
      progress.setValue(selected ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      duration: NAV_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      isInteraction: false,
      toValue: selected ? 1 : 0,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, selected]);

  const Icon = item.icon;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, { height: itemHeight }, pressed && styles.pressed]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.pill, { height: itemHeight - spacing.sm, opacity: progress, transform: [{ scale }] }]}
      />
      <View style={styles.foreground}>
        <View style={styles.iconWrap}>
          <Icon
            color={selected ? palette.primary : palette.textMuted}
            size={iconography.navigation}
            strokeWidth={iconography.stroke}
          />
          {item.unread ? <View style={styles.unread}><UnreadDot {...(item.unreadLabel ? { label: item.unreadLabel } : {})} /></View> : null}
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: selected ? palette.primary : palette.textMuted },
            selected && styles.labelSelected,
          ]}
        >
          {item.label}
        </Text>
      </View>
    </Pressable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    bar: {
      alignItems: 'flex-start',
      backgroundColor: palette.nav,
      borderTopColor: palette.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    item: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      maxWidth: 88,
      minWidth: 0,
    },
    pill: {
      backgroundColor: palette.primarySoft,
      borderRadius: radius.pill,
      position: 'absolute',
      width: 64,
    },
    foreground: { alignItems: 'center', gap: 1, justifyContent: 'center' },
    iconWrap: { position: 'relative' },
    label: { ...typography.caption },
    labelSelected: { fontWeight: '600' },
    pressed: { opacity: interaction.pressedOpacity },
    unread: { position: 'absolute', right: -5, top: -3 },
  });
}
