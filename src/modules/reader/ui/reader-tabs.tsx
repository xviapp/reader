import { Pressable, StyleSheet, Text, View } from 'react-native';

import { spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { UnreadDot } from '@/core/ui/ai-activity';

export interface ReaderFlatTabItem<T extends string> {
  value: T;
  label: string;
  count: number | null;
  busy?: boolean;
  unread?: boolean;
}

export function ReaderFlatTabs<T extends string>({ active, items, onChange }: {
  active: T;
  items: readonly ReaderFlatTabItem<T>[];
  onChange: (value: T) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {items.map((item) => {
        const selected = item.value === active;
        return (
          <Pressable
            accessibilityLabel={`${item.label}，${item.count === null ? item.busy ? '正在读取' : '数量不可用' : `${item.count} 项`}`}
            accessibilityRole="tab"
            accessibilityState={{ busy: item.busy === true, selected }}
            key={item.value}
            onPress={() => onChange(item.value)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View style={styles.tabLabelRow}>
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{item.label}</Text>
              <Text style={[styles.tabCount, selected && styles.tabCountActive]}>{item.count === null ? '…' : item.count}</Text>
              {item.unread ? <UnreadDot /> : null}
            </View>
            {selected ? <View style={styles.tabIndicator} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    tabs: { backgroundColor: palette.canvas, borderBottomColor: palette.border, borderBottomWidth: 1, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row' },
    tab: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 50, position: 'relative' },
    tabLabelRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
    tabLabel: { color: palette.textMuted, fontSize: 14, fontWeight: '600' },
    tabLabelActive: { color: palette.brand, fontWeight: '800' },
    tabCount: { color: palette.textSubtle, fontSize: 12 },
    tabCountActive: { color: palette.brand },
    tabIndicator: { backgroundColor: palette.brand, bottom: 0, height: 3, position: 'absolute', width: 32 },
    pressed: { opacity: 0.66 },
  });
}
