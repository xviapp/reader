import { Bookmark, FileText } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { AiActivityDots } from '@/core/ui/ai-activity';

import type { ReaderDiscussion, ReaderMessage, ReaderPassageIndex } from '../domain/model';
import { passageDisplayTitle, passageLocationLabel } from '../domain/rules';
import type { ReaderBookTab } from './navigation';
import { ReaderFlatTabs } from './reader-tabs';

export function ReaderBookTabs({ active, passageCount, discussionCount, favoriteCount, unread, onChange }: {
  active: ReaderBookTab;
  passageCount: number | null;
  discussionCount: number | null;
  favoriteCount: number | null;
  unread: boolean;
  onChange: (value: ReaderBookTab) => void;
}) {
  return (
    <ReaderFlatTabs
      active={active}
      items={[
        { value: 'passages', label: '摘录', count: passageCount },
        { value: 'discussions', label: '讨论', count: discussionCount, unread },
        { value: 'favorites', label: '收藏', count: favoriteCount },
      ]}
      onChange={onChange}
    />
  );
}

export function ReaderBookPassageRow({ passage, onPress, onLongPress }: { passage: ReaderPassageIndex; onPress: () => void; onLongPress: () => void }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const working = passage.organizationStatus === 'queued' || passage.organizationStatus === 'running' || passage.analysisStatus === 'running';
  return (
    <Pressable
      accessibilityActions={[{ name: 'longpress', label: '更多摘录操作' }]}
      accessibilityLabel={`打开摘录：${passageDisplayTitle(passage.title, passage.pageLabel, passage.sourcePreview)}`}
      accessibilityRole="button"
      delayLongPress={450}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') onLongPress(); }}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {passage.imageUri
        ? <Image resizeMode="contain" source={{ uri: passage.imageUri }} style={styles.passageImage} />
        : <View style={styles.passageIcon}><FileText color={palette.brand} size={21}  strokeWidth={iconography.stroke} /></View>}
      <View style={styles.rowCopy}>
        <Text numberOfLines={2} style={styles.rowTitle}>{passageDisplayTitle(passage.title, passage.pageLabel, passage.sourcePreview)}</Text>
        <Text numberOfLines={2} style={styles.rowPreview}>{passage.summaryPreview || passage.sourcePreview || '这条摘录只有图片。'}</Text>
        <View style={styles.rowMetaLine}>
          <Text numberOfLines={1} style={styles.rowMeta}>{passage.pageLabel ? `${passageLocationLabel(passage.pageLabel)} · ` : ''}{passageWorkLabel(passage)}</Text>
          {working ? <AiActivityDots compact /> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function ReaderBookFavoriteRow({ message, discussion, onPress, onLongPress }: { message: ReaderMessage; discussion: ReaderDiscussion | null; onPress: () => void; onLongPress: () => void }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityActions={[{ name: 'longpress', label: '更多收藏操作' }]}
      accessibilityLabel={`打开收藏回答：${discussion?.title ?? '已收藏回答'}`}
      accessibilityRole="button"
      delayLongPress={450}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') onLongPress(); }}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.favoriteIcon}><Bookmark color={palette.brand} fill={palette.brand} size={20}  strokeWidth={iconography.stroke} /></View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>{discussion?.title ?? '已收藏回答'}</Text>
        <Text numberOfLines={4} style={styles.favoritePreview}>{message.content}</Text>
        <Text style={styles.rowMeta}>{relativeDate(message.updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

export function passageContextLabel(discussion: ReaderDiscussion, passages: readonly ReaderPassageIndex[]): string | null {
  const passage = discussion.passageId ? passages.find((item) => item.id === discussion.passageId) : null;
  return passage ? passageDisplayTitle(passage.title, passage.pageLabel, passage.sourcePreview) : null;
}

function analysisLabel(status: ReaderPassageIndex['analysisStatus']): string {
  if (status === 'completed') return '已分析';
  if (status === 'running') return '分析中';
  if (status === 'failed' || status === 'interrupted') return '分析失败';
  return '未分析';
}

function passageWorkLabel(passage: ReaderPassageIndex): string {
  if (passage.organizationStatus === 'queued' || passage.organizationStatus === 'running') return '整理中';
  if (passage.organizationStatus === 'candidate') return '待确认整理';
  if (passage.organizationStatus === 'failed' || passage.organizationStatus === 'interrupted') {
    return passage.organizationError || '整理失败';
  }
  if (passage.analysisStatus === 'failed' || passage.analysisStatus === 'interrupted') {
    return passage.analysisError || analysisLabel(passage.analysisStatus);
  }
  return analysisLabel(passage.analysisStatus);
}

function relativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const difference = Date.now() - timestamp;
  if (difference < 60_000) return '刚刚';
  if (difference < 3_600_000) return `${Math.max(1, Math.floor(difference / 60_000))} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function useStyles() {
  return useThemedStyles(createStyles);
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    row: { alignItems: 'flex-start', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, marginHorizontal: spacing.lg, minHeight: 104, paddingVertical: spacing.lg },
    passageImage: { backgroundColor: palette.surfaceMuted, borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, height: 72, width: 56 },
    passageIcon: { alignItems: 'center', backgroundColor: palette.surface, borderRadius: radius.control, height: 56, justifyContent: 'center', width: 56 },
    favoriteIcon: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.control, height: 44, justifyContent: 'center', width: 44 },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: palette.text, fontSize: 15, fontWeight: '700', lineHeight: 21 },
    rowPreview: { color: palette.textMuted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
    favoritePreview: { color: palette.textMuted, fontSize: 14, lineHeight: 21, marginTop: spacing.xs },
    rowMetaLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    rowMeta: { color: palette.textSubtle, flexShrink: 1, fontSize: 11 },
    pressed: { opacity: 0.66 },
  });
}
