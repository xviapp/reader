import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { useReducedMotion } from '@/core/ui/reduced-motion';

export function AiActivityDots({ compact = false }: { compact?: boolean }) {
  const { palette } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [values] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]);

  useEffect(() => {
    if (reduceMotion) {
      values.forEach((value) => value.setValue(0));
      return undefined;
    }
    const group = Animated.parallel(values.map((value, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 120),
      Animated.timing(value, { duration: 240, toValue: 1, useNativeDriver: true }),
      Animated.timing(value, { duration: 240, toValue: 0, useNativeDriver: true }),
      Animated.delay((2 - index) * 120 + 180),
    ]))));
    group.start();
    return () => group.stop();
  }, [reduceMotion, values]);

  const size = compact ? 5 : 7;
  return (
    <View accessibilityLabel="正在生成" accessibilityRole="progressbar" style={[styles.dots, compact && styles.compact]}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            backgroundColor: palette.brand,
            borderRadius: size,
            height: size,
            opacity: reduceMotion ? 0.82 : value.interpolate({ inputRange: [0, 1], outputRange: [0.48, 1] }),
            transform: [{ translateY: reduceMotion ? 0 : value.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
            width: size,
          }}
        />
      ))}
    </View>
  );
}

export function UnreadDot({ label = '有未读回复' }: { label?: string }) {
  const { palette } = useAppTheme();
  return <View accessibilityLabel={label} style={[styles.unread, { backgroundColor: palette.brand }]} />;
}

const styles = StyleSheet.create({
  dots: { alignItems: 'center', flexDirection: 'row', gap: 5, height: 16, justifyContent: 'center', minWidth: 32 },
  compact: { gap: 3, height: 12, minWidth: 22 },
  unread: { borderRadius: 8, height: 8, width: 8 },
});

