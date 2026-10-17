import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { ComponentType, PropsWithChildren, ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { iconography, appHeaderHeight, radius, spacing, type Palette } from '@/core/design/tokens';

export type HostIcon = ComponentType<{
  color?: ColorValue;
  size?: number;
  strokeWidth?: number;
}>;

export function AppScreen({
  children,
  scroll = true,
  contentStyle,
}: PropsWithChildren<{
  scroll?: boolean;
  contentStyle?: object;
}>) {
  const styles = useThemedStyles(createStyles);
  if (!scroll) return <View style={[styles.screen, styles.content, contentStyle]}>{children}</View>;
  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      {children}
    </ScrollView>
  );
}

export function SubpageHeader({
  title,
  subtitle,
  action,
  onBack,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  onBack?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.subpageHeader}>
      <IconButton icon={ArrowLeft} label="返回" onPress={onBack ?? (() => router.back())} />
      <View style={styles.subpageHeaderCopy}>
        <Text numberOfLines={1} style={styles.subpageTitle}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.subpageSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  icon: HostIcon;
  label: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        selected && styles.iconButtonSelected,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={selected ? palette.primary : palette.text} size={iconography.navigation} strokeWidth={iconography.stroke} />
    </Pressable>
  );
}

export function ListRow({
  title,
  detail,
  icon: Icon,
  trailing,
  onPress,
}: {
  title: string;
  detail?: string;
  icon?: HostIcon;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const content = (
    <>
      {Icon ? <View style={styles.rowIcon}><Icon color={palette.primary} size={iconography.action} strokeWidth={iconography.stroke} /></View> : null}
      <View style={styles.rowCopy}>
        <Text numberOfLines={2} style={styles.rowTitle}>{title}</Text>
        {detail ? <Text numberOfLines={2} style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

export function StatusLabel({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const color = tone === 'success'
    ? palette.success
    : tone === 'warning'
      ? palette.warning
      : tone === 'danger'
        ? palette.danger
        : tone === 'info'
          ? palette.info
          : palette.textMuted;
  return (
    <View style={[styles.statusLabel, { borderColor: color }]}>
      <Text style={[styles.statusLabelText, { color }]}>{label}</Text>
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export function AppButton({
  label,
  icon: Icon,
  onPress,
  disabled = false,
  danger = false,
}: {
  label: string;
  icon?: HostIcon;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const foreground = danger ? palette.danger : palette.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.appButton,
        danger ? styles.dangerButton : styles.primaryButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {Icon ? <Icon color={foreground} size={iconography.action} strokeWidth={iconography.stroke} /> : null}
      <Text style={[styles.appButtonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { backgroundColor: palette.canvas, flex: 1 },
    content: {
      alignSelf: 'center',
      flex: 1,
      gap: spacing.md,
      maxWidth: 920,
      paddingBottom: spacing.xl,
      paddingHorizontal: spacing.lg,
      width: '100%',
    },
    scrollContent: {
      alignSelf: 'center',
      flexGrow: 1,
      gap: spacing.md,
      maxWidth: 920,
      paddingBottom: spacing.xxl,
      paddingHorizontal: spacing.lg,
      width: '100%',
    },
    subpageHeader: {
      alignItems: 'center',
      borderBottomColor: palette.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: spacing.sm,
      minHeight: appHeaderHeight,
      paddingVertical: spacing.xs,
    },
    subpageHeaderCopy: { flex: 1, minWidth: 0 },
    subpageTitle: { color: palette.text, fontSize: 20, lineHeight: 28, fontWeight: '700' },
    subpageSubtitle: { color: palette.textMuted, fontSize: 12, lineHeight: 18, marginTop: 2 },
    iconButton: {
      alignItems: 'center',
      borderRadius: radius.control,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    iconButtonSelected: { backgroundColor: palette.primarySoft },
    disabled: { opacity: 0.42 },
    pressed: { opacity: 0.68 },
    listRow: {
      alignItems: 'center',
      borderBottomColor: palette.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 68,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    rowPressed: { backgroundColor: palette.surfaceMuted },
    rowIcon: {
      alignItems: 'center',
      backgroundColor: palette.primarySoft,
      borderRadius: radius.control,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: palette.text, fontSize: 16, fontWeight: '600' },
    rowDetail: { color: palette.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
    rowTrailing: { alignItems: 'flex-end', justifyContent: 'center' },
    statusLabel: {
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    statusLabelText: { fontSize: 11, fontWeight: '700' },
    sectionHeader: {
      color: palette.text,
      fontSize: 16,
      fontWeight: '700',
      marginTop: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    appButton: {
      alignItems: 'center',
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      minHeight: 46,
      paddingHorizontal: spacing.xl,
    },
    primaryButton: { backgroundColor: palette.primary, borderColor: palette.primary },
    dangerButton: { backgroundColor: palette.surface, borderColor: palette.danger },
    appButtonText: { fontSize: 15, fontWeight: '700' },
  });
}
