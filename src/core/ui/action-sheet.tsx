import { X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';

import type { ActionMenuItem } from './action-menu';

export function ActionSheet({
  visible,
  title,
  subtitle,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  items: readonly ActionMenuItem[];
  onClose: () => void;
}) {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel="关闭操作菜单" onPress={onClose} style={styles.overlay}>
        <Pressable accessibilityRole="menu" onPress={() => undefined} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text numberOfLines={2} style={styles.title}>{title}</Text>
              {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
              <X color={palette.textMuted} size={21}  strokeWidth={iconography.stroke} />
            </Pressable>
          </View>
          <ScrollView bounces={false} contentContainerStyle={styles.items} showsVerticalScrollIndicator={false}>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Pressable
                  accessibilityRole="menuitem"
                  disabled={item.disabled}
                  key={item.key}
                  onPress={() => { onClose(); item.onPress(); }}
                  style={({ pressed }) => [styles.item, item.disabled && styles.disabled, pressed && styles.pressed]}
                >
                  <Icon color={item.danger ? palette.danger : palette.textMuted} size={21} />
                  <Text style={[styles.label, item.danger && styles.labelDanger]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { alignItems: 'center', backgroundColor: palette.overlay, flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.md, paddingTop: spacing.xxl },
    sheet: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, maxHeight: '82%', maxWidth: 620, overflow: 'hidden', width: '100%' },
    header: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { color: palette.text, fontSize: 17, fontWeight: '700', lineHeight: 23 },
    subtitle: { color: palette.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
    close: { alignItems: 'center', borderRadius: radius.control, height: 40, justifyContent: 'center', width: 40 },
    items: { paddingVertical: spacing.xs },
    item: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.lg },
    label: { color: palette.text, flex: 1, fontSize: 15, lineHeight: 21 },
    labelDanger: { color: palette.danger },
    disabled: { opacity: 0.36 },
    pressed: { opacity: 0.66 },
  });
}
