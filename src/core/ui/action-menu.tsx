import type { LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/core/design/theme';
import { appHeaderHeight, interaction, minimumTouchTarget, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { useReducedMotion } from '@/core/ui/reduced-motion';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Dropdown action menu anchored under the top-right header "…" affordance.
 * A single implementation keeps Book / Discussion / Grass menus visually
 * consistent instead of each module carrying its own copy.
 */
export function ActionMenu({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: readonly ActionMenuItem[] }) {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const reducedMotion = useReducedMotion();
  return (
    <Modal animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose} transparent visible={visible}>
      <View style={[styles.menuOverlay, { paddingTop: insets.top + appHeaderHeight, paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable accessibilityLabel="关闭菜单" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <ScrollView accessibilityViewIsModal style={styles.menuPanel}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: Boolean(item.disabled) }}
                disabled={item.disabled}
                key={item.key}
                onPress={() => { onClose(); item.onPress(); }}
                style={({ pressed }) => [styles.menuItem, item.disabled && styles.disabled, pressed && styles.pressed]}
              >
                <Icon color={item.danger ? palette.danger : palette.textMuted} size={20} />
                <Text style={[styles.menuLabel, item.danger && { color: palette.danger }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    menuOverlay: { alignItems: 'flex-end', backgroundColor: palette.overlay, flex: 1, paddingHorizontal: spacing.lg },
    menuPanel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, flexGrow: 0, flexShrink: 1, maxWidth: '100%', minWidth: 220, paddingVertical: spacing.xs },
    menuItem: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: minimumTouchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    menuLabel: { ...typography.body, color: palette.text, flex: 1 },
    disabled: { opacity: interaction.disabledOpacity },
    pressed: { opacity: interaction.pressedOpacity },
  });
}
