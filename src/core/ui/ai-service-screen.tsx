import {
  Check,
  CirclePlus,
  KeyRound,
  Pencil,
  Server,
  Star,
  Trash2,
  Wifi,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AI_PROVIDER_DEFAULTS,
  type AiConfigurationInput,
  type AiProtocol,
  type AiProvider,
} from '@/core/ai/ai-settings-core';
import { useAppTheme } from '@/core/design/theme';
import { iconography, interaction, minimumTouchTarget, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { type PublicAiConfiguration, useReaderRuntime } from '@/core/runtime/reader-runtime';
import { useUnsavedChanges } from '@/core/ui/use-unsaved-changes';

import { ActionButton, ChoiceChip, EmptyState, IconButton } from './app-controls';
import {
  AppScreen,
  SectionHeader,
  StatusLabel,
  SubpageHeader,
} from './host-components';

type EditorTarget = string | 'new' | null;

const providerLabels: Record<AiProvider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  custom: '自定义',
};

const protocolLabels: Record<AiProtocol, string> = {
  'chat-completions': 'Chat Completions',
  responses: 'Responses',
};

export function AiServiceScreen() {
  const runtime = useReaderRuntime();
  const [editor, setEditor] = useState<EditorTarget>(null);

  if (editor !== null) {
    const existing = editor === 'new'
      ? null
      : runtime.aiServices.find((service) => service.id === editor) ?? null;
    return <AiServiceEditor existing={existing} onBack={() => setEditor(null)} runtime={runtime} />;
  }
  return <AiServiceList onEdit={setEditor} runtime={runtime} />;
}

function AiServiceList({
  runtime,
  onEdit,
}: {
  runtime: ReturnType<typeof useReaderRuntime>;
  onEdit(target: EditorTarget): void;
}) {
  const { palette, styles } = useAiStyles();
  const setDefault = (service: PublicAiConfiguration) => {
    if (service.id === runtime.defaultAiServiceId) return;
    Alert.alert(
      '切换默认 AI 服务？',
      '后续生成计划会使用新服务。',
      [
        { text: '取消', style: 'cancel' },
        { text: '切换', onPress: () => { void runtime.setDefaultAiService(service.id); } },
      ],
    );
  };
  const remove = (service: PublicAiConfiguration) => {
    Alert.alert('删除 AI 服务？', `“${service.name}”的本机配置和凭据将被删除。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { void runtime.removeAiService(service.id); } },
    ]);
  };
  return (
    <AppScreen>
      <SubpageHeader
        action={<IconButton icon={CirclePlus} label="添加 AI 服务" onPress={() => onEdit('new')} />}
        title="AI 服务"
      />
      <View style={styles.statusRow}>
        <View style={styles.statusCopy}>
          <Text style={styles.title}>客户端直连</Text>
          <Text style={styles.detail}>整理、分析或讨论时直连你选择的服务，阅读不转发请求。</Text>
        </View>
        <StatusLabel
          label={runtime.aiServices.length > 0 ? `${runtime.aiServices.length} 项` : '未配置'}
          tone={runtime.aiServices.length > 0 ? 'success' : 'warning'}
        />
      </View>
      {runtime.aiError ? <Text style={styles.error}>{runtime.aiError}</Text> : null}
      <SectionHeader title="已配置服务" />
      {runtime.aiServices.length === 0 ? (
        <EmptyState icon={Server} title="还没有 AI 服务" detail="添加 OpenAI、DeepSeek 或自定义兼容服务。" action={<ActionButton icon={CirclePlus} label="添加 AI 服务" onPress={() => onEdit('new')} />} />
      ) : runtime.aiServices.map((service) => {
        const isDefault = service.id === runtime.defaultAiServiceId;
        return (
          <View key={service.id} style={styles.serviceRow}>
            <Pressable
              accessibilityLabel={`编辑 ${service.name}`}
              accessibilityRole="button"
              onPress={() => onEdit(service.id)}
              style={({ pressed }) => [styles.serviceMain, pressed && styles.pressed]}
            >
              <View style={styles.serviceIcon}><Server color={palette.primary} size={20}  strokeWidth={iconography.stroke} /></View>
              <View style={styles.serviceCopy}>
                <View style={styles.serviceTitleRow}>
                  <Text numberOfLines={1} style={styles.serviceTitle}>{service.name}</Text>
                  {isDefault ? <StatusLabel label="默认" tone="success" /> : null}
                </View>
                <Text numberOfLines={2} style={styles.serviceDetail}>
                  {providerLabels[service.provider]} · {protocolLabels[service.protocol]} · {service.model}
                </Text>
              </View>
            </Pressable>
            <View style={styles.serviceActions}>
              {!isDefault ? <IconButton disabled={runtime.actionPending} icon={Star} label={`将 ${service.name} 设为默认`} onPress={() => setDefault(service)} /> : null}
              <IconButton icon={Pencil} label={`编辑 ${service.name}`} onPress={() => onEdit(service.id)} />
              <IconButton danger disabled={runtime.actionPending} icon={Trash2} label={`删除 ${service.name}`} onPress={() => remove(service)} />
            </View>
          </View>
        );
      })}
      <SectionHeader title="数据边界" />
      <View style={styles.infoRow}><KeyRound color={palette.primary} size={19}  strokeWidth={iconography.stroke} /><Text style={[styles.detail, styles.serviceCopy]}>API Key 只保存在本机安全存储中，不会显示在诊断信息里。</Text></View>
      <View style={styles.infoRow}><Wifi color={palette.primary} size={19}  strokeWidth={iconography.stroke} /><Text style={[styles.detail, styles.serviceCopy]}>不会自动切换服务；测试连接会发送一次可能产生少量费用的真实请求。</Text></View>
    </AppScreen>
  );
}

function AiServiceEditor({
  runtime,
  existing,
  onBack,
}: {
  runtime: ReturnType<typeof useReaderRuntime>;
  existing: PublicAiConfiguration | null;
  onBack(): void;
}) {
  const { palette, styles } = useAiStyles();
  const initial = useMemo<AiConfigurationInput>(() => existing ? {
    ...existing,
    apiKey: '',
  } : {
    name: 'OpenAI',
    provider: 'openai',
    protocol: 'responses',
    baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
    model: AI_PROVIDER_DEFAULTS.openai.model,
    apiKey: '',
  }, [existing]);
  const [draft, setDraft] = useState<AiConfigurationInput>(initial);
  const [tested, setTested] = useState<'idle' | 'success' | 'failed'>('idle');
  const changes = useUnsavedChanges(draft, { busy: runtime.actionPending, onClose: onBack });
  usePreventRemove(true, () => changes.requestClose());
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      changes.requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [changes]);
  const update = <K extends keyof AiConfigurationInput>(key: K, value: AiConfigurationInput[K]) => {
    setTested('idle');
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const selectProvider = (provider: AiProvider) => {
    setTested('idle');
    setDraft((current) => ({
      ...current,
      provider,
      name: existing ? current.name : providerLabels[provider],
      protocol: provider === 'deepseek' ? 'chat-completions'
        : provider === 'openai' ? 'responses'
          : current.protocol,
      ...(provider === 'custom' ? {} : AI_PROVIDER_DEFAULTS[provider]),
    }));
  };
  const save = async () => {
    const saved = await runtime.saveAiService(draft);
    if (saved) onBack();
  };
  const test = async () => {
    const success = await runtime.testAiService(draft);
    setTested(success ? 'success' : 'failed');
  };
  return (
    <AppScreen>
      <SubpageHeader onBack={() => changes.requestClose()} title={existing ? '编辑 AI 服务' : '添加 AI 服务'} />
      <SectionHeader title="服务类型" />
      <View style={styles.segmented}>
        {(['openai', 'deepseek', 'custom'] as const).map((provider) => (
          <ChoiceChip
            disabled={runtime.actionPending}
            key={provider}
            label={providerLabels[provider]}
            onPress={() => selectProvider(provider)}
            selected={draft.provider === provider}
          />
        ))}
      </View>
      <SectionHeader title="请求协议" />
      <View style={styles.segmented}>
        {(['chat-completions', 'responses'] as const).map((protocol) => (
          <ChoiceChip
            disabled={runtime.actionPending}
            key={protocol}
            label={protocolLabels[protocol]}
            onPress={() => update('protocol', protocol)}
            selected={draft.protocol === protocol}
          />
        ))}
      </View>
      <Field editable={!runtime.actionPending} label="名称" onChangeText={(value) => update('name', value)} value={draft.name} />
      <Field editable={!runtime.actionPending} autoCapitalize="none" autoCorrect={false} keyboardType="url" label="服务地址" onChangeText={(value) => update('baseUrl', value)} value={draft.baseUrl} />
      <Field editable={!runtime.actionPending} autoCapitalize="none" autoCorrect={false} label="模型" onChangeText={(value) => update('model', value)} value={draft.model} />
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        editable={!runtime.actionPending}
        label="API Key"
        onChangeText={(value) => update('apiKey', value)}
        placeholder={existing ? '留空表示保留原凭据' : draft.provider === 'custom' ? '可选' : '必填'}
        secureTextEntry
        value={draft.apiKey}
      />
      {runtime.aiError ? <Text style={styles.error}>{runtime.aiError}</Text> : null}
      {tested !== 'idle' ? (
        <Text style={tested === 'success' ? styles.success : styles.error}>
          {tested === 'success' ? '测试成功，服务可以生成回复。' : '测试失败，请检查地址、协议、模型和凭据。'}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <ActionButton
          secondary
          disabled={runtime.actionPending}
          icon={Wifi}
          label="测试连接"
          onPress={() => { void test(); }}
        />
        <ActionButton
          disabled={runtime.actionPending}
          icon={Check}
          label="保存"
          onPress={() => { void save(); }}
        />
        {runtime.actionPending ? <ActivityIndicator color={palette.primary} /> : null}
      </View>
    </AppScreen>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { palette, styles } = useAiStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} accessibilityLabel={label} accessibilityState={{ disabled: props.editable === false }} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} placeholderTextColor={palette.textSubtle} selectionColor={palette.focus} style={[styles.input, props.editable === false && styles.disabled, focused && styles.inputFocused]} />
    </View>
  );
}

function useAiStyles() {
  const { palette } = useAppTheme();
  return { palette, styles: useThemedStyles(createStyles) };
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
    statusCopy: { flex: 1, gap: spacing.xs },
    title: { ...typography.section, color: palette.text },
    detail: { ...typography.body, color: palette.textMuted },
    serviceRow: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
    serviceActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs },
    serviceMain: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minimumTouchTarget, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    serviceIcon: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.control, height: 40, justifyContent: 'center', width: 40 },
    serviceCopy: { flex: 1, minWidth: 0 },
    serviceTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    serviceTitle: { ...typography.section, color: palette.text, flexShrink: 1 },
    serviceDetail: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
    infoRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    field: { gap: spacing.sm },
    fieldLabel: { ...typography.label, color: palette.textMuted },
    input: { backgroundColor: palette.canvas, borderColor: palette.controlBorder, borderRadius: radius.control, borderWidth: 1, color: palette.text, fontSize: 15, minHeight: minimumTouchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    inputFocused: { borderColor: palette.focus, outlineColor: palette.focus, outlineWidth: 1 },
    actions: { gap: spacing.md, marginTop: spacing.sm },
    error: { ...typography.body, color: palette.danger },
    success: { ...typography.body, color: palette.success },
    disabled: { opacity: interaction.disabledOpacity },
    pressed: { opacity: interaction.pressedOpacity },
  });
}
