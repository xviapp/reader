import { Database, Download, Trash2, Upload } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { File } from 'expo-file-system';

import { iconography, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { retainReadingSessions } from '@/core/reading/reading-session-store.native';
import { localState } from '@/core/storage/local-state';
import { useThemedStyles } from '@/core/design/use-themed-styles';

import {
  createReaderBackup,
  executeRestoreReaderBackup,
  inspectReaderBackup,
  type ReaderBackupBundle,
} from '../application/reader-backup';
import type { ReaderBackupRepository } from '../application/ports';
import {
  ReaderButton,
  ReaderDetailPane,
  ReaderError,
  ReaderHeader,
  READER_PRIMARY_HEADER_HEIGHT,
  ReaderScroll,
} from './reader-ui';

const LAST_BACKUP_KEY = 'reader.backup.last-success.v1';

export function ReaderBackupScreen({ repository, wide, onBack }: {
  repository: ReaderBackupRepository;
  wide: boolean;
  onBack: () => void;
}) {
  const styles = useStyles();
  const [pending, setPending] = useState<'backup' | 'choose' | 'restore' | 'replace' | 'clear' | null>(null);
  const [pendingBackup, setPendingBackup] = useState<ReaderBackupBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);

  const working = pending !== null;
  usePreventRemove(working, () => undefined);

  useEffect(() => {
    let active = true;
    void localState.getItem(LAST_BACKUP_KEY).then((value) => { if (active) setLastBackupAt(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const backup = async () => {
    if (working) return;
    setPending('backup'); setError(null);
    try {
      await createReaderBackup(repository);
      const completedAt = new Date().toISOString();
      setLastBackupAt(completedAt);
      void localState.setItem(LAST_BACKUP_KEY, completedAt);
    } catch (cause) {
      setError(messageOf(cause, '备份失败'));
    } finally { setPending(null); }
  };

  const chooseBackup = async () => {
    if (working) return;
    setPending('choose'); setError(null);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/zip', 'application/json', 'application/octet-stream'] });
      if (picked.canceled || !picked.result) return;
      const bundle = await inspectReaderBackup(picked.result);
      setPendingBackup(bundle);
    } catch (cause) {
      setError(messageOf(cause, '读取备份失败'));
    } finally { setPending(null); }
  };

  const runRestore = async (replace: boolean) => {
    if (!pendingBackup || working) return;
    setPending(replace ? 'replace' : 'restore'); setError(null);
    try {
      await executeRestoreReaderBackup(repository, pendingBackup, { replace });
      // A timer survives only when its book came back with the backup, e.g. restoring on the same device.
      await retainReadingSessions(new Set(pendingBackup.snapshot.books.filter((book) => book.deletedAt === null).map((book) => book.id)));
      setPendingBackup(null);
      Alert.alert('恢复完成', replace ? '当前数据已替换为备份内容。' : 'Reader 数据和图片已恢复。');
    } catch (cause) {
      setError(messageOf(cause, '恢复失败'));
    } finally { setPending(null); }
  };

  const confirmReplace = () => {
    if (!pendingBackup) return;
    Alert.alert(
      '清空当前数据并恢复？',
      '当前全部书籍、摘录、讨论和图片会被删除，并替换为这份备份。建议先导出一份当前备份。此操作不可撤销。',
      [
        { text: '取消', style: 'cancel' },
        { text: '清空并恢复', style: 'destructive', onPress: () => { void runRestore(true); } },
      ],
    );
  };

  const confirmClearAll = () => {
    Alert.alert(
      '清空全部阅读数据？',
      '全部书籍、摘录、讨论和图片会被删除，让阅读空间回到初始状态。AI 凭据和主题设置不受影响。此操作不可撤销。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空全部数据',
          style: 'destructive',
          onPress: async () => {
            if (working) return;
            setPending('clear'); setError(null);
            try {
              await repository.clearAllData();
              await retainReadingSessions(new Set());
              setPendingBackup(null);
              Alert.alert('操作完成', '阅读数据已清空。');
            } catch (cause) {
              setError(messageOf(cause, '清空失败'));
            } finally { setPending(null); }
          },
        },
      ],
    );
  };

  const snapshot = pendingBackup?.snapshot;
  const bookCount = snapshot?.books.length ?? 0;
  const passageCount = snapshot?.passages.length ?? 0;
  const discussionCount = snapshot?.discussions.length ?? 0;
  const mediaCount = pendingBackup?.media.length ?? 0;

  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} title="备份与恢复" />
      <ReaderScroll style={styles.form}>
        {error ? <ReaderError message={error} onRetry={() => setError(null)} retryLabel="关闭" /> : null}
        <View style={styles.notice}>
          <Database size={20}  strokeWidth={iconography.stroke} />
          <View style={styles.noticeBody}>
            <Text style={styles.noticeTitle}>本地备份</Text>
            <Text style={styles.noticeText}>备份包含书籍、图片、摘录、OCR、摘要、讨论、收藏、角色、Prompt 和回收站内容。API Key、运行中的任务和页面草稿不会离开本机。</Text>
            {lastBackupAt ? <Text style={styles.status}>最近一次成功备份：{formatDate(lastBackupAt)}</Text> : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardText}>生成标准 Zip 压缩包，通过系统分享面板保存到你选择的位置。</Text>
          <ReaderButton disabled={working} icon={Download} label={pending === 'backup' ? '正在准备备份…' : '导出备份'} onPress={() => { void backup(); }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardText}>选择备份文件，确认记录明细后再恢复。</Text>
          <ReaderButton disabled={working} icon={Upload} label={pending === 'choose' ? '正在读取…' : '选择备份文件'} onPress={() => { void chooseBackup(); }} secondary />
        </View>

        {pendingBackup ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>已读取备份</Text>
            <Text style={styles.cardText}>
              导出时间：{formatDate(pendingBackup.createdAt)}{'\n'}
              数据明细：{bookCount} 本书 · {passageCount} 条摘录 · {discussionCount} 个讨论 · {mediaCount} 张图片
            </Text>
            <Text style={styles.warningText}>「恢复」只能写入尚无数据的阅读空间。已有数据时请用「清空并恢复」。</Text>
            <View style={styles.actionRow}>
              <ReaderButton disabled={working} label={pending === 'replace' ? '正在替换…' : '清空当前数据并恢复'} onPress={confirmReplace} secondary />
              <ReaderButton disabled={working} label={pending === 'restore' ? '正在恢复…' : '恢复此备份'} onPress={() => { void runRestore(false); }} />
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>清空数据</Text>
          <Text style={styles.cardText}>删除本机全部阅读数据，让这台设备回到初始状态。AI 凭据和主题设置不受影响。</Text>
          <ReaderButton danger disabled={working} icon={Trash2} label={pending === 'clear' ? '正在清空…' : '清空全部阅读数据'} onPress={confirmClearAll} />
        </View>

        {working ? <Text accessibilityLiveRegion="polite" style={styles.status}>正在处理文件，请稍候…</Text> : null}
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function useStyles() { return useThemedStyles(createStyles); }

function createStyles(palette: Palette) {
  return StyleSheet.create({
    form: { gap: spacing.md, padding: spacing.lg },
    notice: { alignItems: 'flex-start', backgroundColor: palette.surfaceSoft, borderRadius: radius.card, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
    noticeBody: { flex: 1, gap: spacing.xs },
    noticeTitle: { ...typography.section, color: palette.text },
    noticeText: { color: palette.textMuted, fontSize: 13, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, gap: spacing.md, padding: spacing.md },
    cardTitle: { ...typography.section, color: palette.text },
    cardText: { ...typography.body, color: palette.textMuted },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
    status: { ...typography.caption, color: palette.primary, fontWeight: '600' },
    warningText: { ...typography.caption, color: palette.warning },
  });
}
