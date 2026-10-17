import { router } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import {
  ArchiveRestore,
  BookOpen,
  ChevronRight,
  Database,
  Info,
  Languages,
  Minus,
  Palette as PaletteIcon,
  Plus,
  RefreshCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRoundCog,
  Wifi,
} from 'lucide-react-native';
import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius, spacing, type Palette, type ThemeMode } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { useFocusedReadingPreferences } from '@/core/ui/focused-reading';
import type { PublicAiConfiguration, ReaderAiPhase } from '@/core/runtime/runtime';

import type { ReaderSettingsRepository } from '../application/ports';
import { previewReaderPrompt } from '../application/prompt-renderer';
import type {
  ReaderBook,
  ReaderPassage,
  ReaderPreferences,
  ReaderPrompt,
  ReaderPromptDraft,
  ReaderPromptStage,
  ReaderRole,
  ReaderRoleDraft,
} from '../domain/model';
import { READER_PROMPT_VARIABLES } from '../domain/rules';
import {
  ReaderButton,
  ReaderChip,
  ReaderDetailPane,
  ReaderError,
  ReaderField,
  ReaderHeader,
  ReaderIconButton,
  READER_PRIMARY_HEADER_HEIGHT,
  ReaderScroll,
  ReaderSectionHeader,
  ReaderSettingsRow,
} from './reader-ui';
import { useReaderDraftGuard } from './reader-draft-guard';

export function ReaderSettingsScreen({
  preferences,
  deletedCount,
  aiConfiguration,
  aiPhase,
  themeMode,
  onExit,
}: {
  preferences: ReaderPreferences | null;
  deletedCount: number;
  aiConfiguration: PublicAiConfiguration | null;
  aiPhase: ReaderAiPhase;
  themeMode: ThemeMode;
  onExit?: (() => void) | undefined;
}) {
  const styles = useStyles();
  const reading = useFocusedReadingPreferences();
  return (
    <View style={styles.fill}>
      <ReaderHeader height={READER_PRIMARY_HEADER_HEIGHT} onBack={onExit} title="设置" />
      <ReaderScroll style={styles.settingsList}>
        <ReaderSettingsRow icon={BookOpen} onPress={() => router.push('/settings/reading')} title="专注阅读" value={`${reading.value.mode === 'paged' ? '翻页' : '滚动'} · ${reading.value.fontSize}px`} variant="list" />
        <ReaderSettingsRow icon={Languages} onPress={() => router.push('/settings/recognition')} title="本地文字识别" value={ocrLabel(preferences?.ocrScript ?? 'auto')} variant="list" />
        <ReaderSettingsRow icon={Sparkles} onPress={() => router.push('/settings/ai')} title="AI 服务" value={aiStatusLabel(aiPhase, aiConfiguration)} variant="list" />
        <ReaderSettingsRow icon={Wifi} onPress={() => router.push('/settings/lan')} title="局域网阅读" value="电脑浏览 · 只读" variant="list" />
        <ReaderSettingsRow icon={UserRoundCog} onPress={() => router.push('/settings/roles')} title="阅读角色" value="可编辑" variant="list" />
        <ReaderSettingsRow icon={Sparkles} onPress={() => router.push('/settings/prompts')} title="Prompt 模板" value="可编辑" variant="list" />
        <ReaderSettingsRow icon={ArchiveRestore} onPress={() => router.push('/settings/backup')} title="备份与恢复" value="本地文件" variant="list" />
        <ReaderSettingsRow danger icon={Trash2} onPress={() => router.push('/settings/trash')} title="回收站" value={`${deletedCount} 项`} variant="list" />
        <ReaderSettingsRow icon={PaletteIcon} onPress={() => router.push('/settings/theme')} title="主题" value={themeModeLabel(themeMode)} variant="list" />
        <ReaderSettingsRow icon={Info} onPress={() => router.push('/settings/about')} title="关于阅读" value={Constants.expoConfig?.version ?? '1.0.0'} variant="list" />
        <View style={[styles.notice, styles.settingsNotice]}>
          <Database size={18}  strokeWidth={iconography.stroke} />
          <Text style={styles.noticeText}>书籍、图片、摘录、讨论和自定义 Prompt 默认只保存在当前设备；需要换机时请先使用“备份与恢复”。</Text>
        </View>
      </ReaderScroll>
    </View>
  );
}

export function ReaderPromptsScreen({ prompts, wide, onBack, onOpen }: {
  prompts: readonly ReaderPrompt[];
  wide: boolean;
  onBack: () => void;
  onOpen: (stage: ReaderPromptStage) => void;
}) {
  const styles = useStyles();
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} title="Prompt 模板" />
      <ReaderScroll style={styles.settingsList}>
        {(['organize', 'analysis', 'discussion', 'follow-up'] as const).map((stage) => {
          const prompt = prompts.find((item) => item.stage === stage);
          return (
            <ReaderSettingsRow
              icon={stage === 'analysis' ? SlidersHorizontal : Sparkles}
              key={stage}
              onPress={() => onOpen(stage)}
              title={stageLabel(stage)}
              value={prompt ? `${prompt.historyLimit} 条历史` : '读取中'}
              variant="list"
            />
          );
        })}
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

export function ReaderPromptEditorScreen({ prompt, books, passage, roles, repository, wide, onBack }: {
  prompt: ReaderPrompt;
  books: readonly ReaderBook[];
  passage: ReaderPassage | null;
  roles: readonly ReaderRole[];
  repository: ReaderSettingsRepository;
  wide: boolean;
  onBack: () => void;
}) {
  const styles = useStyles();
  const source = useMemo<ReaderPromptDraft>(() => promptDraftOf(prompt), [prompt]);
  const [draft, setDraftValue] = useState(source);
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => onBack();
  const setDraft = (update: ReaderPromptDraft | ((value: ReaderPromptDraft) => ReaderPromptDraft)) => {
    setDirty(true);
    setDraftValue(update);
  };
  const save = async () => {
    setPending(true); setError(null);
    try {
      await repository.savePrompt(prompt.stage, draft);
      setDirty(false);
      onBack();
    }
    catch (cause) { setError(messageOf(cause, '保存 Prompt 失败')); }
    finally { setPending(false); }
  };
  const requestClose = useReaderDraftGuard({ dirty, noun: 'Prompt 修改', onBack: close, onSave: save, pending });
  usePreventRemove(true, () => requestClose());
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]);
  const reset = () => Alert.alert('恢复默认 Prompt？', '当前模板将被预置内容替换。', [{ text: '取消', style: 'cancel' }, { text: '恢复默认', onPress: () => { void repository.resetPrompt(prompt.stage).then(onBack).catch((cause: unknown) => setError(messageOf(cause, '恢复失败'))); } }]);
  const preview = useMemo(() => {
    try {
      const book = books.find((item) => item.deletedAt === null) ?? null;
      const role = roles.find((item) => item.id === book?.roleId) ?? roles[0] ?? null;
      return previewReaderPrompt({ ...prompt, ...draft }, { book, passage, role, question: '作者在这里的核心论证是什么？', messages: [] });
    } catch (cause) { return messageOf(cause, '无法预览模板'); }
  }, [books, draft, passage, prompt, roles]);
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader action={<ReaderIconButton active disabled={pending} icon={Save} label="保存" onPress={() => { void save(); }} />} height={READER_PRIMARY_HEADER_HEIGHT} onBack={requestClose} title={stageLabel(prompt.stage)} />
      {error ? <ReaderError message={error} onRetry={() => { void save(); }} /> : null}
      <ReaderScroll style={styles.form}>
        <ReaderField label="System 模板" multiline onChangeText={(systemTemplate) => setDraft((value) => ({ ...value, systemTemplate }))} value={draft.systemTemplate} />
        <ReaderField label="User 模板" multiline onChangeText={(userTemplate) => setDraft((value) => ({ ...value, userTemplate }))} value={draft.userTemplate} />
        <ReaderSectionHeader title="上下文开关" />
        <ToggleRow label="包含书籍信息" onValueChange={(includeBook) => setDraft((value) => ({ ...value, includeBook }))} value={draft.includeBook} />
        <ToggleRow label="包含摘录原文" onValueChange={(includeSource) => setDraft((value) => ({ ...value, includeSource }))} value={draft.includeSource} />
        <ToggleRow label="包含分析摘要" onValueChange={(includeSummary) => setDraft((value) => ({ ...value, includeSummary }))} value={draft.includeSummary} />
        <View style={styles.stepperRow}>
          <View style={styles.stepperCopy}><Text style={styles.rowTitle}>历史消息</Text><Text style={styles.rowDetail}>最多注入最近 {draft.historyLimit} 条已完成消息</Text></View>
          <ReaderIconButton disabled={draft.historyLimit <= 0} icon={Minus} label="减少历史" onPress={() => setDraft((value) => ({ ...value, historyLimit: Math.max(0, value.historyLimit - 2) }))} />
          <Text style={styles.stepperValue}>{draft.historyLimit}</Text>
          <ReaderIconButton disabled={draft.historyLimit >= 50} icon={Plus} label="增加历史" onPress={() => setDraft((value) => ({ ...value, historyLimit: Math.min(50, value.historyLimit + 2) }))} />
        </View>
        <ReaderSectionHeader title="可用变量" />
        <View style={styles.variableList}>{READER_PROMPT_VARIABLES.map((variable) => <Text key={variable} style={styles.variable}>{`{{${variable}}}`}</Text>)}</View>
        <ReaderButton icon={ChevronRight} label={previewOpen ? '收起预览' : '预览最终请求'} onPress={() => setPreviewOpen((value) => !value)} secondary />
        {previewOpen ? <View style={styles.preview}><Text selectable style={styles.previewText}>{preview}</Text></View> : null}
        <View style={styles.actionRow}>
          <ReaderButton icon={RefreshCcw} label="恢复默认" onPress={reset} secondary danger />
          <ReaderButton disabled={pending} icon={Save} label={pending ? '正在保存' : '保存模板'} onPress={() => { void save(); }} />
        </View>
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

export function ReaderRecognitionSettingsScreen({ preferences, repository, wide, onBack }: {
  preferences: ReaderPreferences;
  repository: ReaderSettingsRepository;
  wide: boolean;
  onBack: () => void;
}) {
  const styles = useStyles();
  const [pendingScript, setPendingScript] = useState<ReaderPreferences['ocrScript'] | null>(null);
  const [failedScript, setFailedScript] = useState<ReaderPreferences['ocrScript'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = (ocrScript: ReaderPreferences['ocrScript']) => {
    if (pendingScript) return;
    setPendingScript(ocrScript);
    setFailedScript(null);
    setError(null);
    void repository.savePreferences({ ...preferences, ocrScript })
      .catch((cause: unknown) => {
        setFailedScript(ocrScript);
        setError(messageOf(cause, '保存识别语言失败'));
      })
      .finally(() => setPendingScript(null));
  };
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} title="文字识别" />
      <ReaderScroll style={styles.form}>
        {error ? <ReaderError message={error} onRetry={() => { if (failedScript) save(failedScript); }} /> : null}
        <Text style={styles.formLabel}>识别语言</Text>
        <View style={styles.chips}>
          <ReaderChip label="自动" onPress={() => save('auto')} selected={preferences.ocrScript === 'auto'} />
          <ReaderChip label="中文 + 拉丁" onPress={() => save('chinese')} selected={preferences.ocrScript === 'chinese'} />
          <ReaderChip label="拉丁文字" onPress={() => save('latin')} selected={preferences.ocrScript === 'latin'} />
        </View>
        {pendingScript ? <Text style={styles.pendingText}>正在保存识别语言…</Text> : null}
        <View style={styles.notice}><Languages size={20}  strokeWidth={iconography.stroke} /><Text style={styles.noticeText}>识别结果会先进入核对页面，不会直接覆盖已保存原文。</Text></View>
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

export function ReaderReadingSettingsScreen({ wide, onBack }: {
  wide: boolean;
  onBack: () => void;
}) {
  const styles = useStyles();
  const reading = useFocusedReadingPreferences();
  const [pending, setPending] = useState(false);
  const [lastPatch, setLastPatch] = useState<Parameters<typeof reading.update>[0] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Parameters<typeof reading.update>[0]) => {
    if (pending) return;
    setPending(true);
    setLastPatch(patch);
    setError(null);
    void reading.update(patch)
      .catch((cause: unknown) => setError(messageOf(cause, '保存阅读外观失败')))
      .finally(() => setPending(false));
  };
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} title="阅读外观" />
      <ReaderScroll style={styles.form}>
        {error ? <ReaderError message={error} onRetry={() => { if (lastPatch) save(lastPatch); }} /> : null}
        <Text style={styles.formLabel}>阅读模式</Text>
        <View style={styles.chips}><ReaderChip label="连续滚动" onPress={() => save({ mode: 'scroll' })} selected={reading.value.mode === 'scroll'} /><ReaderChip label="横向翻页" onPress={() => save({ mode: 'paged' })} selected={reading.value.mode === 'paged'} /></View>
        <Text style={styles.formLabel}>字体</Text>
        <View style={styles.chips}><ReaderChip label="系统字体" onPress={() => save({ fontFamily: 'system' })} selected={reading.value.fontFamily === 'system'} /><ReaderChip label="衬线字体" onPress={() => save({ fontFamily: 'serif' })} selected={reading.value.fontFamily === 'serif'} /></View>
        <PreferenceStepper label="字号" max={32} min={14} onChange={(fontSize) => save({ fontSize })} suffix="px" value={reading.value.fontSize} />
        <PreferenceStepper label="页面边距" max={48} min={12} onChange={(pageMargin) => save({ pageMargin })} suffix="px" value={reading.value.pageMargin} />
        <View style={[styles.readerPreview, { paddingHorizontal: reading.value.pageMargin }]}><Text style={styles.previewLabel}>阅读预览</Text><Text style={[styles.readerPreviewText, { fontFamily: reading.value.fontFamily === 'serif' ? 'serif' : undefined, fontSize: reading.value.fontSize, lineHeight: Math.round(reading.value.fontSize * 1.62) }]}>阅读不是把答案塞进记忆，而是让问题变得更准确。</Text></View>
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

function PreferenceStepper({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.rowTitle}>{label}</Text>
      <ReaderIconButton disabled={value <= min} icon={Minus} label={`减小${label}`} onPress={() => onChange(value - 1)} />
      <Text style={styles.stepperValue}>{value}{suffix}</Text>
      <ReaderIconButton disabled={value >= max} icon={Plus} label={`增大${label}`} onPress={() => onChange(value + 1)} />
    </View>
  );
}

export function ReaderRolesScreen({ roles, wide, onBack, onOpen }: {
  roles: readonly ReaderRole[];
  wide: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} title="阅读角色" />
      <ReaderScroll>
        {roles.map((role) => (
          <Pressable accessibilityRole="button" key={role.id} onPress={() => onOpen(role.id)} style={({ pressed }) => [styles.roleRow, pressed && styles.pressed]}>
            <View style={styles.roleIcon}><UserRoundCog color={palette.brand} size={21}  strokeWidth={iconography.stroke} /></View>
            <View style={styles.roleCopy}><Text style={styles.roleName}>{role.name}</Text><Text numberOfLines={2} style={styles.roleDetail}>{role.description}</Text></View>
            <ChevronRight color={palette.textMuted} size={19}  strokeWidth={iconography.stroke} />
          </Pressable>
        ))}
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

export function ReaderRoleEditorScreen({ role, repository, wide, onBack }: {
  role: ReaderRole;
  repository: ReaderSettingsRepository;
  wide: boolean;
  onBack: () => void;
}) {
  const styles = useStyles();
  const source = useMemo<ReaderRoleDraft>(() => ({ name: role.name, description: role.description, prompt: role.prompt }), [role]);
  const [draft, setDraftValue] = useState(source);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => onBack();
  const setDraft = (update: ReaderRoleDraft | ((value: ReaderRoleDraft) => ReaderRoleDraft)) => {
    setDirty(true);
    setDraftValue(update);
  };
  const save = async () => {
    setPending(true); setError(null);
    try {
      await repository.saveRole(role.id, draft);
      setDirty(false);
      onBack();
    }
    catch (cause) { setError(messageOf(cause, '保存角色失败')); }
    finally { setPending(false); }
  };
  const requestClose = useReaderDraftGuard({ dirty, noun: '角色修改', onBack: close, onSave: save, pending });
  usePreventRemove(true, () => requestClose());
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]);
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader action={<ReaderIconButton active disabled={pending} icon={Save} label="保存" onPress={() => { void save(); }} />} height={READER_PRIMARY_HEADER_HEIGHT} onBack={requestClose} title="编辑阅读角色" />
      {error ? <ReaderError message={error} onRetry={() => { void save(); }} /> : null}
      <ReaderScroll style={styles.form}>
        <ReaderField label="角色名称" onChangeText={(name) => setDraft((value) => ({ ...value, name }))} value={draft.name} />
        <ReaderField label="适用范围" multiline onChangeText={(description) => setDraft((value) => ({ ...value, description }))} value={draft.description} />
        <ReaderField label="角色 Prompt" multiline onChangeText={(prompt) => setDraft((value) => ({ ...value, prompt }))} value={draft.prompt} />
        <View style={styles.actionRow}>
          <ReaderButton icon={RefreshCcw} label="恢复预置" onPress={() => Alert.alert('恢复预置角色？', '当前名称、说明和 Prompt 将被替换。', [{ text: '取消', style: 'cancel' }, { text: '恢复', onPress: () => { void repository.resetRole(role.id).then(onBack).catch((cause: unknown) => setError(messageOf(cause, '恢复失败'))); } }])} secondary danger />
          <ReaderButton disabled={pending} icon={Save} label={pending ? '正在保存' : '保存角色'} onPress={() => { void save(); }} />
        </View>
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  return <View style={styles.toggleRow}><Text style={styles.rowTitle}>{label}</Text><Switch onValueChange={onValueChange} thumbColor={value ? palette.onPrimary : palette.surfaceRaised} trackColor={{ false: palette.surfaceMuted, true: palette.brand }} value={value} /></View>;
}

function promptDraftOf(prompt: ReaderPrompt): ReaderPromptDraft {
  return { systemTemplate: prompt.systemTemplate, userTemplate: prompt.userTemplate, includeBook: prompt.includeBook, includeSource: prompt.includeSource, includeSummary: prompt.includeSummary, historyLimit: prompt.historyLimit };
}

function stageLabel(stage: ReaderPromptStage): string {
  if (stage === 'organize') return 'OCR 文本整理';
  if (stage === 'analysis') return '摘录分析';
  if (stage === 'discussion') return '首次讨论';
  return '后续追问';
}

function ocrLabel(value: ReaderPreferences['ocrScript']): string {
  if (value === 'latin') return '拉丁文字';
  if (value === 'chinese') return '中文 + 拉丁';
  return '自动';
}

function aiStatusLabel(phase: ReaderAiPhase, configuration: PublicAiConfiguration | null): string {
  if (phase === 'loading') return '正在准备';
  if (phase === 'error') return '配置异常';
  if (phase === 'unconfigured' || !configuration) return '未配置';
  return `${configuration.name} · ${configuration.model}`;
}

function themeModeLabel(mode: ThemeMode): string {
  if (mode === 'dark') return '深色';
  if (mode === 'oled') return '纯黑';
  if (mode === 'light') return '浅色';
  return '跟随系统';
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function useStyles() { return useThemedStyles(createStyles); }

function createStyles(palette: Palette) {
  return StyleSheet.create({
    fill: { flex: 1 },
    form: { gap: spacing.lg, padding: spacing.lg },
    settingsList: { gap: spacing.md, paddingHorizontal: spacing.lg },
    formLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    notice: { alignItems: 'flex-start', backgroundColor: palette.surfaceSoft, borderRadius: radius.control, flexDirection: 'row', gap: spacing.md, margin: spacing.lg, padding: spacing.lg },
    settingsNotice: { margin: 0 },
    noticeText: { color: palette.textMuted, flex: 1, fontSize: 13, lineHeight: 20 },
    pendingText: { color: palette.textMuted, fontSize: 12 },
    toggleRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', minHeight: 56 },
    rowTitle: { color: palette.text, flex: 1, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: palette.textMuted, fontSize: 12, marginTop: spacing.xs },
    stepperRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 64 },
    stepperCopy: { flex: 1 },
    stepperValue: { color: palette.text, fontSize: 14, fontWeight: '700', minWidth: 46, textAlign: 'center' },
    variableList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    variable: { backgroundColor: palette.surfaceMuted, borderRadius: 4, color: palette.text, fontFamily: 'monospace', fontSize: 12, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    preview: { backgroundColor: palette.surfaceMuted, borderRadius: radius.control, padding: spacing.lg },
    previewText: { color: palette.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 19 },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    readerPreview: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, minHeight: 180, paddingVertical: spacing.xl },
    previewLabel: { color: palette.textMuted, fontSize: 12, marginBottom: spacing.md },
    readerPreviewText: { color: palette.text },
    roleRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 78, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    roleIcon: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.control, height: 42, justifyContent: 'center', width: 42 },
    roleCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    roleName: { color: palette.text, fontSize: 15, fontWeight: '700' },
    roleDetail: { color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    pressed: { opacity: 0.66 },
  });
}
