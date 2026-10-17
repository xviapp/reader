import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Pencil, Plus, Save, Timer, Trash2 } from 'lucide-react-native';

import { spacing, radius, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { ActionSheet } from '@/core/ui/action-sheet';
import { FormSheet } from '@/core/ui/app-controls';

import type { ReaderLibraryRepository } from '../application/ports';
import type { ReaderBook, ReaderReadingSession } from '../domain/model';
import {
  READER_LONG_SESSION_MS,
  readerDailyReading,
  readerDayLabel,
  readerManualSessionEntry,
  readerReadingDays,
  readerReadingDuration,
  readerReadingSpeed,
  readerReadingStats,
  readerRemainingMs,
  readerSessionEditEntry,
  readerSessionPagesLabel,
  readerStatusForPages,
} from '../domain/rules';
import {
  READER_PRIMARY_HEADER_HEIGHT,
  ReaderButton,
  ReaderChip,
  ReaderDetailPane,
  ReaderEmpty,
  ReaderError,
  ReaderField,
  ReaderHeader,
  ReaderIconButton,
  ReaderScroll,
  ReaderSectionHeader,
  ReaderSkeletonRows,
} from './reader-ui';

interface SessionDraft { minutes: string; startPage: string; endPage: string }
interface ManualDraft extends SessionDraft { daysAgo: number; time: string }

const MANUAL_DAYS = [{ daysAgo: 0, label: '今天' }, { daysAgo: 1, label: '昨天' }, { daysAgo: 2, label: '前天' }] as const;

/** Every kept timer session of one book: totals first, then each day's sessions; a long press corrects or deletes one. */
export function ReaderReadingRecordsScreen({ book, repository, wide, onBack }: {
  book: ReaderBook;
  repository: Pick<ReaderLibraryRepository, 'watchReadingSessions' | 'recordReadingSession' | 'updateReadingSession' | 'deleteReadingSession' | 'updateBook'>;
  wide: boolean;
  onBack: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [sessions, setSessions] = useState<readonly ReaderReadingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<ReaderReadingSession | null>(null);
  const [editing, setEditing] = useState<ReaderReadingSession | null>(null);
  const [draft, setDraft] = useState<SessionDraft>({ minutes: '', startPage: '', endPage: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState<ManualDraft>({ daysAgo: 0, time: '', minutes: '', startPage: '', endPage: '' });
  const [manualError, setManualError] = useState<string | null>(null);
  useEffect(() => repository.watchReadingSessions(
    book.id,
    (items) => { setError(null); setSessions(items); },
    (cause) => setError(cause.message),
  ), [attempt, book.id, repository]);
  const days = useMemo(() => readerReadingDays(sessions ?? []), [sessions]);
  const stats = useMemo(() => readerReadingStats(sessions ?? []), [sessions]);
  const speed = useMemo(() => readerReadingSpeed(sessions ?? []), [sessions]);
  const remainingMs = readerRemainingMs(book, speed);
  const daily = useMemo(() => readerDailyReading(sessions ?? []), [sessions]);

  const openEdit = (session: ReaderReadingSession) => {
    setDraft({
      minutes: String(Math.max(1, Math.round(session.durationMs / 60_000))),
      startPage: session.startPage === null ? '' : String(session.startPage),
      endPage: session.endPage === null ? '' : String(session.endPage),
    });
    setEditError(null);
    setEditing(session);
  };
  const saveEdit = async () => {
    if (!editing || pending) return;
    const entry = readerSessionEditEntry(editing, draft, book.pageCount);
    if (!entry.ok) {
      setEditError(entry.error);
      return;
    }
    setPending(true);
    try {
      await repository.updateReadingSession(editing.id, entry.draft);
      setEditing(null);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : '保存阅读记录失败');
    } finally {
      setPending(false);
    }
  };
  const openManual = () => {
    setManual({ daysAgo: 0, time: '', minutes: '', startPage: book.pagesRead ? String(book.pagesRead) : '', endPage: '' });
    setManualError(null);
    setAdding(true);
  };
  const saveManual = async () => {
    if (pending) return;
    const entry = readerManualSessionEntry(manual, book.pageCount);
    if (!entry.ok) {
      setManualError(entry.error);
      return;
    }
    setPending(true);
    try {
      const { endPage } = entry.draft;
      await repository.recordReadingSession(book.id, entry.draft);
      // A page beyond the progress moves the progress on, as ending a timer does; an earlier page leaves it.
      if (endPage !== null && endPage > book.pagesRead) {
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...draft } = book;
        const status = readerStatusForPages(book.status, endPage, book.pageCount);
        await repository.updateBook(book.id, { ...draft, pagesRead: endPage, status });
      }
      setAdding(false);
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : '补记阅读失败');
    } finally {
      setPending(false);
    }
  };
  const confirmDelete = (session: ReaderReadingSession) => {
    Alert.alert('删除这条阅读记录？', `${readerDayLabel(new Date(session.startedAt))} ${clock(session.startedAt)}，${readerReadingDuration(session.durationMs)}。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => { void repository.deleteReadingSession(session.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '删除阅读记录失败')); },
      },
    ]);
  };

  let body;
  if (error) body = <ReaderError message={error} onRetry={() => { setError(null); setAttempt((value) => value + 1); }} />;
  else if (!sessions) body = <ReaderSkeletonRows count={4} />;
  else if (!sessions.length) body = <ReaderEmpty action={<ReaderButton icon={Plus} label="补记一次阅读" onPress={openManual} secondary />} detail="在书籍页点按「开始」计时，读完保存后会记在这里；没计时的阅读可以补记。不足 1 分钟的计时不记录。" icon={Timer} title="还没有阅读记录" />;
  else body = <>
    <View style={styles.stats}>
      <Stat label={`累计时长 · ${stats.sessionCount} 次`} value={readerReadingDuration(stats.totalMs)} />
      <Stat label="阅读速度" value={speed !== null ? `约 ${speed} 页/小时` : '—'} />
      <View style={[styles.stat, styles.statWide]}>
        {remainingMs !== null ? <>
          <Text style={styles.statValue}>还需约 {readerReadingDuration(remainingMs)}</Text>
          <Text style={styles.statLabel}>按当前速度读完剩余 {book.pageCount - book.pagesRead} 页</Text>
        </> : <>
          <Text style={styles.statValue}>{stats.pagesRead !== null ? `读过 ${stats.pagesRead} 页` : '近 30 天'}</Text>
          <Text style={styles.statLabel}>{speed === null ? '记录开始和结束页后可估算阅读速度' : '填写全书页数后可估算剩余时间'}</Text>
        </>}
        <DailyChart days={daily} />
      </View>
    </View>
    {stats.firstReadAt && stats.lastReadAt ? (
      <Text style={styles.span}>首次 {readerDayLabel(new Date(stats.firstReadAt))} · 最近 {readerDayLabel(new Date(stats.lastReadAt))} · 长按记录可修改或删除</Text>
    ) : null}
    {days.map((day) => (
      <View key={day.key}>
        <ReaderSectionHeader title={day.label} value={readerReadingDuration(day.totalMs)} />
        {day.sessions.map((session) => <SessionRow key={session.id} onLongPress={() => setSelected(session)} session={session} />)}
      </View>
    ))}
  </>;

  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader action={<ReaderIconButton icon={Plus} label="补记一次阅读" onPress={openManual} />} height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} subtitle={book.title} title="阅读记录" />
      <ReaderScroll>{body}</ReaderScroll>
      <ActionSheet
        items={selected ? [
          { key: 'edit', label: '修改时长和页数', icon: Pencil, onPress: () => openEdit(selected) },
          { key: 'delete', label: '删除这条记录', icon: Trash2, danger: true, onPress: () => confirmDelete(selected) },
        ] : []}
        onClose={() => setSelected(null)}
        {...(selected ? { subtitle: `${clock(selected.startedAt)} – ${clock(selected.endedAt)} · ${readerReadingDuration(selected.durationMs)}` } : {})}
        title={selected ? readerDayLabel(new Date(selected.startedAt)) : ''}
        visible={selected !== null}
      />
      <FormSheet
        busy={pending}
        footer={<ReaderButton disabled={pending} icon={Save} label={pending ? '正在保存' : '保存'} onPress={() => { void saveEdit(); }} />}
        onClose={() => { if (!pending) setEditing(null); }}
        {...(editing ? { subtitle: `${readerDayLabel(new Date(editing.startedAt))} ${clock(editing.startedAt)} 开始；结束时间按时长重新计算` } : {})}
        title="修改阅读记录"
        visible={editing !== null}
      >
        {editError ? <ReaderError message={editError} onRetry={() => { void saveEdit(); }} /> : null}
        <ReaderField keyboardType="numeric" label="阅读时长（分钟）" onChangeText={(minutes) => setDraft((value) => ({ ...value, minutes }))} value={draft.minutes} />
        <View style={styles.pages}>
          <View style={styles.page}><ReaderField keyboardType="numeric" label="开始页" onChangeText={(startPage) => setDraft((value) => ({ ...value, startPage }))} placeholder="选填" value={draft.startPage} /></View>
          <View style={styles.page}><ReaderField keyboardType="numeric" label="结束页" onChangeText={(endPage) => setDraft((value) => ({ ...value, endPage }))} placeholder="选填" value={draft.endPage} /></View>
        </View>
      </FormSheet>
      <FormSheet
        busy={pending}
        footer={<ReaderButton disabled={pending} icon={Save} label={pending ? '正在保存' : '保存'} onPress={() => { void saveManual(); }} />}
        onClose={() => { if (!pending) setAdding(false); }}
        subtitle="没有计时的阅读；结束页超过当前进度时一并更新进度"
        title="补记阅读"
        visible={adding}
      >
        {manualError ? <ReaderError message={manualError} onRetry={() => { void saveManual(); }} /> : null}
        <View style={styles.days}>{MANUAL_DAYS.map((day) => <ReaderChip key={day.daysAgo} label={day.label} onPress={() => setManual((value) => ({ ...value, daysAgo: day.daysAgo }))} selected={manual.daysAgo === day.daysAgo} />)}</View>
        <View style={styles.pages}>
          <View style={styles.page}><ReaderField keyboardType="numeric" label="开始时间" onChangeText={(time) => setManual((value) => ({ ...value, time }))} placeholder="例如 21:00" value={manual.time} /></View>
          <View style={styles.page}><ReaderField keyboardType="numeric" label="阅读时长（分钟）" onChangeText={(minutes) => setManual((value) => ({ ...value, minutes }))} value={manual.minutes} /></View>
        </View>
        <View style={styles.pages}>
          <View style={styles.page}><ReaderField keyboardType="numeric" label="开始页" onChangeText={(startPage) => setManual((value) => ({ ...value, startPage }))} placeholder="选填" value={manual.startPage} /></View>
          <View style={styles.page}><ReaderField keyboardType="numeric" label="结束页" onChangeText={(endPage) => setManual((value) => ({ ...value, endPage }))} placeholder="选填" value={manual.endPage} /></View>
        </View>
      </FormSheet>
    </ReaderDetailPane>
  );
}

/** Reading time per day for the last 30 days; empty days keep a sliver so the rhythm stays readable. Tapping picks a day. */
function DailyChart({ days }: { days: readonly { key: string; ms: number }[] }) {
  const styles = useThemedStyles(createStyles);
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(...days.map((day) => day.ms), 1);
  const readDays = days.filter((day) => day.ms > 0);
  const first = days[0];
  const pickedDay = days.find((day) => day.key === picked) ?? null;
  // Bars are a few pixels wide, so the whole chart is the target and the touch position picks the bar.
  const pick = (x: number) => {
    if (!width || !days.length) return;
    const day = days[Math.min(days.length - 1, Math.max(0, Math.floor(x / width * days.length)))];
    if (day) setPicked((current) => (current === day.key ? null : day.key));
  };
  return (
    <Pressable
      accessibilityHint="点按柱子查看那一天"
      accessibilityLabel={`近 30 天读了 ${readDays.length} 天，共 ${readerReadingDuration(readDays.reduce((sum, day) => sum + day.ms, 0))}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => pick(event.nativeEvent.locationX)}
    >
      <View style={styles.chart}>
        {days.map((day) => (
          <View
            key={day.key}
            style={[styles.bar, day.ms ? { height: `${Math.max(8, Math.round(day.ms / max * 100))}%` } : styles.barEmpty, picked !== null && day.key !== picked && styles.barDimmed]}
          />
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{first ? dayKeyLabel(first.key) : ''}</Text>
        <Text style={[styles.axisText, pickedDay && styles.axisPicked]}>{pickedDay ? `${dayKeyLabel(pickedDay.key)} · ${pickedDay.ms ? readerReadingDuration(pickedDay.ms) : '没有阅读'}` : '近 30 天 · 点按查看某天'}</Text>
        <Text style={styles.axisText}>今天</Text>
      </View>
    </Pressable>
  );
}

function dayKeyLabel(key: string): string {
  return `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`;
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SessionRow({ session, onLongPress }: { session: ReaderReadingSession; onLongPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  const pages = readerSessionPagesLabel(session);
  const long = session.durationMs >= READER_LONG_SESSION_MS;
  return (
    <Pressable
      accessibilityHint="长按修改或删除"
      accessibilityLabel={`${clock(session.startedAt)} 到 ${clock(session.endedAt)}，${readerReadingDuration(session.durationMs)}${pages ? `，${pages}` : ''}`}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, long && styles.rowLong, pressed && styles.pressed]}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowTime}>{clock(session.startedAt)} – {clock(session.endedAt)}</Text>
        {pages ? <Text style={styles.rowPages}>{pages}</Text> : null}
        {long ? <Text style={styles.rowFlag}>时间很长，可能忘了结束计时</Text> : null}
      </View>
      <Text style={styles.rowDuration}>{readerReadingDuration(session.durationMs)}</Text>
    </Pressable>
  );
}

function clock(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
    stat: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, flexBasis: '47%', flexGrow: 1, padding: spacing.md },
    statValue: { color: palette.text, fontSize: 18, fontVariant: ['tabular-nums'], fontWeight: '700' },
    statLabel: { color: palette.textMuted, fontSize: 12, marginTop: spacing.xs },
    span: { color: palette.textSubtle, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    row: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    rowLong: { backgroundColor: palette.surfaceMuted },
    pressed: { opacity: 0.66 },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTime: { color: palette.text, fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '600' },
    rowPages: { color: palette.textMuted, fontSize: 12, marginTop: 2 },
    rowFlag: { color: palette.warning, fontSize: 12, fontWeight: '700', marginTop: 2 },
    rowDuration: { color: palette.brand, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '700' },
    statWide: { flexBasis: '100%' },
    chart: { alignItems: 'flex-end', flexDirection: 'row', gap: 2, height: 56, marginTop: spacing.md },
    bar: { backgroundColor: palette.brand, borderTopLeftRadius: 2, borderTopRightRadius: 2, flex: 1 },
    barEmpty: { backgroundColor: palette.surfaceMuted, height: 3 },
    barDimmed: { opacity: 0.35 },
    axisPicked: { color: palette.brand, fontWeight: '700' },
    axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
    axisText: { color: palette.textSubtle, fontSize: 10 },
    days: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    pages: { flexDirection: 'row', gap: spacing.md },
    page: { flex: 1 },
  });
}
