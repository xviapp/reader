import {
  BookOpen,
  ChevronRight,
  MessageCircle,
  Settings,
  type LucideIcon,
} from 'lucide-react-native';
import { type PropsWithChildren, type ReactNode } from 'react';
import {
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

import { useAppTheme } from '@/core/design/theme';
import { iconography, appHeaderHeight, radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import {
  PhoneBottomNavigation,
  type PhoneBottomNavigationItem,
} from '@/core/ui/phone-bottom-navigation';
import { AppMarkdown as CoreAppMarkdown } from '@/core/ui/markdown';
import {
  ActionButton,
  ChoiceChip,
  EmptyState,
  ErrorNotice,
  FormField,
  AppHeader,
  IconButton,
  SectionHeader,
  LoadingSkeleton,
} from '@/core/ui/app-controls';

import type { ReaderPrimaryName } from './navigation';

const readerDestinations: readonly PhoneBottomNavigationItem<ReaderPrimaryName>[] = [
  { value: 'library', label: '书架', icon: BookOpen },
  { value: 'discussions', label: '讨论', icon: MessageCircle },
  { value: 'settings', label: '设置', icon: Settings },
];

// AppHeader rounds subtitle and no-subtitle layouts differently on Android;
// one extra dp makes the primary Reader headers land on the same pixel row.
export const READER_PRIMARY_HEADER_HEIGHT = appHeaderHeight + 1;
export const READER_PRIMARY_ACTION_HEIGHT = 48;
const readerSettingsIconSize = 21;
const readerSettingsChevronSize = 19;

export function ReaderHeader({ title, subtitle, onBack, action, height }: { title: string; subtitle?: string | undefined; onBack?: (() => void) | undefined; action?: ReactNode | undefined; height?: number | undefined }) {
  return <AppHeader height={height ?? (subtitle ? READER_PRIMARY_HEADER_HEIGHT : 60)} title={title} {...(subtitle ? { subtitle } : {})} onBack={onBack} action={action} />;
}

export function ReaderIconButton({ icon: Icon, label, onPress, active = false, danger = false, disabled = false }: { icon: LucideIcon; label: string; onPress: () => void; active?: boolean; danger?: boolean; disabled?: boolean }) {
  return <IconButton active={active} danger={danger} disabled={disabled} icon={Icon} label={label} onPress={onPress} />;
}

export function ReaderBottomNav({ active, onSelect }: { active: ReaderPrimaryName; onSelect: (name: ReaderPrimaryName) => void }) {
  return <PhoneBottomNavigation active={active} items={readerDestinations} onSelect={onSelect} />;
}

export function ReaderPrimaryPane({ children, wide = false }: PropsWithChildren<{ wide?: boolean }>) {
  const styles = useReaderUiStyles();
  return <View style={[styles.primaryPane, wide && styles.primaryPaneWide]}>{children}</View>;
}

export function ReaderDetailPane({ children, wide = false }: PropsWithChildren<{ wide?: boolean }>) {
  const styles = useReaderUiStyles();
  return <View style={[styles.detailPane, wide && styles.detailPaneWide]}>{children}</View>;
}

export function ReaderScroll({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const styles = useReaderUiStyles();
  return <ScrollView contentContainerStyle={[styles.scrollContent, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}

export function ReaderSearch({ value, placeholder, onChangeText, style }: { value: string; placeholder: string; onChangeText: (value: string) => void; style?: StyleProp<ViewStyle> }) {
  const { palette } = useAppTheme();
  const styles = useReaderUiStyles();
  return (
    <View style={[styles.search, style]}>
      <TextInput
        accessibilityLabel={placeholder}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textSubtle}
        returnKeyType="search"
        style={styles.searchInput}
        value={value}
      />
    </View>
  );
}

export function ReaderEmpty({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail?: string; action?: ReactNode }) {
  return <EmptyState action={action} {...(detail ? { detail } : {})} icon={Icon} title={title} />;
}

export function ReaderError({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel?: string }) {
  return <ErrorNotice message={message} onRetry={onRetry} {...(retryLabel ? { retryLabel } : {})} />;
}

export function ReaderButton({ label, icon: Icon, onPress, disabled = false, secondary = false, danger = false }: { label: string; icon?: LucideIcon; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return <ActionButton danger={danger} disabled={disabled} icon={Icon} label={label} onPress={onPress} secondary={secondary} />;
}

export function ReaderSectionHeader({ title, value, action }: { title: string; value?: string | undefined; action?: ReactNode | undefined }) {
  return <SectionHeader action={action} title={title} {...(value ? { value } : {})} />;
}

export function ReaderSettingsRow({ icon: Icon, title, value, onPress, danger = false, insetDivider = false, variant = 'compact' }: { icon: LucideIcon; title: string; value?: string; onPress: () => void; danger?: boolean; insetDivider?: boolean; variant?: 'compact' | 'list' }) {
  const { palette } = useAppTheme();
  const styles = useReaderUiStyles();
  const listStyle = variant === 'list';
  const row = (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [listStyle ? styles.settingsRowList : styles.settingsRow, !listStyle && insetDivider && styles.settingsRowInset, pressed && (listStyle ? styles.settingsRowPressed : styles.pressed)]}>
      {listStyle ? (
        <View style={styles.settingsIconList}>
          <Icon color={danger ? palette.danger : palette.primary} size={20} />
        </View>
      ) : <Icon color={danger ? palette.danger : palette.primary} size={readerSettingsIconSize} />}
      {listStyle ? (
        <View style={styles.settingsCopyList}>
          <Text numberOfLines={2} style={[styles.settingsTitleList, danger && { color: palette.danger }]}>{title}</Text>
          {value ? <Text numberOfLines={2} style={styles.settingsDetailList}>{value}</Text> : null}
        </View>
      ) : (
        <>
          <Text style={[styles.settingsTitle, danger && { color: palette.danger }]}>{title}</Text>
          {value ? <Text numberOfLines={1} style={styles.settingsValue}>{value}</Text> : null}
          <ChevronRight color={palette.textMuted} size={readerSettingsChevronSize}  strokeWidth={iconography.stroke} />
        </>
      )}
    </Pressable>
  );
  return !listStyle && insetDivider ? <View style={styles.settingsRowWrap}>{row}<View style={styles.settingsDivider} /></View> : row;
}

export function ReaderField({ label, value, onChangeText, placeholder, multiline = false, keyboardType, editable = true, trailing }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: KeyboardTypeOptions; editable?: boolean; trailing?: ReactNode }) {
  return <FormField editable={editable} keyboardType={keyboardType} label={label} multiline={multiline} onChangeText={onChangeText} placeholder={placeholder} trailing={trailing} value={value} />;
}

export function ReaderChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <ChoiceChip label={label} onPress={onPress} selected={selected} />;
}

export function ReaderMarkdown({ content, fontSize = 17, serif = false }: { content: string; fontSize?: number; serif?: boolean }) {
  return <CoreAppMarkdown content={content} fontSize={fontSize} serif={serif} />;
}

export function ReaderSkeletonRows({ count = 5 }: { count?: number }) {
  return <LoadingSkeleton rows={count} />;
}

function useReaderUiStyles() {
  return useThemedStyles(createStyles);
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    header: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 68, paddingHorizontal: spacing.md },
    headerCopy: { flex: 1, minWidth: 0 },
    headerTitle: { color: palette.text, fontSize: 25, fontWeight: '700' },
    headerSubtitle: { color: palette.textMuted, fontSize: 13, marginTop: 2 },
    iconButton: { alignItems: 'center', borderRadius: radius.control, height: 42, justifyContent: 'center', width: 42 },
    iconButtonActive: { backgroundColor: palette.primarySoft },
    primaryPane: { flex: 1, minWidth: 0 },
    primaryPaneWide: { flexBasis: 360, flexGrow: 0, flexShrink: 0 },
    detailPane: { flex: 1, minWidth: 0 },
    detailPaneWide: { borderLeftColor: palette.border, borderLeftWidth: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: spacing.xxl },
    search: { backgroundColor: palette.surface, borderColor: palette.controlBorder, borderRadius: radius.control, borderWidth: 1, marginHorizontal: spacing.lg, marginVertical: spacing.md, minHeight: 48, paddingHorizontal: spacing.md },
    searchInput: { color: palette.text, flex: 1, fontSize: 15, paddingVertical: spacing.sm },
    centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 280, padding: spacing.xxl },
    centerTitle: { color: palette.text, fontSize: 19, fontWeight: '700', marginTop: spacing.md, textAlign: 'center' },
    centerDetail: { color: palette.textMuted, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg, marginTop: spacing.sm, maxWidth: 340, textAlign: 'center' },
    errorBanner: { backgroundColor: palette.surfaceSoft, borderBottomColor: palette.danger, borderBottomWidth: 1, gap: spacing.sm, padding: spacing.md },
    errorText: { color: palette.danger, fontSize: 13, lineHeight: 19 },
    inlineAction: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs, minHeight: 32 },
    errorActionText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
    button: { alignItems: 'center', borderRadius: radius.control, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.lg },
    buttonPrimary: { backgroundColor: palette.brand, borderColor: palette.brand },
    buttonSecondary: { backgroundColor: palette.surface, borderColor: palette.controlBorder },
    buttonDanger: { borderColor: palette.danger },
    buttonText: { fontSize: 14, fontWeight: '700' },
    sectionHeader: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.lg },
    sectionTitle: { color: palette.text, flex: 1, fontSize: 16, fontWeight: '700' },
    sectionValue: { color: palette.textMuted, fontSize: 13 },
    settingsRowList: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.md, minHeight: 68, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    settingsRowPressed: { backgroundColor: palette.surfaceMuted },
    settingsIconList: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.control, height: 40, justifyContent: 'center', width: 40 },
    settingsCopyList: { flex: 1, minWidth: 0 },
    settingsTitleList: { color: palette.text, fontSize: 16, fontWeight: '600' },
    settingsDetailList: { color: palette.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
    settingsRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 58, paddingHorizontal: spacing.lg },
    settingsRowInset: { borderBottomWidth: 0 },
    settingsRowWrap: { position: 'relative' },
    settingsDivider: { backgroundColor: palette.border, height: StyleSheet.hairlineWidth, left: spacing.lg + readerSettingsIconSize + spacing.md, position: 'absolute', right: spacing.lg + readerSettingsChevronSize + spacing.md, bottom: 0 },
    settingsTitle: { color: palette.text, flex: 1, fontSize: 15 },
    settingsValue: { color: palette.textMuted, fontSize: 13, maxWidth: '44%' },
    fieldGroup: { gap: spacing.xs },
    fieldLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '600' },
    field: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, color: palette.text, fontSize: 15, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    fieldMultiline: { minHeight: 128 },
    fieldWithTrailing: { paddingRight: spacing.xxl + spacing.xl },
    fieldTrailing: { bottom: spacing.xs, position: 'absolute', right: spacing.sm },
    chip: { alignItems: 'center', borderColor: palette.controlBorder, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: 36, paddingHorizontal: spacing.md },
    chipSelected: { backgroundColor: palette.primarySoft, borderColor: palette.brand },
    chipText: { color: palette.textMuted, fontSize: 13 },
    chipTextSelected: { color: palette.brand, fontWeight: '700' },
    skeletonList: { paddingBottom: spacing.xl },
    skeletonRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 84, paddingHorizontal: spacing.lg },
    skeleton: { backgroundColor: palette.surfaceRaised, borderRadius: 4 },
    skeletonIcon: { height: 52, width: 40 },
    skeletonCopy: { flex: 1, gap: spacing.sm },
    skeletonTitle: { height: 15, width: '72%' },
    skeletonMeta: { height: 11, width: '43%' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.66 },
  });
}
