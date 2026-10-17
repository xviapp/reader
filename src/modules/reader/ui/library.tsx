import {
  ArchiveRestore,
  BookOpen,
  Bookmark,
  BookmarkX,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Filter,
  FileText,
  History,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Share2,
  Timer,
  Trash2,
  Upload,
  UserRoundCog,
  WandSparkles,
  X,
} from 'lucide-react-native';
import { discardReadingSession } from '@/core/reading/reading-session-store.native';
import { suggestedPage, type ReadingSession } from '@/core/reading/reading-sessions';
import { elapsedOf, keepReadingSession, readingElapsedLabel, useReadingSession, useReadingTimers } from './use-reading-session';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/core/design/theme';
import { iconography, interaction, minimumTouchTarget, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import type { MediaLibrary } from '@/core/media/media-library';
import { ActionMenu } from '@/core/ui/action-menu';
import { ActionSheet } from '@/core/ui/action-sheet';
import { ImagePreview } from '@/core/ui/image-preview';
import { FormSheet } from '@/core/ui/app-controls';
import type { ActionMenuItem } from '@/core/ui/action-menu';

import type { ReaderDiscussionRepository, ReaderLibraryRepository, ReaderTrashRepository } from '../application/ports';
import { exportReaderBook } from '../application/reader-export';
import { readerAnswerShare } from '../application/reader-share';
import { shareReaderText } from '../application/reader-share-native';
import { useReaderShare } from './use-reader-share';
import type { ReaderAiCoordinator } from '../application/reader-ai';
import type {
  ReaderBook,
  ReaderBookStatus,
  ReaderBookDraft,
  ReaderDiscussion,
  ReaderMessage,
  ReaderPassage,
  ReaderPassageIndex,
  ReaderReadingSummary,
  ReaderRole,
} from '../domain/model';
import { READER_LONG_SESSION_MS, readerBookProgress, readerDayLabel, readerPrimaryAuthor, readerProgressEntry, readerReadingDuration, readerClockAfter, readerMinutesUntilClock, readerSessionMinutesEntry, readerStatusForPages, readerStatusLabel, passageDisplayTitle } from '../domain/rules';
import {
  ReaderButton,
  ReaderChip,
  ReaderDetailPane,
  ReaderEmpty,
  ReaderError,
  ReaderField,
  ReaderHeader,
  ReaderIconButton,
  READER_PRIMARY_ACTION_HEIGHT,
  READER_PRIMARY_HEADER_HEIGHT,
  ReaderScroll,
  ReaderSearch,
  ReaderSectionHeader,
  ReaderSettingsRow,
  ReaderSkeletonRows,
} from './reader-ui';
import { ReaderBookFavoriteRow, ReaderBookPassageRow, ReaderBookTabs, passageContextLabel } from './book-content';
import { readerBookContent } from './book-content-model';
import { saveReaderBookForm } from './book-form-save';
import { ReaderDiscussionRow } from './discussions';
import type { ReaderBookTab } from './navigation';
import { useReaderPassageActions } from './passage-actions';
import { useReaderDraftGuard } from './reader-draft-guard';

export function ReaderLibraryScreen({ books, passages, loading, error, query, status, onQueryChange, onStatusChange, onExit, onAdd, onOpen, onRetry, onSearch }: {
  books: readonly ReaderBook[];
  passages: readonly ReaderPassageIndex[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onExit?: (() => void) | undefined;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onSearch?: (() => void) | undefined;
  onRetry: () => void;
  onStatusChange: (value: ReaderBookStatus | 'all') => void;
  status: ReaderBookStatus | 'all';
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const styles = useStyles();
  const timers = useReadingTimers();
  const active = books.filter((book) => book.deletedAt === null);
  const normalized = query.trim().toLowerCase();
  const matching = active.filter((book) => (
    (!normalized || `${book.title}\n${book.authors.join('\n')}\n${book.isbn}`.toLowerCase().includes(normalized))
    && (status === 'all' || book.status === status)
  ));
  // Books being timed lead the shelf, so a timer left running is seen the next time the shelf opens.
  const timerOf = (book: ReaderBook) => timers.sessions.find((session) => session.bookId === book.id) ?? null;
  const filtered = [...matching.filter((book) => timerOf(book)), ...matching.filter((book) => !timerOf(book))];
  const filteredLabel = status === 'all' && !normalized ? `${active.length} 本书` : `${filtered.length} 本书`;
  const resetFilters = () => {
    onQueryChange('');
    onStatusChange('all');
  };
  return (
    <View style={styles.fill}>
      <ReaderHeader
        action={<View style={styles.headerActions}>
          {onSearch ? <ReaderIconButton icon={Search} label="全局搜索" onPress={onSearch} /> : null}
          <ReaderIconButton active={status !== 'all'} icon={Filter} label="筛选书籍" onPress={() => setFilterOpen((value) => !value)} />
          <ReaderIconButton active icon={Plus} label="添加书籍" onPress={onAdd} />
        </View>}
        height={READER_PRIMARY_HEADER_HEIGHT}
        onBack={onExit}
        subtitle={loading ? '正在读取书架' : filteredLabel}
        title="书架"
      />
      <ActionMenu
        items={[
          { key: 'all', label: '全部状态', icon: Filter, onPress: () => onStatusChange('all') },
          { key: 'unread', label: '未开始', icon: Filter, onPress: () => onStatusChange('unread') },
          { key: 'reading', label: '阅读中', icon: Filter, onPress: () => onStatusChange('reading') },
          { key: 'finished', label: '已读完', icon: Filter, onPress: () => onStatusChange('finished') },
        ]}
        onClose={() => setFilterOpen(false)}
        visible={filterOpen}
      />
      <ReaderSearch onChangeText={onQueryChange} placeholder="搜索书名、作者或 ISBN" value={query} />
      {error ? <ReaderError message={error} onRetry={onRetry} /> : null}
      {loading ? <ReaderSkeletonRows /> : filtered.length ? (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {filtered.map((book) => (
            <BookRow
              book={book}
              key={book.id}
              timer={timerLabel(timerOf(book), timers.now)}
              passageCount={passages.filter((passage) => passage.bookId === book.id && passage.deletedAt === null).length}
              onPress={() => onOpen(book.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <ReaderEmpty
          action={normalized || status !== 'all'
            ? <ReaderButton label="重置筛选" onPress={resetFilters} secondary />
            : <View style={styles.primaryAction}><ReaderButton icon={Plus} label="添加书籍" onPress={onAdd} /></View>}
          detail={normalized || status !== 'all' ? '没有符合当前条件的书。' : '添加手边的书，然后拍摄或录入重要段落。'}
          icon={BookOpen}
          title={normalized || status !== 'all' ? '没有找到匹配的书' : '从手边这本书开始'}
        />
      )}
    </View>
  );
}

// Steps the title down until it fits one line; past the smallest size it wraps instead of shrinking further.
const heroTitleSizes = [24, 21, 18] as const;

function HeroTitle({ title, style, onBottom }: { title: string; style: StyleProp<TextStyle>; onBottom: (bottom: number) => void }) {
  const [step, setStep] = useState(0);
  const [width, setWidth] = useState(0);
  const fontSize = heroTitleSizes[step] ?? 18;
  return (
    <Text
      onLayout={(event) => {
        const { layout } = event.nativeEvent;
        onBottom(layout.y + layout.height);
        const next = Math.round(layout.width);
        // A wider slot (rotation, split view) may fit a larger size again.
        if (width && next > width) setStep(0);
        setWidth(next);
      }}
      onTextLayout={(event) => { if (event.nativeEvent.lines.length > 1 && step < heroTitleSizes.length - 1) setStep(step + 1); }}
      style={[style, { fontSize, lineHeight: Math.round(fontSize * 1.25) }]}
    >
      {title}
    </Text>
  );
}

const HERO_AUTHOR_CHEVRON = 16;

/** The author line doubles as the book-details toggle; it expands when there are details or the authors do not fit one line. */
function HeroAuthor({ authors, expanded, hasDetails, onToggle }: { authors: readonly string[]; expanded: boolean; hasDetails: boolean; onToggle: () => void }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const [overflows, setOverflows] = useState(false);
  const text = readerPrimaryAuthor(authors);
  const expandable = hasDetails || overflows;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  const content = <>
    <Text numberOfLines={expanded ? undefined : 1} style={styles.heroAuthor}>{text}</Text>
    {expandable ? <Chevron color={palette.textSubtle} size={HERO_AUTHOR_CHEVRON} strokeWidth={iconography.stroke} /> : null}
    {/* Lays out the full line at the width left beside the chevron; only its line count is read. */}
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onTextLayout={(event) => setOverflows(event.nativeEvent.lines.length > 1)}
      style={[styles.heroAuthor, styles.heroAuthorMeasure]}
    >
      {text}
    </Text>
  </>;
  if (!expandable) return <View style={styles.heroAuthorRow}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={`${text}，${expanded ? '收起' : '展开'}书籍资料`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [styles.heroAuthorRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function timerLabel(session: ReadingSession | null, now: number): string | null {
  return session ? readingElapsedLabel(elapsedOf(session, now)) : null;
}

function BookRow({ book, passageCount, timer, onPress }: { book: ReaderBook; passageCount: number; timer: string | null; onPress: () => void }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const progress = readerBookProgress(book);
  return (
    <Pressable accessibilityLabel={`打开书籍：${book.title}${timer ? `，正在计时 ${timer}` : ''}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.bookRow, timer !== null && styles.bookRowTiming, pressed && styles.pressed]}>
      <BookCover book={book} size="row" />
      <View style={styles.bookCopy}>
        <Text numberOfLines={2} style={styles.bookTitle}>{book.title}</Text>
        <Text numberOfLines={1} style={styles.bookAuthor}>{readerPrimaryAuthor(book.authors)}</Text>
        <View style={styles.bookMetaRow}>
          <Text style={[styles.bookStatus, { color: statusColor(book.status, palette) }]}>{readerStatusLabel(book.status)}</Text>
          {timer !== null ? (
            <View style={styles.timerPill}>
              <Timer color={palette.onPrimary} size={12} strokeWidth={iconography.stroke} />
              <Text style={styles.timerPillText}>{timer}</Text>
            </View>
          ) : null}
          <Text style={styles.bookMeta}>{passageCount} 条摘录</Text>
          {progress !== null ? <Text style={styles.bookMeta}>{progress}%</Text> : null}
        </View>
        {progress !== null ? <ProgressBar progress={progress} /> : null}
      </View>
    </Pressable>
  );
}

type BookContextTarget =
  | { kind: 'passage'; passage: ReaderPassage }
  | { kind: 'discussion'; discussion: ReaderDiscussion }
  | { kind: 'favorite'; message: ReaderMessage; discussion: ReaderDiscussion };

interface ReaderBookCollectionState {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ReaderBookDetailScreen({ book, books, passages, discussions, favorites, repository, ai, aiAvailable, tab, passageState, discussionState, favoriteState, wide, onBack, onTabChange, onEdit, onCapture, onOpenPassage, onOpenPassageSource, onDiscuss, onOpenDiscussion, onFocusFavorite, onTrashPassage, onTrashDiscussion, onUnfavorite, onTrash, onOpenTrash, onOpenReading, onOpenBookTimer, endSessionRequested = false, onEndSessionHandled, onSearch }: {
  book: ReaderBook;
  /** Every book, to name another book whose timer is running. */
  books: readonly ReaderBook[];
  passages: readonly ReaderPassageIndex[];
  discussions: readonly ReaderDiscussion[];
  favorites: readonly ReaderMessage[];
  repository: ReaderLibraryRepository & ReaderDiscussionRepository;
  ai: ReaderAiCoordinator | null;
  aiAvailable: boolean;
  tab: ReaderBookTab;
  passageState: ReaderBookCollectionState;
  discussionState: ReaderBookCollectionState;
  favoriteState: ReaderBookCollectionState;
  wide: boolean;
  onBack: () => void;
  onTabChange: (tab: ReaderBookTab) => void;
  onEdit: () => void;
  onCapture: () => void;
  onOpenPassage: (id: string) => void;
  onOpenPassageSource: (id: string) => void;
  onDiscuss: () => void;
  onOpenDiscussion: (id: string, focusMessageId?: string) => void;
  onFocusFavorite: (messageId: string, discussionId: string) => void;
  onTrashPassage: (id: string) => void;
  onTrashDiscussion: (id: string) => void;
  onUnfavorite: (messageId: string) => void;
  onTrash: () => void;
  onOpenTrash: () => void;
  onOpenReading: () => void;
  /** Opens another book with its timer's end sheet. */
  onOpenBookTimer: (bookId: string) => void;
  endSessionRequested?: boolean;
  onEndSessionHandled?: () => void;
  onSearch?: (() => void) | undefined;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [progressSheetOpen, setProgressSheetOpen] = useState(false);
  const [progressDraft, setProgressDraft] = useState('');
  const [pageCountDraft, setPageCountDraft] = useState('');
  const progress = readerBookProgress(book);
  const [progressStatus, setProgressStatus] = useState<ReaderBookStatus>(book.status);
  // The status the sheet opened with; page edits suggest a status from it until a chip is chosen.
  const [progressBaseStatus, setProgressBaseStatus] = useState<ReaderBookStatus>(book.status);
  const [progressStatusChosen, setProgressStatusChosen] = useState(false);
  const [progressPending, setProgressPending] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const reading = useReadingSession(book.id, book.title);
  const [readingSummary, setReadingSummary] = useState<ReaderReadingSummary | null>(null);
  const [sessionEnding, setSessionEnding] = useState(false);
  // The header repeats the title only once the hero title has scrolled away.
  const [headerTitleShown, setHeaderTitleShown] = useState(false);
  const heroTitleBottom = useRef(Number.POSITIVE_INFINITY);
  // Set when the timer being ended ran past READER_LONG_SESSION_MS; the sheet then asks how long the reading really took.
  const [sessionLong, setSessionLong] = useState(false);
  const [sessionMinutesDraft, setSessionMinutesDraft] = useState('');
  const [sessionEndDraft, setSessionEndDraft] = useState('');
  // The end time and the minutes describe the same thing; editing either keeps the other in step.
  const editSessionEnd = (text: string) => {
    setSessionEndDraft(text);
    const result = reading.session ? readerMinutesUntilClock(reading.session.startedAt, text) : null;
    if (result?.ok) setSessionMinutesDraft(String(result.minutes));
  };
  const editSessionMinutes = (text: string) => {
    setSessionMinutesDraft(text);
    const minutes = Number(text.trim());
    if (reading.session && text.trim() && Number.isInteger(minutes) && minutes > 0) setSessionEndDraft(readerClockAfter(reading.session.startedAt, minutes));
  };
  const sessionMinutes = sessionLong ? Number(sessionMinutesDraft) || 0 : reading.minutes;
  const [exporting, setExporting] = useState(false);
  const [contextTarget, setContextTarget] = useState<BookContextTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sharing = useReaderShare(setActionError);
  const mounted = useRef(true);
  const contextRequest = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const tabOffset = useRef(0);
  const tabOffsets = useRef<Record<ReaderBookTab, number>>({ passages: 0, discussions: 0, favorites: 0 });
  const visitedTabs = useRef(new Set<ReaderBookTab>([tab]));
  const content = useMemo(() => readerBookContent(book.id, passages, discussions, favorites), [book.id, discussions, favorites, passages]);
  const selectedPassage = contextTarget?.kind === 'passage' ? contextTarget.passage : null;
  const passageActions = useReaderPassageActions({
    passage: selectedPassage,
    book,
    ai,
    aiAvailable,
    onSource: onOpenPassageSource,
    onTrash: onTrashPassage,
    onError: setActionError,
  });
  const noteCanExpand = [...book.note].length > 90 || book.note.split('\n').length > 3;
  const summaryCanExpand = [...book.summary].length > 180 || book.summary.split('\n').length > 3;
  useEffect(() => () => { mounted.current = false; }, []);
  // A failed read only hides the summary; the timer and progress keep working.
  useEffect(() => repository.watchReadingSummary(book.id, setReadingSummary, () => setReadingSummary(null)), [book.id, repository]);
  const searchBook = () => {
    const query = encodeURIComponent([book.title, ...book.authors].join(' '));
    void Linking.openURL(`https://www.google.com/search?q=${query}`);
  };
  const openProgress = (page: string, status: ReaderBookStatus) => {
    setProgressDraft(page);
    setPageCountDraft('');
    setProgressStatus(status);
    setProgressBaseStatus(status);
    setProgressStatusChosen(false);
    setProgressError(null);
  };
  const editProgressPages = (page: string, pageCount: string) => {
    setProgressDraft(page);
    setPageCountDraft(pageCount);
    const entry = readerProgressEntry(book, page, pageCount);
    if (entry.ok && !progressStatusChosen) setProgressStatus(readerStatusForPages(progressBaseStatus, entry.pagesRead, entry.pageCount));
  };
  const openProgressEditor = () => {
    openProgress(book.pagesRead ? String(book.pagesRead) : '', book.status);
    setSessionEnding(false);
    setProgressSheetOpen(true);
  };
  // Ending a reading session reuses the progress sheet; the session is kept with the book.
  const openSessionEnd = () => {
    reading.refresh();
    const long = reading.elapsedMs >= READER_LONG_SESSION_MS;
    setSessionLong(long);
    setSessionMinutesDraft(long ? String(reading.minutes) : '');
    setSessionEndDraft(long && reading.session ? readerClockAfter(reading.session.startedAt, reading.minutes) : '');
    const pages = passages.filter((item) => item.bookId === book.id && item.deletedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((item) => item.pageLabel);
    const page = Math.max(book.pagesRead, suggestedPage(pages) ?? 0);
    const base = book.status === 'unread' ? 'reading' : book.status;
    openProgress(page ? String(page) : '', page ? readerStatusForPages(base, page, book.pageCount) : base);
    setSessionEnding(true);
    setProgressSheetOpen(true);
  };
  // One book is read at a time: starting asks what to do with a timer still running on another book.
  const startReading = () => {
    const other = reading.others[0];
    const otherBook = other ? books.find((item) => item.id === other.bookId && item.deletedAt === null) : undefined;
    const start = () => { void reading.start(); };
    if (!other) return start();
    // A timer whose book is gone could never be ended from its page.
    if (!otherBook) return void discardReadingSession(other.bookId).then(start);
    const elapsed = Date.now() - Date.parse(other.startedAt);
    const long = elapsed >= READER_LONG_SESSION_MS;
    const finishOther = () => {
      const finished = long
        ? discardReadingSession(otherBook.id)
        : keepReadingSession(repository, otherBook, other, { startPage: otherBook.pagesRead || null, endPage: null }, Date.now());
      void finished.then(start).catch((cause: unknown) => setActionError(messageOf(cause, '结束计时失败')));
    };
    // Android shows at most three buttons; a probably forgotten timer trades 同时计时 for a way to correct it.
    Alert.alert(
      `《${otherBook.title}》正在计时`,
      long
        ? `已计时 ${readerReadingDuration(elapsed)}，可能忘了结束。去那本书改成实际时长，或放弃那段计时再开始这本。`
        : `已计时 ${readerReadingDuration(elapsed)}。结束那本并记录，再开始这本？`,
      long
        ? [
          { text: '取消', style: 'cancel' },
          { text: '去处理', onPress: () => onOpenBookTimer(otherBook.id) },
          { text: '放弃并开始', style: 'destructive', onPress: finishOther },
        ]
        : [
          { text: '取消', style: 'cancel' },
          { text: '同时计时', onPress: start },
          { text: '结束并开始', onPress: finishOther },
        ],
    );
  };
  // Arriving to correct a running timer opens its end sheet once the timer has loaded.
  const openRequestedSessionEnd = useEffectEvent(() => {
    openSessionEnd();
    onEndSessionHandled?.();
  });
  const hasSession = reading.session !== null;
  useEffect(() => {
    if (!endSessionRequested || !hasSession) return undefined;
    const frame = requestAnimationFrame(openRequestedSessionEnd);
    return () => cancelAnimationFrame(frame);
  }, [endSessionRequested, hasSession]);
  const discardSession = () => {
    if (progressPending) return;
    void discardReadingSession(book.id);
    setSessionEnding(false);
    setProgressSheetOpen(false);
  };
  const saveProgress = async () => {
    if (progressPending) return;
    const entry = readerProgressEntry(book, progressDraft, pageCountDraft);
    if (!entry.ok) {
      setProgressError(entry.error);
      return;
    }
    const { page } = entry;
    const session = sessionEnding ? reading.session : null;
    let endedAt = Date.now();
    if (session && sessionLong) {
      const duration = readerSessionMinutesEntry(sessionMinutesDraft, endedAt - Date.parse(session.startedAt));
      if (!duration.ok) {
        setProgressError(duration.error);
        return;
      }
      endedAt = Date.parse(session.startedAt) + duration.minutes * 60_000;
    }
    setProgressPending(true);
    setProgressError(null);
    try {
      await repository.updateBook(book.id, { ...bookDraftOf(book), status: progressStatus, pageCount: entry.pageCount, pagesRead: entry.pagesRead });
      if (session) await keepReadingSession(repository, book, session, { startPage: book.pagesRead || null, endPage: page }, endedAt);
      setSessionEnding(false);
      setProgressSheetOpen(false);
    } catch (cause) {
      setProgressError(messageOf(cause, '保存阅读进度失败'));
    } finally {
      setProgressPending(false);
    }
  };
  const exportBook = async (includeSource = false) => {
    if (exporting) return;
    setExporting(true);
    setActionError(null);
    try {
      const fullPassages = (await Promise.all(
        passages.filter((item) => item.bookId === book.id && item.deletedAt === null).map((item) => repository.getPassage(item.id)),
      )).filter((item): item is ReaderPassage => Boolean(item && item.deletedAt === null));
      const bookDiscussions = content.discussions.map(async (discussion) => ({ discussion, messages: await repository.listMessages(discussion.id) }));
      await exportReaderBook({ book, passages: fullPassages, discussions: await Promise.all(bookDiscussions), reading: readingSummary }, includeSource);
    } catch (cause) {
      setActionError(messageOf(cause, '导出数据失败'));
    } finally {
      setExporting(false);
    }
  };
  const changeTab = (next: ReaderBookTab) => {
    if (next === tab) return;
    tabOffsets.current[tab] = scrollOffset.current;
    const target = visitedTabs.current.has(next) ? tabOffsets.current[next] : tabOffset.current;
    visitedTabs.current.add(next);
    onTabChange(next);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y: target })));
  };
  const openPassageActions = (passage: ReaderPassageIndex) => {
    const request = contextRequest.current + 1;
    contextRequest.current = request;
    setActionError(null);
    void repository.getPassage(passage.id).then((full) => {
      if (!mounted.current || contextRequest.current !== request) return;
      if (!full || full.deletedAt !== null) throw new Error('这条摘录不存在或已在回收站');
      setContextTarget({ kind: 'passage', passage: full });
    }).catch((cause: unknown) => {
      if (mounted.current && contextRequest.current === request) setActionError(messageOf(cause, '读取摘录操作失败'));
    });
  };
  const contextItems: readonly ActionMenuItem[] = contextTarget?.kind === 'passage' ? passageActions.items
    : contextTarget?.kind === 'discussion' ? [
      { key: 'open', label: '打开讨论', icon: MessageCircle, onPress: () => onOpenDiscussion(contextTarget.discussion.id) },
      { key: 'trash', label: '移到回收站', icon: Trash2, danger: true, onPress: () => onTrashDiscussion(contextTarget.discussion.id) },
    ] : contextTarget?.kind === 'favorite' ? [
      { key: 'open', label: '打开原讨论', icon: MessageCircle, onPress: () => onOpenDiscussion(contextTarget.discussion.id, contextTarget.message.id) },
      { key: 'focus', label: '专注阅读', icon: BookOpen, onPress: () => onFocusFavorite(contextTarget.message.id, contextTarget.discussion.id) },
      { key: 'share', label: '分享回答', icon: Share2, disabled: sharing.pending || contextTarget.message.status !== 'completed' || !contextTarget.message.content.trim(), onPress: () => {
        const { message, discussion } = contextTarget;
        sharing.run(() => shareReaderText(readerAnswerShare(message, discussion, book)));
      } },
      { key: 'unfavorite', label: '取消收藏', icon: BookmarkX, danger: true, onPress: () => onUnfavorite(contextTarget.message.id) },
    ] : [];
  const contextTitle = contextTarget?.kind === 'passage'
    ? passageDisplayTitle(contextTarget.passage.title, contextTarget.passage.pageLabel, contextTarget.passage.sourceText)
    : contextTarget?.kind === 'discussion' ? contextTarget.discussion.title
      : contextTarget?.kind === 'favorite' ? contextTarget.discussion.title : '';
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = Math.max(0, event.nativeEvent.contentOffset.y);
    tabOffsets.current[tab] = scrollOffset.current;
    const shown = scrollOffset.current > heroTitleBottom.current;
    if (shown !== headerTitleShown) setHeaderTitleShown(shown);
  };
  const tabContent = tab === 'passages'
    ? passageState.loading ? <ReaderSkeletonRows count={3} />
      : passageState.error ? <ReaderError message={passageState.error} onRetry={passageState.onRetry} />
        : content.passages.length ? content.passages.map((passage) => (
          <ReaderBookPassageRow key={passage.id} onLongPress={() => openPassageActions(passage)} onPress={() => onOpenPassage(passage.id)} passage={passage} />
        )) : <ReaderEmpty action={<ReaderButton icon={Camera} label="采集书页" onPress={onCapture} />} detail="拍摄书页、本地识别，或直接录入原文。" icon={FileText} title="还没有摘录" />
    : tab === 'discussions'
      ? discussionState.loading ? <ReaderSkeletonRows count={3} />
        : discussionState.error ? <ReaderError message={discussionState.error} onRetry={discussionState.onRetry} />
          : content.discussions.length ? content.discussions.map((discussion) => (
            <ReaderDiscussionRow
              book={null}
              contextLabel={passageContextLabel(discussion, content.passages)}
              discussion={discussion}
              key={discussion.id}
              onLongPress={() => setContextTarget({ kind: 'discussion', discussion })}
              onPress={() => onOpenDiscussion(discussion.id)}
            />
          )) : <ReaderEmpty action={<ReaderButton icon={MessageCircle} label="新建讨论" onPress={onDiscuss} />} detail="围绕这本书或选中的摘录提出问题。" icon={MessageCircle} title="还没有讨论" />
      : favoriteState.loading ? <ReaderSkeletonRows count={3} />
        : favoriteState.error ? <ReaderError message={favoriteState.error} onRetry={favoriteState.onRetry} />
          : content.favorites.length ? content.favorites.map((message) => {
            const discussion = content.discussions.find((item) => item.id === message.discussionId) ?? null;
            return <ReaderBookFavoriteRow discussion={discussion} key={message.id} message={message} onLongPress={() => { if (discussion) setContextTarget({ kind: 'favorite', message, discussion }); }} onPress={() => { if (discussion) onOpenDiscussion(discussion.id, message.id); }} />;
          }) : <ReaderEmpty detail="在讨论中收藏的 AI 回答会出现在这里。" icon={Bookmark} title="还没有收藏回答" />;
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader
        action={<View style={styles.headerActions}>
          {tab === 'passages' ? <ReaderIconButton icon={Camera} label="采集书页" onPress={onCapture} /> : null}
          {tab === 'discussions' ? <ReaderIconButton active icon={Plus} label="新建讨论" onPress={onDiscuss} /> : null}
          {onSearch ? <ReaderIconButton icon={Search} label="搜索本书" onPress={onSearch} /> : null}
          <ReaderIconButton icon={MoreHorizontal} label="书籍操作" onPress={() => setMenuOpen((value) => !value)} />
        </View>}
        onBack={!wide ? onBack : undefined}
        title={headerTitleShown ? book.title : ''}
      />
      {actionError ? <ReaderError message={actionError} onRetry={() => { setActionError(null); }} retryLabel="关闭" /> : null}
      <ReaderBookActionMenu
        items={[
          { key: 'edit', label: '编辑信息', icon: Pencil, onPress: onEdit },
          { key: 'reading', label: '阅读记录', icon: History, onPress: onOpenReading },
          { key: 'export', label: exporting ? '正在导出数据' : '导出数据', icon: FileText, disabled: exporting, onPress: () => { void exportBook(true); } },
          { key: 'search', label: '外部搜索', icon: ExternalLink, onPress: searchBook },
          ...(content.deletedCount ? [{ key: 'trash-bin', label: '本书回收站', icon: ArchiveRestore, onPress: onOpenTrash }] : []),
          { key: 'trash', label: '移到回收站', icon: Trash2, danger: true, onPress: onTrash },
        ]}
        onClose={() => setMenuOpen(false)}
        visible={menuOpen}
      />
      <ScrollView
        contentContainerStyle={styles.bookDetailContent}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        ref={scrollRef}
        scrollEventThrottle={32}
        stickyHeaderIndices={[1]}
      >
        <View>
          <View style={styles.hero}>
            <BookCover book={book} size="hero" />
            <View style={styles.heroCopy}>
              <HeroTitle key={book.title} onBottom={(bottom) => { heroTitleBottom.current = spacing.lg + bottom; }} style={styles.heroTitle} title={book.title} />
              <HeroAuthor
                authors={book.authors}
                expanded={detailsExpanded}
                hasDetails={Boolean(book.publisher || book.publishedAt || book.isbn)}
                onToggle={() => setDetailsExpanded((value) => !value)}
              />
              {detailsExpanded ? <>
                {book.publisher || book.publishedAt ? <Text style={styles.heroMeta}>{[book.publisher, book.publishedAt].filter(Boolean).join(' · ')}</Text> : null}
                {book.isbn ? <Text style={styles.heroMeta}>ISBN {book.isbn}</Text> : null}
              </> : null}
              <Pressable accessibilityLabel="编辑阅读进度" accessibilityRole="button" onPress={openProgressEditor} style={({ pressed }) => [styles.progressEditor, pressed && styles.pressed]}>
                <View style={styles.bookMetaRow}>
                  <Text style={[styles.bookStatus, { color: statusColor(book.status, palette) }]}>{readerStatusLabel(book.status)}</Text>
                  {progress !== null ? <Text style={styles.bookMeta}>{book.pagesRead} / {book.pageCount} 页 · {progress}%</Text> : null}
                  {progress !== null ? <Pencil color={palette.textSubtle} size={13} strokeWidth={iconography.stroke} /> : null}
                </View>
                {progress !== null ? <ProgressBar progress={progress} prominent /> : null}
                {/* Once progress shows, the pencil says it is editable; until then the hint says what to fill in. */}
                {progress === null ? <Text style={styles.progressHint}>{book.pageCount ? '点击填写读到的页数' : '点击填写页数后显示进度'}</Text> : null}
              </Pressable>
              {readingSummary?.sessionCount ? (
                <Pressable accessibilityLabel={`阅读记录：累计 ${readerReadingDuration(readingSummary.totalMs)}，${readingSummary.sessionCount} 次`} accessibilityRole="link" hitSlop={6} onPress={onOpenReading} style={({ pressed }) => [styles.readingSummaryLink, pressed && styles.pressed]}>
                  <Text style={styles.readingSummaryText}>{readerReadingDuration(readingSummary.totalMs)} · {readingSummary.sessionCount} 次</Text>
                  <ChevronRight color={palette.brand} size={14} strokeWidth={iconography.stroke} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel={reading.session ? `结束阅读，已读 ${reading.minutes} 分钟` : '开始阅读'}
              accessibilityRole="button"
              onPress={() => { if (reading.session) openSessionEnd(); else startReading(); }}
              style={({ pressed }) => [styles.readingTimer, reading.session && styles.readingTimerActive, pressed && styles.pressed]}
            >
              <Timer color={reading.session ? palette.onPrimary : palette.brand} size={20} strokeWidth={iconography.stroke} />
              <Text style={[styles.readingTimerValue, reading.session && styles.readingTimerValueActive]}>{reading.session ? reading.elapsed : '开始'}</Text>
              <Text style={[styles.readingTimerCaption, reading.session && styles.readingTimerCaptionActive]}>{reading.session ? '点按结束' : '阅读计时'}</Text>
            </Pressable>
          </View>
          {book.summary ? (
            <View style={styles.summaryBlock}>
              <Text numberOfLines={summaryExpanded ? undefined : 3} style={styles.bookSummary}>{book.summary}</Text>
              {summaryCanExpand ? (
                <Pressable accessibilityLabel={summaryExpanded ? '收起书籍简介' : '展开书籍简介'} accessibilityRole="button" onPress={() => setSummaryExpanded((value) => !value)} style={({ pressed }) => [styles.summaryToggle, pressed && styles.pressed]}>
                  <Text style={styles.noteToggle}>{summaryExpanded ? '收起简介' : '展开简介'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {book.note ? (
            <Pressable
              {...(noteCanExpand ? {
                accessibilityLabel: noteExpanded ? '收起读书备注' : '展开读书备注',
                accessibilityRole: 'button' as const,
                onPress: () => setNoteExpanded((value) => !value),
              } : {})}
              style={({ pressed }) => [styles.bookNote, noteCanExpand && pressed && styles.pressed]}
            >
              <Text style={styles.bookNoteLabel}>读书备注</Text>
              <Text numberOfLines={noteExpanded ? undefined : 3} style={styles.noteText}>{book.note}</Text>
              {noteCanExpand ? <Text style={styles.noteToggle}>{noteExpanded ? '收起' : '展开'}</Text> : null}
            </Pressable>
          ) : null}
        </View>
        <View onLayout={(event) => { tabOffset.current = event.nativeEvent.layout.y; }} style={styles.stickyTabs}>
          <ReaderBookTabs
            active={tab}
            discussionCount={discussionState.loading || discussionState.error ? null : content.discussions.length}
            favoriteCount={favoriteState.loading || favoriteState.error ? null : content.favorites.length}
            onChange={changeTab}
            passageCount={passageState.loading || passageState.error ? null : content.passages.length}
            unread={content.discussions.some((discussion) => discussion.unread)}
          />
        </View>
        <View style={styles.tabContent}>{tabContent}</View>
      </ScrollView>
      <ActionSheet
        items={contextItems}
        onClose={() => setContextTarget(null)}
        {...(contextTarget?.kind === 'favorite' ? { subtitle: '收藏回答' } : {})}
        title={contextTitle}
        visible={contextTarget !== null}
      />
      <FormSheet
        footer={<>
          {sessionEnding ? <ReaderButton disabled={progressPending} label="不记录，结束计时" onPress={discardSession} secondary /> : null}
          <ReaderButton disabled={progressPending} icon={Save} label={progressPending ? '正在保存' : sessionEnding && sessionMinutes >= 1 ? '保存并记录' : '保存进度'} onPress={() => { void saveProgress(); }} />
        </>}
        onClose={() => { if (!progressPending) { setSessionEnding(false); setProgressSheetOpen(false); } }}
        subtitle={sessionEnding ? (sessionMinutes < 1 ? '本次不足 1 分钟，只更新进度，不计入阅读记录' : `本次阅读 ${readerReadingDuration(sessionMinutes * 60_000)}，保存后计入阅读记录`) : '只更新读到的页数和阅读状态'}
        title={sessionEnding ? '结束阅读' : '更新阅读进度'}
        visible={progressSheetOpen}
      >
        {progressError ? <ReaderError message={progressError} onRetry={() => { void saveProgress(); }} /> : null}
        {sessionEnding && sessionLong && reading.session ? <>
          <View style={styles.sessionWarning}>
            <Text style={styles.sessionWarningTitle}>计时已超过 {readerReadingDuration(READER_LONG_SESSION_MS)}</Text>
            <Text style={styles.sessionWarningText}>从{readerDayLabel(new Date(reading.session.startedAt))} {clockOf(reading.session.startedAt)} 开始，已计时 {readerReadingDuration(reading.elapsedMs)}，可能忘了结束。请改成实际停下的时间，或直接填读了多久。</Text>
          </View>
          <View style={styles.sessionFields}>
            <View style={styles.sessionField}><ReaderField keyboardType="numeric" label="实际结束于" onChangeText={editSessionEnd} placeholder="例如 22:30" value={sessionEndDraft} /></View>
            <View style={styles.sessionField}><ReaderField keyboardType="numeric" label="阅读时长（分钟）" onChangeText={editSessionMinutes} value={sessionMinutesDraft} /></View>
          </View>
        </> : null}
        {book.pageCount ? null : <ReaderField keyboardType="numeric" label="全书页数" onChangeText={(value) => editProgressPages(progressDraft, value)} placeholder="选填，填写后显示阅读进度" value={pageCountDraft} />}
        <ReaderField
          keyboardType="numeric"
          label={book.pageCount ? `读到第几页（共 ${book.pageCount} 页）` : '读到第几页'}
          onChangeText={(value) => editProgressPages(value, pageCountDraft)}
          placeholder={book.pagesRead ? `不填则保持第 ${book.pagesRead} 页` : '选填'}
          value={progressDraft}
        />
        <Text style={styles.formLabel}>阅读状态</Text>
        <View style={styles.chips}>{(['unread', 'reading', 'finished'] as const).map((status) => <ReaderChip key={status} label={readerStatusLabel(status)} onPress={() => { setProgressStatusChosen(true); setProgressStatus(status); }} selected={progressStatus === status} />)}</View>
      </FormSheet>
    </ReaderDetailPane>
  );
}

export function ReaderBookFormScreen({ book, roles, media, wide, onBack, onSave, onSaved, ai, aiAvailable }: {
  book: ReaderBook | null;
  roles: readonly ReaderRole[];
  media: MediaLibrary;
  wide: boolean;
  onBack: () => void;
  onSave: (draft: ReaderBookDraft, previousCover: string) => Promise<string>;
  onSaved: (bookId: string) => void;
  ai: ReaderAiCoordinator | null;
  aiAvailable: boolean;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const source = useMemo<ReaderBookDraft>(() => book ? bookDraftOf(book) : blankBook(roles[0]?.id), [book, roles]);
  const [form, setForm] = useState(() => ({
      draft: source,
      authors: source.authors.join('、'),
      pageCount: source.pageCount ? String(source.pageCount) : '',
      pagesRead: source.pagesRead ? String(source.pagesRead) : '',
      temporaryUri: null as string | null,
  }));
  const { draft, authors, pageCount, pagesRead, temporaryUri } = form;
  const formProgress = readerBookProgress({ pageCount: Number(pageCount) || 0, pagesRead: Number(pagesRead) || 0 });
  const [dirty, setDirty] = useState(false);
  const setDraft = (next: ReaderBookDraft | ((current: ReaderBookDraft) => ReaderBookDraft)) => {
    setDirty(true);
    setForm((current) => ({ ...current, draft: typeof next === 'function' ? next(current.draft) : next }));
  };
  const setAuthors = (authors: string) => { setDirty(true); setForm((current) => ({ ...current, authors })); };
  const setPageCount = (pageCount: string) => { setDirty(true); setForm((current) => ({ ...current, pageCount })); };
  const setPagesRead = (pagesRead: string) => { setDirty(true); setForm((current) => ({ ...current, pagesRead })); };
  const setTemporaryUri = (temporaryUri: string | null) => { setDirty(true); setForm((current) => ({ ...current, temporaryUri })); };
  const [pending, setPending] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(book));
  const [readingOpen, setReadingOpen] = useState(Boolean(book));
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [roleQuery, setRoleQuery] = useState('');
  const promptAbort = useRef<AbortController | null>(null);
  useEffect(() => () => promptAbort.current?.abort(), []);
  const selectedRole = roles.find((role) => role.id === draft.roleId) ?? null;
  const filteredRoles = roles.filter((role) => !roleQuery.trim() || `${role.name}\n${role.description}`.toLocaleLowerCase('zh-CN').includes(roleQuery.trim().toLocaleLowerCase('zh-CN')));
  const close = () => {
    promptAbort.current?.abort();
    onBack();
  };
  const selectCover = async (sourceType: 'camera' | 'library') => {
    if (pending) return;
    setError(null);
    try {
      const result = await media.selectImage(sourceType, 'cover');
      if (!result) return;
      if (temporaryUri) await media.deleteImage(temporaryUri);
      setTemporaryUri(result.uri);
      setDraft((value) => ({ ...value, coverUri: result.uri }));
    } catch (cause) { setError(messageOf(cause, '无法读取封面')); }
  };
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await saveReaderBookForm({
        draft: {
          title: draft.title,
          authors: authors.split(/[、,，\n/]+/u).map((item) => item.trim()).filter(Boolean),
          coverUri: draft.coverUri,
          isbn: draft.isbn,
          publisher: draft.publisher,
          publishedAt: draft.publishedAt,
          summary: draft.summary,
          note: draft.note,
          status: draft.status,
          progress: 0,
          pageCount: Number(pageCount) || 0,
          pagesRead: Number(pagesRead) || 0,
          roleId: draft.roleId,
          customPrompt: draft.customPrompt,
        },
        previousCover: book?.coverUri ?? '',
        temporaryUri,
        persist: onSave,
        deleteImage: (uri) => media.deleteImage(uri),
        onSaved,
      });
      setDirty(false);
    } catch (cause) { setError(messageOf(cause, '保存书籍失败')); }
    finally { setPending(false); }
  };
  const generatePrompt = async () => {
    if (draft.customPrompt.trim()) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert('生成本书专属 Prompt？', '这会覆盖当前已填写的专属 Prompt。', [
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
          { text: '生成', onPress: () => resolve(true) },
        ]);
      });
      if (!proceed) return;
    }
    if (!ai) return;
    const role = selectedRole;
    const controller = new AbortController();
    promptAbort.current?.abort();
    promptAbort.current = controller;
    setGeneratingPrompt(true);
    setError(null);
    try {
      const generated = await ai.generateBookCustomPrompt({
        title: draft.title,
        authors: authors.split(/[、,，\n/]+/u).map((item) => item.trim()).filter(Boolean),
        publisher: draft.publisher,
        publishedAt: draft.publishedAt,
        summary: draft.summary,
        note: draft.note,
        roleName: role?.name ?? '',
        roleDescription: role?.description ?? '',
      }, controller.signal);
      if (controller.signal.aborted) return;
      setDraft((value) => ({ ...value, customPrompt: generated }));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(messageOf(cause, '生成专属 Prompt 失败'));
    } finally {
      if (promptAbort.current === controller) {
        promptAbort.current = null;
        setGeneratingPrompt(false);
      }
    }
  };
  const clearPrompt = () => {
    setDraft((value) => ({ ...value, customPrompt: '' }));
    setError(null);
  };
  const requestClose = useReaderDraftGuard({
    dirty,
    noun: book ? '书籍修改' : '新书信息',
    onBack: close,
    onSave: save,
    pending: pending || generatingPrompt,
  });
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader
        action={<ReaderIconButton active disabled={pending || !draft.title.trim()} icon={Save} label="保存" onPress={() => { void save(); }} />}
        onBack={requestClose}
        title={book ? '编辑书籍' : '添加书籍'}
      />
      <ReaderScroll style={styles.form}>
        <View style={styles.coverEditor}>
          {draft.coverUri ? <Pressable accessibilityLabel="查看并编辑封面" accessibilityRole="button" onPress={() => setCoverPreviewOpen(true)} style={({ pressed }) => [styles.coverImageButton, pressed && styles.pressed]}>
            <Image source={{ uri: draft.coverUri }} style={styles.coverEditorImage} />
          </Pressable> : <View style={styles.coverEditorEmpty}><BookOpen size={30}  strokeWidth={iconography.stroke} /></View>}
          <View style={styles.coverActions}>
            <ReaderButton disabled={pending} icon={Camera} label="拍摄封面" onPress={() => { void selectCover('camera'); }} secondary />
            <ReaderButton disabled={pending} icon={Upload} label="从相册选择" onPress={() => { void selectCover('library'); }} secondary />
            {draft.coverUri ? <ReaderButton disabled={pending} icon={X} label="移除封面" onPress={() => setDraft((value) => ({ ...value, coverUri: '' }))} secondary danger /> : null}
          </View>
        </View>
        <ReaderField label="书名" onChangeText={(title) => setDraft((value) => ({ ...value, title }))} value={draft.title} />
        <ReaderField label="作者" onChangeText={setAuthors} value={authors} />
        <FormDisclosure onPress={() => setDetailsOpen((value) => !value)} open={detailsOpen} summary={filledLabel([draft.publisher, draft.publishedAt, draft.isbn, pageCount, draft.summary])} title="书籍资料">
          <View style={styles.twoColumns}>
            <View style={styles.column}><ReaderField label="出版社" onChangeText={(publisher) => setDraft((value) => ({ ...value, publisher }))} value={draft.publisher} /></View>
            <View style={styles.column}><ReaderField label="出版日期" onChangeText={(publishedAt) => setDraft((value) => ({ ...value, publishedAt }))} placeholder="例如 2024-06" value={draft.publishedAt} /></View>
          </View>
          <ReaderField label="ISBN" onChangeText={(isbn) => setDraft((value) => ({ ...value, isbn }))} value={draft.isbn} />
          <ReaderField keyboardType="numeric" label="页数" onChangeText={setPageCount} placeholder="填写后按已读页数显示阅读进度" value={pageCount} />
          <ReaderField label="简介" multiline onChangeText={(summary) => setDraft((value) => ({ ...value, summary }))} value={draft.summary} />
        </FormDisclosure>
        <FormDisclosure onPress={() => setReadingOpen((value) => !value)} open={readingOpen} summary={[readerStatusLabel(draft.status), formProgress !== null ? `${formProgress}%` : ''].filter(Boolean).join(' · ')} title="阅读进度与备注">
          <ReaderField label="读书备注" multiline onChangeText={(note) => setDraft((value) => ({ ...value, note }))} value={draft.note} />
          <Text style={styles.formLabel}>阅读状态</Text>
          <View style={styles.chips}>{(['unread', 'reading', 'finished'] as const).map((status) => <ReaderChip key={status} label={readerStatusLabel(status)} onPress={() => setDraft((value) => ({ ...value, status }))} selected={draft.status === status} />)}</View>
          <ReaderField keyboardType="numeric" label="读到第几页" onChangeText={setPagesRead} placeholder="选填" value={pagesRead} />
        </FormDisclosure>
        <FormDisclosure onPress={() => setAssistantOpen((value) => !value)} open={assistantOpen} summary={draft.customPrompt.trim() ? '自定义阅读助手' : selectedRole?.name ?? '未设置'} title="阅读助手">
          <ReaderSettingsRow icon={UserRoundCog} onPress={() => { setRoleQuery(''); setRoleSheetOpen(true); }} title="阅读角色" value={selectedRole?.name ?? '未设置'} />
          <ReaderField
            label="自定义阅读助手"
            multiline
            onChangeText={(customPrompt) => setDraft((value) => ({ ...value, customPrompt }))}
            trailing={aiAvailable ? (
              generatingPrompt ? (
                <View style={styles.trailingSpinner}><ActivityIndicator color={palette.brand} size="small" /></View>
              ) : (
                <ReaderIconButton
                  active={false}
                  disabled={generatingPrompt}
                  icon={WandSparkles}
                  label="生成自定义阅读助手"
                  onPress={() => { void generatePrompt(); }}
                />
              )
            ) : null}
            value={draft.customPrompt}
          />
          {generatingPrompt ? (
            <Text style={styles.promptHint}>正在生成自定义阅读助手…</Text>
          ) : draft.customPrompt.trim() ? (
            <Pressable accessibilityRole="button" onPress={clearPrompt} style={styles.promptClear}>
              <Text style={styles.promptClearText}>清空，改用角色 Prompt</Text>
            </Pressable>
          ) : null}
        </FormDisclosure>
        {error ? <ReaderError message={error} onRetry={() => { void save(); }} /> : null}
      </ReaderScroll>
      <ImagePreview
        media={media}
        onApply={async (image) => {
          if (temporaryUri && temporaryUri !== image.uri) await media.deleteImage(temporaryUri);
          setTemporaryUri(image.uri);
          setDraft((value) => ({ ...value, coverUri: image.uri }));
        }}
        onClose={() => setCoverPreviewOpen(false)}
        purpose="cover"
        title={draft.title.trim() || '封面'}
        uri={draft.coverUri}
        visible={coverPreviewOpen && Boolean(draft.coverUri)}
      />
      <FormSheet onClose={() => setRoleSheetOpen(false)} title="选择阅读角色" visible={roleSheetOpen}>
        <ReaderSearch onChangeText={setRoleQuery} placeholder="搜索角色" value={roleQuery} />
        {filteredRoles.length ? filteredRoles.map((role) => <ReaderSettingsRow icon={UserRoundCog} key={role.id} onPress={() => { setDraft((value) => ({ ...value, roleId: role.id })); setRoleSheetOpen(false); }} title={role.name} value={role.description} />) : <ReaderEmpty detail="换个角色名称再试。" icon={UserRoundCog} title="没有找到角色" />}
      </FormSheet>
    </ReaderDetailPane>
  );
}

function FormDisclosure({ title, summary, open, onPress, children }: { title: string; summary: string; open: boolean; onPress: () => void; children: ReactNode }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.formSection}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress} style={({ pressed }) => [styles.formSectionHeader, pressed && styles.pressed]}>
        <View style={styles.formSectionCopy}>
          <Text style={styles.formSectionTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.formSectionSummary}>{summary}</Text>
        </View>
        <Icon color={palette.textMuted} size={20} />
      </Pressable>
      {open ? <View style={styles.formSectionBody}>{children}</View> : null}
    </View>
  );
}

function filledLabel(values: readonly string[]): string {
  const count = values.filter((value) => value.trim()).length;
  return count ? `${count} 项已填写` : '选填';
}

export function ReaderTrashScreen({ bookId, scope = 'all', books, passages, discussions, repository, media, wide, onBack, onOpenDiscussion, onError }: {
  bookId?: string;
  scope?: 'all' | 'discussions';
  books: readonly ReaderBook[];
  passages: readonly ReaderPassageIndex[];
  discussions: readonly ReaderDiscussion[];
  repository: ReaderTrashRepository;
  media: MediaLibrary;
  wide: boolean;
  onBack: () => void;
  onOpenDiscussion?: ((id: string) => void) | undefined;
  onError: (message: string) => void;
}) {
  const deletedBooks = scope === 'all' ? books.filter((item) => item.deletedAt !== null && (!bookId || item.id === bookId)) : [];
  const deletedPassages = scope === 'all' ? passages.filter((item) => item.deletedAt !== null && (!bookId || item.bookId === bookId)) : [];
  const deletedDiscussions = discussions.filter((item) => item.deletedAt !== null && (!bookId || item.bookId === bookId));
  const permanentBook = (book: ReaderBook) => Alert.alert('永久删除书籍？', '书籍、图片、摘录和讨论将无法恢复。', [{ text: '取消', style: 'cancel' }, { text: '永久删除', style: 'destructive', onPress: () => { void repository.deleteBookPermanently(book.id).then(async (uris) => { for (const uri of uris) await media.deleteImage(uri); }).catch((error: unknown) => onError(messageOf(error, '永久删除失败'))); } }]);
  const [emptying, setEmptying] = useState(false);
  const trashCount = deletedBooks.length + deletedPassages.length + deletedDiscussions.length;
  // Discussions and excerpts go before books, so a book's cascade never removes something still queued here.
  const emptyTrash = async () => {
    setEmptying(true);
    try {
      for (const discussion of deletedDiscussions) await repository.deleteDiscussionPermanently(discussion.id);
      for (const passage of deletedPassages) {
        const uri = await repository.deletePassagePermanently(passage.id);
        if (uri) await media.deleteImage(uri);
      }
      for (const book of deletedBooks) {
        for (const uri of await repository.deleteBookPermanently(book.id)) await media.deleteImage(uri);
      }
    } catch (error) {
      onError(messageOf(error, '清空回收站失败'));
    } finally {
      setEmptying(false);
    }
  };
  const confirmEmpty = () => Alert.alert(
    '清空回收站？',
    `${[deletedBooks.length ? `${deletedBooks.length} 本书` : '', deletedPassages.length ? `${deletedPassages.length} 条摘录` : '', deletedDiscussions.length ? `${deletedDiscussions.length} 个讨论` : ''].filter(Boolean).join('、')}将永久删除，无法恢复。`,
    [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: () => { void emptyTrash(); } }],
  );
  const permanentPassage = (passage: ReaderPassageIndex) => Alert.alert('永久删除摘录？', '原文、分析和本地图片将无法恢复。', [{ text: '取消', style: 'cancel' }, { text: '永久删除', style: 'destructive', onPress: () => { void repository.deletePassagePermanently(passage.id).then((uri) => uri ? media.deleteImage(uri) : undefined).catch((error: unknown) => onError(messageOf(error, '永久删除失败'))); } }]);
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader action={trashCount ? <ReaderIconButton danger disabled={emptying} icon={Trash2} label="清空回收站" onPress={confirmEmpty} /> : undefined} height={READER_PRIMARY_HEADER_HEIGHT} onBack={onBack} subtitle={bookId ? '这本书中已删除的内容' : scope === 'discussions' ? '恢复或永久删除讨论' : '恢复或永久删除本地内容'} title={bookId ? '本书回收站' : scope === 'discussions' ? '讨论回收站' : '回收站'} />
      <ReaderScroll>
        {deletedBooks.length ? <ReaderSectionHeader title="书籍" value={String(deletedBooks.length)} /> : null}
        {deletedBooks.map((book) => <TrashRow key={book.id} title={book.title} subtitle={readerPrimaryAuthor(book.authors)} onRestore={() => { void repository.restoreBook(book.id); }} onDelete={() => permanentBook(book)} />)}
        {deletedPassages.length ? <ReaderSectionHeader title="摘录" value={String(deletedPassages.length)} /> : null}
        {deletedPassages.map((passage) => <TrashRow key={passage.id} title={passageDisplayTitle(passage.title, passage.pageLabel, passage.sourcePreview)} subtitle={passage.sourcePreview.slice(0, 80)} onRestore={() => { void repository.restorePassage(passage.id); }} onDelete={() => permanentPassage(passage)} />)}
        {deletedDiscussions.length ? <ReaderSectionHeader title="讨论" value={String(deletedDiscussions.length)} /> : null}
        {deletedDiscussions.map((discussion) => <TrashRow key={discussion.id} title={discussion.title} subtitle="已移入回收站" {...(onOpenDiscussion ? { onOpen: () => onOpenDiscussion(discussion.id) } : {})} onRestore={() => { void repository.restoreDiscussion(discussion.id); }} onDelete={() => Alert.alert('永久删除讨论？', '问题、回答和收藏状态将无法恢复。', [{ text: '取消', style: 'cancel' }, { text: '永久删除', style: 'destructive', onPress: () => { void repository.deleteDiscussionPermanently(discussion.id).catch((error: unknown) => onError(messageOf(error, '永久删除失败'))); } }])} />)}
        {!deletedBooks.length && !deletedPassages.length && !deletedDiscussions.length ? <ReaderEmpty detail="移到回收站的书籍、摘录和讨论会显示在这里。" icon={Trash2} title="回收站是空的" /> : null}
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

function TrashRow({ title, subtitle, onRestore, onDelete, onOpen }: { title: string; subtitle: string; onRestore: () => void; onDelete: () => void; onOpen?: (() => void) | undefined }) {
  const styles = useStyles();
  return (
    <View style={styles.trashRow}>
      <Pressable disabled={!onOpen} onPress={onOpen} style={styles.trashCopy}>
        <Text numberOfLines={1} style={styles.trashTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.trashSubtitle}>{subtitle}</Text>
      </Pressable>
      <ReaderIconButton icon={RotateCcw} label="恢复" onPress={onRestore} />
      <ReaderIconButton danger icon={Trash2} label="永久删除" onPress={onDelete} />
    </View>
  );
}

function ReaderBookActionMenu({ items, onClose, visible }: { items: readonly ActionMenuItem[]; onClose: () => void; visible: boolean }) {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const styles = useStyles();
  const menuWidth = Math.min(180, Math.max(minimumTouchTarget, width - spacing.lg * 2));
  const top = insets.top + READER_PRIMARY_HEADER_HEIGHT + spacing.xs;
  const bottom = height - insets.bottom - spacing.lg;
  const maxHeight = Math.max(minimumTouchTarget, bottom - top);
  const left = Math.max(spacing.lg, width - spacing.lg - menuWidth);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.bookMenuOverlay}>
        <Pressable accessibilityLabel="关闭书籍菜单" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.bookMenuPanel, { left, maxHeight, top, width: menuWidth }]}>
          <ScrollView accessibilityViewIsModal bounces={false} showsVerticalScrollIndicator={false}>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityState={{ disabled: Boolean(item.disabled) }}
                  disabled={item.disabled}
                  key={item.key}
                  onPress={() => { onClose(); item.onPress(); }}
                  style={({ pressed }) => [styles.bookMenuItem, item.disabled && styles.bookMenuDisabled, pressed && styles.pressed]}
                >
                  <Icon color={item.danger ? palette.danger : palette.textMuted} size={20} />
                  <Text style={[styles.bookMenuLabel, item.danger && styles.bookMenuLabelDanger]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BookCover({ book, size }: { book: ReaderBook; size: 'row' | 'hero' }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sizeStyle = size === 'hero' ? styles.coverHero : styles.coverRow;
  if (book.coverUri && failedUri !== book.coverUri) return <Image accessibilityLabel={`${book.title}封面`} onError={() => setFailedUri(book.coverUri)} resizeMode="cover" source={{ uri: book.coverUri }} style={[styles.cover, sizeStyle]} />;
  return <View style={[styles.cover, styles.coverPlaceholder, sizeStyle]}><BookOpen color={palette.brand} size={size === 'hero' ? 32 : 22}  strokeWidth={iconography.stroke} /></View>;
}

function ProgressBar({ progress, prominent = false }: { progress: number; prominent?: boolean }) {
  const styles = useStyles();
  return <View style={[styles.progressTrack, prominent && styles.progressProminent]}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} /></View>;
}

function blankBook(roleId = 'reader-role-general'): ReaderBookDraft {
  return { title: '', authors: [], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '', note: '', status: 'unread', progress: 0, pageCount: 0, pagesRead: 0, roleId, customPrompt: '' };
}

function clockOf(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function bookDraftOf(book: ReaderBook): ReaderBookDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...draft } = book;
  return draft;
}

function statusColor(status: ReaderBook['status'], palette: Palette): string {
  if (status === 'finished') return palette.success;
  if (status === 'reading') return palette.brand;
  return palette.textMuted;
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function useStyles() {
  return useThemedStyles(createStyles);
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    fill: { flex: 1 },
    headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, height: READER_PRIMARY_ACTION_HEIGHT },
    primaryAction: { height: READER_PRIMARY_ACTION_HEIGHT },
    list: { paddingBottom: spacing.xxl },
    bookRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 112, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    bookRowTiming: { backgroundColor: palette.primarySoft },
    timerPill: { alignItems: 'center', backgroundColor: palette.brand, borderRadius: radius.control, flexDirection: 'row', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 1 },
    timerPillText: { color: palette.onPrimary, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '700' },
    cover: { backgroundColor: palette.surfaceMuted, borderRadius: 4, overflow: 'hidden' },
    coverRow: { height: 88, width: 64 },
    coverHero: { height: 108, width: 80 },
    coverPlaceholder: { alignItems: 'center', borderWidth: 1, justifyContent: 'center' },
    bookCopy: { flex: 1, minWidth: 0 },
    bookTitle: { color: palette.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
    bookAuthor: { color: palette.textMuted, fontSize: 13, marginTop: spacing.xs },
    bookMetaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    bookStatus: { fontSize: 12, fontWeight: '700' },
    bookMeta: { color: palette.textMuted, fontSize: 12 },
    progressTrack: { backgroundColor: palette.surfaceMuted, borderRadius: 2, height: 3, marginTop: spacing.xs, overflow: 'hidden' },
    progressProminent: { height: 5, marginTop: spacing.sm },
    progressFill: { backgroundColor: palette.brand, height: '100%' },
    bookDetailContent: { flexGrow: 1, paddingBottom: spacing.xxl },
    hero: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.lg, padding: spacing.lg },
    heroCopy: { flex: 1, minWidth: 0, paddingTop: spacing.xs },
    heroTitle: { color: palette.text, fontSize: 24, fontWeight: '700', lineHeight: 30 },
    heroAuthorRow: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: 2, marginTop: spacing.xs, minHeight: 32 },
    heroAuthor: { color: palette.textMuted, flexShrink: 1, fontSize: 14, lineHeight: 20 },
    heroAuthorMeasure: { left: 0, opacity: 0, position: 'absolute', right: HERO_AUTHOR_CHEVRON + 2, top: 0 },
    heroMeta: { color: palette.textSubtle, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
    progressEditor: { alignSelf: 'stretch', borderRadius: 6, marginTop: spacing.xs, paddingVertical: spacing.xs },
    progressHint: { color: palette.textSubtle, fontSize: 11, marginTop: spacing.xs },
    sessionWarning: { backgroundColor: palette.surfaceMuted, borderRadius: radius.control, gap: spacing.xs, marginBottom: spacing.sm, padding: spacing.md },
    sessionWarningTitle: { color: palette.warning, fontSize: 14, fontWeight: '700' },
    sessionFields: { flexDirection: 'row', gap: spacing.md },
    sessionField: { flex: 1 },
    sessionWarningText: { color: palette.text, fontSize: 13, lineHeight: 19 },
    readingSummaryLink: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 2, marginTop: spacing.sm, minHeight: 24 },
    readingSummaryText: { color: palette.brand, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '700' },
    readingTimer: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.card, gap: 2, minWidth: 64, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    readingTimerActive: { backgroundColor: palette.brand },
    readingTimerValue: { color: palette.brand, fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '700', marginTop: 2 },
    readingTimerValueActive: { color: palette.onPrimary },
    readingTimerCaption: { color: palette.textMuted, fontSize: 10 },
    readingTimerCaptionActive: { color: palette.onPrimary, opacity: 0.8 },
    summaryBlock: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    bookSummary: { color: palette.textMuted, fontSize: 14, lineHeight: 21 },
    summaryToggle: { alignSelf: 'flex-start', minHeight: 32, paddingTop: spacing.xs },
    bookNote: { borderTopColor: palette.border, borderTopWidth: 1, marginTop: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    bookNoteLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs },
    noteText: { color: palette.text, fontSize: 14, lineHeight: 22 },
    noteToggle: { color: palette.brand, fontSize: 12, fontWeight: '700', marginTop: spacing.xs },
    stickyTabs: { backgroundColor: palette.canvas, elevation: 2, zIndex: 2 },
    tabContent: { flexGrow: 1, minHeight: 320 },
    form: { gap: spacing.lg, padding: spacing.lg },
    formSection: { borderBottomColor: palette.border, borderBottomWidth: 1, borderTopColor: palette.border, borderTopWidth: 1 },
    formSectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm },
    formSectionCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    formSectionTitle: { color: palette.text, fontSize: 16, fontWeight: '700' },
    formSectionSummary: { color: palette.textMuted, fontSize: 12 },
    formSectionBody: { gap: spacing.lg, paddingBottom: spacing.md },
    coverEditor: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
    coverImageButton: { borderRadius: 4 },
    coverEditorImage: { borderRadius: 4, height: 112, width: 82 },
    coverEditorEmpty: { alignItems: 'center', backgroundColor: palette.surfaceMuted, borderColor: palette.border, borderRadius: 4, borderWidth: 1, height: 112, justifyContent: 'center', width: 82 },
    coverActions: { alignItems: 'stretch', gap: spacing.sm },
    twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    column: { flex: 1, minWidth: 180 },
    formLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    trailingSpinner: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
    promptHint: { color: palette.textSubtle, fontSize: 12, marginTop: spacing.xs },
    promptClear: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', minHeight: 32, paddingVertical: spacing.xs },
    promptClearText: { color: palette.textSubtle, fontSize: 13 },
    bookMenuOverlay: { backgroundColor: palette.overlay, flex: 1 },
    bookMenuPanel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden', paddingVertical: spacing.xs, position: 'absolute' },
    bookMenuItem: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: minimumTouchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    bookMenuLabel: { ...typography.body, color: palette.text, flex: 1 },
    bookMenuLabelDanger: { color: palette.danger },
    bookMenuDisabled: { opacity: interaction.disabledOpacity },
    trashRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.xs, minHeight: 72, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    trashCopy: { flex: 1, minWidth: 0 },
    trashTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
    trashSubtitle: { color: palette.textMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
    pressed: { opacity: 0.66 },
  });
}
