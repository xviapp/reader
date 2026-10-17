import { BrandIllustration } from './brand-illustration';
import { ArrowLeft, RotateCcw, X } from 'lucide-react-native';
import { useState, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/core/design/theme';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { iconography, appHeaderHeight, interaction, minimumTouchTarget, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { KeyboardAvoidingSurface } from '@/core/ui/keyboard-layout';
import { useReducedMotion } from '@/core/ui/reduced-motion';

type IconType = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

export function AppHeader({
  title,
  subtitle,
  onBack,
  action,
  height,
}: {
  title: string;
  subtitle?: string;
  onBack?: (() => void) | undefined;
  action?: ReactNode;
  height?: number;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.header, height ? { minHeight: height } : null]}>
      {onBack ? <IconButton label="返回" icon={ArrowLeft} onPress={onBack} /> : null}
      <View style={styles.headerCopy}>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function ErrorNotice({ message, onRetry, retryLabel = '重试' }: { message: string; onRetry: () => void; retryLabel?: string }) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable
        accessibilityLabel={retryLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: false }}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, focused && styles.focusRing, pressed && styles.pressed]}
      >
        <RotateCcw color={palette.danger} size={16}  strokeWidth={iconography.stroke} />
        <Text style={styles.retryText}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View accessibilityLabel="正在读取数据" style={styles.skeletonList}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={[styles.skeletonLine, { width: `${72 - index * 4}%` }]} />
          <View style={[styles.skeletonLine, styles.skeletonLineSmall, { width: `${44 + index * 3}%` }]} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, detail, action }: { icon: IconType; title: string; detail?: string; action?: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.empty}>
      <BrandIllustration icon={Icon} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function IconButton({ icon: Icon, label, onPress, active = false, danger = false, disabled = false, fill }: { icon: IconType; label: string; onPress: () => void; active?: boolean; danger?: boolean; disabled?: boolean; fill?: string | undefined }) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={4}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, disabled && styles.disabled, focused && styles.focusRing, pressed && styles.pressed]}
    >
      <Icon color={danger ? palette.danger : active ? palette.brand : palette.textMuted} {...(fill ? { fill } : {})} size={iconography.action} strokeWidth={iconography.stroke} />
    </Pressable>
  );
}

export function ActionButton({ label, icon: Icon, onPress, disabled = false, secondary = false, danger = false }: { label: string; icon?: IconType | undefined; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const foreground = danger ? palette.danger : secondary ? palette.brand : palette.onPrimary;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.button, secondary ? styles.buttonSecondary : styles.buttonPrimary, danger && styles.buttonDanger, disabled && styles.disabled, focused && styles.focusRing, pressed && styles.pressed]}
    >
      {Icon ? <Icon color={foreground} size={iconography.action} strokeWidth={iconography.stroke} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function FormField({ label, value, onChangeText, placeholder, multiline = false, keyboardType, editable = true, trailing, accessibilityLabel, accessibilityHint }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string | undefined; multiline?: boolean; keyboardType?: KeyboardTypeOptions | undefined; editable?: boolean; trailing?: ReactNode | undefined; accessibilityLabel?: string | undefined; accessibilityHint?: string | undefined }) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View>
        <TextInput
          accessibilityHint={accessibilityHint}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled: !editable }}
          editable={editable}
          keyboardType={keyboardType}
          multiline={multiline}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={palette.textSubtle}
          selectionColor={palette.focus}
          style={[styles.input, multiline && styles.inputMultiline, trailing ? styles.inputWithTrailing : null, !editable && styles.disabled, focused && styles.inputFocused]}
          textAlignVertical={multiline ? 'top' : 'center'}
          value={value}
        />
        {trailing ? <View style={styles.inputTrailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

export function ChoiceChip({ label, selected, onPress, disabled = false, style }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, style, disabled && styles.disabled, focused && styles.focusRing, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, value, action }: { title: string; value?: string; action?: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {value ? <Text style={styles.sectionValue}>{value}</Text> : null}
      {action}
    </View>
  );
}

export function FormSheet({
  visible,
  title,
  subtitle,
  onClose,
  footer,
  busy = false,
  center = false,
  fullHeight = false,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  busy?: boolean;
  /** A short choice reads as a dialog; forms stay anchored to the bottom. */
  center?: boolean;
  /** Reserve space while an asynchronously loaded form is opening. */
  fullHeight?: boolean;
}>) {
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [presentation, setPresentation] = useState({ visible, animationType: reducedMotion ? 'none' as const : 'fade' as const });
  // Android recreates its native dialog if animationType changes while visible.
  // Resolve preference changes on the next opening, including a late initial read.
  if (presentation.visible !== visible) {
    setPresentation({ visible, animationType: visible ? reducedMotion ? 'none' : 'fade' : presentation.animationType });
  }
  const close = () => { if (!busy) onClose(); };
  return (
    <Modal animationType={presentation.animationType} onRequestClose={close} transparent visible={visible}>
      <KeyboardAvoidingSurface>
        <View style={[styles.overlay, center
          ? [styles.overlayCenter, { paddingBottom: Math.max(insets.bottom, spacing.lg), paddingLeft: spacing.lg, paddingRight: spacing.lg, paddingTop: Math.max(insets.top, spacing.lg) }]
          : { paddingLeft: insets.left, paddingRight: insets.right, paddingTop: insets.top + spacing.lg }]}>
          <Pressable accessibilityLabel="关闭表单" accessibilityRole="button" disabled={busy} onPress={close} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.sheet, fullHeight && styles.sheetFullHeight, center ? styles.sheetCenter : { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
                {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
              </View>
              <IconButton disabled={busy} icon={X} label="关闭" onPress={close} />
            </View>
            <ScrollView
              contentContainerStyle={styles.form}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              style={styles.sheetBody}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingSurface>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
  header: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, minHeight: appHeaderHeight, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { ...typography.pageTitle, color: palette.text },
  headerSubtitle: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
  pressed: { opacity: interaction.pressedOpacity },
  disabled: { opacity: interaction.disabledOpacity },
  error: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.danger, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  errorText: { ...typography.body, color: palette.danger, flex: 1 },
  retryButton: { alignItems: 'center', borderRadius: radius.control, flexDirection: 'row', gap: spacing.xs, minHeight: minimumTouchTarget, paddingHorizontal: spacing.sm },
  retryText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  skeletonList: { paddingHorizontal: spacing.lg },
  skeletonRow: { borderBottomColor: palette.border, borderBottomWidth: 1, gap: spacing.md, minHeight: 92, paddingVertical: spacing.lg },
  skeletonLine: { backgroundColor: palette.surfaceRaised, borderRadius: 3, height: 15 },
  skeletonLineSmall: { height: 11 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xxl },
  emptyTitle: { ...typography.title, color: palette.text, marginTop: spacing.lg, textAlign: 'center' },
  emptyDetail: { color: palette.textMuted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, maxWidth: 360, textAlign: 'center' },
  emptyAction: { marginTop: spacing.lg },
  iconButton: { alignItems: 'center', borderRadius: radius.control, height: minimumTouchTarget, justifyContent: 'center', width: minimumTouchTarget },
  iconButtonActive: { backgroundColor: palette.primarySoft },
  focusRing: { outlineColor: palette.focus, outlineWidth: 2, outlineOffset: 2 },
  button: { alignItems: 'center', borderRadius: radius.control, borderWidth: 1, flexDirection: 'row', flexShrink: 1, gap: spacing.sm, justifyContent: 'center', minHeight: minimumTouchTarget, minWidth: minimumTouchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonPrimary: { backgroundColor: palette.brand, borderColor: palette.brand },
  buttonSecondary: { backgroundColor: palette.surface, borderColor: palette.controlBorder },
  buttonDanger: { backgroundColor: palette.surface, borderColor: palette.danger },
  buttonText: { flexShrink: 1, fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'center' },
  inputWithTrailing: { paddingRight: 56 },
  inputTrailing: { bottom: spacing.xs, position: 'absolute', right: spacing.sm },
  chip: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.controlBorder, borderRadius: radius.control, borderWidth: 1, justifyContent: 'center', minHeight: minimumTouchTarget, minWidth: minimumTouchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { backgroundColor: palette.primarySoft, borderColor: palette.brand },
  chipText: { ...typography.label, color: palette.textMuted, textAlign: 'center' },
  chipTextSelected: { color: palette.brand, fontWeight: '700' },
  sectionHeader: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.lg },
  sectionTitle: { color: palette.text, flex: 1, fontSize: 16, fontWeight: '700' },
  sectionValue: { color: palette.textMuted, fontSize: 13 },
  overlay: { alignItems: 'center', backgroundColor: palette.overlay, flex: 1, justifyContent: 'flex-end' },
  overlayCenter: { justifyContent: 'center' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, maxHeight: '100%', maxWidth: 620, overflow: 'hidden', width: '100%' },
  sheetFullHeight: { height: '100%' },
  sheetCenter: { borderRadius: radius.sheet, maxHeight: '82%', paddingBottom: spacing.lg },
  sheetHeader: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, minHeight: appHeaderHeight, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  sheetHeaderCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { ...typography.title, color: palette.text },
  sheetSubtitle: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
  sheetBody: { flexShrink: 1 },
  sheetFooter: { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  form: { gap: spacing.lg, padding: spacing.lg },
  field: { gap: spacing.sm },
  fieldLabel: { ...typography.label, color: palette.textMuted },
  input: { backgroundColor: palette.canvas, borderColor: palette.controlBorder, borderRadius: radius.control, borderWidth: 1, color: palette.text, fontSize: 15, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inputFocused: { borderColor: palette.focus, outlineColor: palette.focus, outlineWidth: 1 },
  inputMultiline: { minHeight: 108 },
  });
}
