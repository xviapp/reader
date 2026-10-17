import * as Clipboard from 'expo-clipboard';
import { useIsFocused } from 'expo-router';
import {
  Bookmark,
  BookmarkCheck,
  BookmarkX,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Filter,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Share2,
  Square,
  Trash2,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/core/design/theme';
import { iconography, interaction, minimumTouchTarget, radius, spacing, typography, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { useReaderRuntime } from '@/core/runtime/reader-runtime';
import { AiActivityDots, UnreadDot } from '@/core/ui/ai-activity';
import { conversationMessageCanCollapse } from '@/core/ui/conversation-message-presentation-core';
import { ensureReadingProgressBaseline, useConversationUnread } from '@/core/ui/conversation-progress';
import { ConversationAnchor, ConversationViewport } from '@/core/ui/conversation-viewport';
import { FocusedReadingContent, useFocusedReadingPreferences } from '@/core/ui/focused-reading';
import { ActionMenu, type ActionMenuItem } from '@/core/ui/action-menu';
import { FormSheet } from '@/core/ui/app-controls';

import type { ReaderAiCoordinator } from '../application/reader-ai';
import { readerAnswerShare } from '../application/reader-share';
import { shareReaderText } from '../application/reader-share-native';
import { useReaderShare } from './use-reader-share';
import type { ReaderDiscussionRepository } from '../application/ports';
import type {
  ReaderBook,
  ReaderDiscussion,
  ReaderMessage,
  ReaderPassage,
  ReaderPassageIndex,
  ReaderPrompt,
  ReaderRole,
} from '../domain/model';
import { passageDisplayTitle, readerDiscussionPassageIds, readerPrimaryAuthor } from '../domain/rules';
import {
  EMPTY_READER_DISCUSSION_COMPOSER,
  resolveReaderComposerIntent,
  type ReaderComposerIntent,
  type ReaderComposerIntentResolution,
} from './discussion-flow';
import {
  ReaderButton,
  ReaderChip,
  ReaderDetailPane,
  ReaderEmpty,
  ReaderError,
  ReaderField,
  ReaderHeader,
  ReaderIconButton,
  ReaderMarkdown,
  ReaderScroll,
  ReaderSearch,
  ReaderSettingsRow,
  ReaderSkeletonRows,
  READER_PRIMARY_ACTION_HEIGHT,
  READER_PRIMARY_HEADER_HEIGHT,
} from './reader-ui';
import { useReaderDraftGuard } from './reader-draft-guard';

interface NewDiscussionState {
  bookId: string | null;
  passageId: string | null;
  passageIds: readonly string[];
  title: string;
  question: string;
}

interface ReaderMessageMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const UNLINKED_BOOK_FILTER = '__unlinked__';

export function ReaderDiscussionsScreen({
  discussions,
  books,
  loading,
  error,
  query,
  bookFilterId,
  onQueryChange,
  onBookFilterChange,
  onExit,
  onAdd,
  onOpen,
  onFavorites,
  onTrash,
  onRetry,
}: {
  discussions: readonly ReaderDiscussion[];
  books: readonly ReaderBook[];
  loading: boolean;
  error: string | null;
  query: string;
  bookFilterId: string | null;
  onQueryChange: (value: string) => void;
  onBookFilterChange: (value: string | null) => void;
  onExit?: (() => void) | undefined;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onFavorites: () => void;
  onTrash: () => void;
  onRetry: () => void;
}) {
  const styles = useStyles();
  const [bookFilterOpen, setBookFilterOpen] = useState(false);
  const [bookFilterQuery, setBookFilterQuery] = useState('');
  const active = discussions.filter((item) => item.deletedAt === null);
  const normalized = query.trim().toLowerCase();
  const selectedBook = bookFilterId && bookFilterId !== UNLINKED_BOOK_FILTER
    ? books.find((item) => item.id === bookFilterId && item.deletedAt === null) ?? null
    : null;
  const bookFilterLabel = bookFilterId === UNLINKED_BOOK_FILTER ? '无关联书籍' : selectedBook?.title ?? '筛选书籍';
  const filteredBooks = books
    .filter((item) => item.deletedAt === null)
    .filter((item) => !bookFilterQuery.trim() || `${item.title}\n${readerPrimaryAuthor(item.authors)}`.toLocaleLowerCase('zh-CN').includes(bookFilterQuery.trim().toLocaleLowerCase('zh-CN')));
  const filtered = active.filter((item) => {
    if (bookFilterId === UNLINKED_BOOK_FILTER && item.bookId !== null) return false;
    if (bookFilterId && bookFilterId !== UNLINKED_BOOK_FILTER && item.bookId !== bookFilterId) return false;
    const book = books.find((candidate) => candidate.id === item.bookId);
    return !normalized || `${item.title}\n${item.lastMessagePreview}\n${book?.title ?? ''}`.toLowerCase().includes(normalized);
  });
  const chooseBookFilter = (value: string | null) => {
    onBookFilterChange(value);
    setBookFilterQuery('');
    setBookFilterOpen(false);
  };
  const closeBookFilter = () => {
    setBookFilterQuery('');
    setBookFilterOpen(false);
  };
  return (
    <View style={styles.fill}>
      <ReaderHeader
        action={<View style={styles.headerActions}>
          <ReaderIconButton icon={Bookmark} label="收藏" onPress={onFavorites} />
          <ReaderIconButton icon={Trash2} label="回收站" onPress={onTrash} />
          <ReaderIconButton active icon={Plus} label="新建讨论" onPress={onAdd} />
        </View>}
        height={READER_PRIMARY_HEADER_HEIGHT}
        onBack={onExit}
        subtitle={loading ? '正在读取讨论' : `${active.length} 个讨论`}
        title="讨论"
      />
      <View style={styles.searchRow}>
        <ReaderSearch onChangeText={onQueryChange} placeholder="搜索标题、最近消息或书名" style={styles.searchInline} value={query} />
        <ReaderIconButton active={bookFilterId !== null} icon={Filter} label={`筛选书籍${bookFilterId !== null ? `：${bookFilterLabel}` : ''}`} onPress={() => { setBookFilterQuery(''); setBookFilterOpen(true); }} />
      </View>
      {error ? <ReaderError message={error} onRetry={onRetry} /> : null}
      {loading ? <ReaderSkeletonRows /> : filtered.length ? (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {filtered.map((discussion) => (
            <ReaderDiscussionRow
              book={books.find((book) => book.id === discussion.bookId) ?? null}
              discussion={discussion}
              key={discussion.id}
              onPress={() => onOpen(discussion.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <ReaderEmpty
          action={!normalized && bookFilterId === null ? <View style={styles.primaryAction}><ReaderButton icon={Plus} label="开始讨论" onPress={onAdd} /></View> : undefined}
          detail={normalized || bookFilterId !== null ? '调整搜索词或书籍筛选后再试。' : '可以围绕一本书、一条摘录，或一个独立问题开始。'}
          icon={MessageCircle}
          title={normalized || bookFilterId !== null ? '没有匹配的讨论' : '提出第一个问题'}
        />
      )}
      <FormSheet onClose={closeBookFilter} subtitle="查看一本书的讨论，也可以查看无关联书籍的问题。" title="按书筛选" visible={bookFilterOpen}>
        <ReaderSearch onChangeText={setBookFilterQuery} placeholder="搜索书名或作者" value={bookFilterQuery} />
        <View style={styles.filterChoices}>
          <ReaderChip label="全部讨论" onPress={() => chooseBookFilter(null)} selected={bookFilterId === null} />
          <ReaderChip label="无关联书籍" onPress={() => chooseBookFilter(UNLINKED_BOOK_FILTER)} selected={bookFilterId === UNLINKED_BOOK_FILTER} />
        </View>
        {filteredBooks.length ? filteredBooks.map((book) => (
          <ReaderSettingsRow
            icon={bookFilterId === book.id ? Check : BookOpen}
            key={book.id}
            onPress={() => chooseBookFilter(book.id)}
            title={book.title}
            value={readerPrimaryAuthor(book.authors)}
          />
        )) : <ReaderEmpty detail="换个书名或作者再试。" icon={BookOpen} title="没有找到书籍" />}
      </FormSheet>
    </View>
  );
}

export function ReaderDiscussionRow({ discussion, book, contextLabel, onPress, onLongPress }: { discussion: ReaderDiscussion; book: ReaderBook | null; contextLabel?: string | null; onPress: () => void; onLongPress?: () => void }) {
  const runtime = useReaderRuntime();
  const { palette } = useAppTheme();
  const styles = useStyles();
  const generating = discussion.lastMessageStatus === 'pending';
  const unread = useConversationUnread(runtime.workspaceId, `reader:${discussion.id}`, discussion.latestAssistantMessageId ?? null);
  return (
    <Pressable
      {...(onLongPress ? { accessibilityActions: [{ name: 'longpress', label: '更多讨论操作' }], delayLongPress: 450, onLongPress } : {})}
      accessibilityLabel={`打开讨论：${discussion.title}`}
      accessibilityRole="button"
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') onLongPress?.(); }}
      onPress={onPress}
      style={({ pressed }) => [styles.discussionRow, pressed && styles.pressed]}
    >
      <View style={[styles.discussionIcon, unread && !generating && styles.discussionIconUnread]}>
        <MessageCircle color={unread && !generating ? palette.brand : palette.textMuted} size={21}  strokeWidth={iconography.stroke} />
      </View>
      <View style={styles.discussionCopy}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={[styles.discussionTitle, unread && !generating && styles.unreadTitle]}>{discussion.title}</Text>
          {generating ? <AiActivityDots compact /> : unread ? <UnreadDot /> : null}
        </View>
        <Text numberOfLines={2} style={styles.discussionPreview}>{discussion.lastMessagePreview || '尚无回答'}</Text>
        <Text numberOfLines={1} style={styles.discussionMeta}>
          {[contextLabel ?? (readerDiscussionPassageIds(discussion).length > 1 ? `已关联 ${readerDiscussionPassageIds(discussion).length} 条摘录` : book?.title), messageStatusLabel(discussion.lastMessageStatus), relativeDate(discussion.lastMessageAt)].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

export function ReaderNewDiscussionScreen({
  initialBook,
  initialPassage,
  initialQuestion,
  books,
  passages,
  roles,
  prompt,
  ai,
  aiAvailable,
  wide,
  onBack,
  onCreated,
  onConfigureAi,
}: {
  initialBook: ReaderBook | null;
  initialPassage: ReaderPassageIndex | null;
  initialQuestion: string;
  books: readonly ReaderBook[];
  passages: readonly ReaderPassageIndex[];
  roles: readonly ReaderRole[];
  prompt: ReaderPrompt | null;
  ai: ReaderAiCoordinator | null;
  aiAvailable: boolean;
  wide: boolean;
  onBack: () => void;
  onCreated: (id: string) => void;
  onConfigureAi?: () => void;
}) {
  const styles = useStyles();
  const [draft, setDraftValue] = useState<NewDiscussionState>(() => ({
    bookId: initialBook?.id ?? initialPassage?.bookId ?? null,
    passageId: initialPassage?.id ?? null,
    passageIds: initialPassage?.id ? [initialPassage.id] : [],
    title: '',
    question: initialQuestion,
  }));
  const [dirty, setDirty] = useState(false);
  const { bookId, passageId, passageIds, title, question } = draft;
  const updateDraft = useCallback((patch: Partial<NewDiscussionState>) => {
    setDirty(true);
    setDraftValue((current) => ({ ...current, ...patch }));
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sourceSheet, setSourceSheet] = useState<'book' | 'passage' | null>(null);
  const [bookQuery, setBookQuery] = useState('');
  const [passageQuery, setPassageQuery] = useState('');
  const close = () => onBack();
  const book = books.find((item) => item.id === bookId) ?? null;
  const selectedPassages = passages.filter((item) => passageIds.includes(item.id));
  const passage = selectedPassages[0] ?? passages.find((item) => item.id === passageId) ?? null;
  const role = roles.find((item) => item.id === book?.roleId) ?? null;
  const filteredBooks = books
    .filter((item) => item.deletedAt === null)
    .filter((item) => !bookQuery.trim() || `${item.title}\n${readerPrimaryAuthor(item.authors)}`.toLocaleLowerCase('zh-CN').includes(bookQuery.trim().toLocaleLowerCase('zh-CN')));
  const bookPassages = passages
    .filter((item) => item.bookId === bookId && item.deletedAt === null)
    .filter((item) => !passageQuery.trim() || passageDisplayTitle(item.title, item.pageLabel, item.sourcePreview).toLocaleLowerCase('zh-CN').includes(passageQuery.trim().toLocaleLowerCase('zh-CN')));
  const chooseBook = (nextBookId: string | null) => {
    updateDraft({ bookId: nextBookId, passageId: null, passageIds: [] });
    setBookQuery('');
    setPassageQuery('');
    setSourceSheet(null);
  };
  const choosePassage = (nextPassageId: string | null) => {
    updateDraft({ passageId: nextPassageId, passageIds: nextPassageId ? [nextPassageId] : [] });
    setPassageQuery('');
    setSourceSheet(null);
  };
  const togglePassage = (nextPassageId: string) => {
    const next = passageIds.includes(nextPassageId)
      ? passageIds.filter((id) => id !== nextPassageId)
      : [...passageIds, nextPassageId].slice(0, 5);
    updateDraft({ passageIds: next, passageId: next[0] ?? null });
  };
  const create = async () => {
    if (!ai || !prompt || !aiAvailable) return;
    setPending(true); setError(null);
    try {
      const id = await ai.createDiscussion(
        { title, bookId, passageId, passageIds, folderId: null, openingMessage: question },
        { book, role },
        prompt,
      );
      onCreated(id);
    } catch (cause) { setError(messageOf(cause, '创建讨论失败')); }
    finally { setPending(false); }
  };
  const canCreate = Boolean(ai && prompt && aiAvailable);
  const requestClose = useReaderDraftGuard({
    dirty: dirty && Boolean(question.trim() || title.trim() || bookId || passageId),
    noun: '讨论草稿',
    onBack: close,
    pending,
  });
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader onBack={requestClose} title="新建讨论" />
      {error ? <ReaderError message={error} onRetry={() => { void create(); }} /> : null}
      <ReaderScroll style={styles.form}>
        {!canCreate ? (
          <View style={styles.aiNotice}>
            <Text style={styles.aiNoticeText}>{!aiAvailable ? '配置 AI 后才能开始讨论。' : '阅读助手还没准备好。'}</Text>
            {onConfigureAi ? <ReaderButton icon={Settings} label="配置 AI" onPress={onConfigureAi} secondary /> : null}
          </View>
        ) : null}
        <ReaderField label="想讨论的问题" multiline onChangeText={(value) => updateDraft({ question: value })} placeholder="你想弄清什么？" value={question} />
        <Text style={styles.formLabel}>讨论范围</Text>
        <ReaderSettingsRow
          icon={BookOpen}
          onPress={() => { setBookQuery(''); setSourceSheet('book'); }}
          title={book?.title ?? '独立问题'}
          value={passage ? passageDisplayTitle(passage.title, passage.pageLabel, passage.sourcePreview) : book ? '不选摘录' : '不关联书籍'}
        />
        <Text style={styles.contextHint}>{discussionContextLabel(book, selectedPassages, prompt)}</Text>
        {book ? <ReaderSettingsRow
          icon={FileText}
          onPress={() => { setPassageQuery(''); setSourceSheet('passage'); }}
          title={selectedPassages.length > 1 ? `已关联 ${selectedPassages.length} 条摘录` : passage ? passageDisplayTitle(passage.title, passage.pageLabel, passage.sourcePreview) : '未选摘录'}
          value={selectedPassages.length ? '管理关联摘录' : '最多选择 5 条'}
        /> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((value) => !value)} style={({ pressed }) => [styles.detailToggle, pressed && styles.pressed]}>
          <Text style={styles.detailToggleText}>更多设置</Text>
          {detailsOpen ? <ChevronUp color={styles.detailToggleText.color} size={18}  strokeWidth={iconography.stroke} /> : <ChevronDown color={styles.detailToggleText.color} size={18}  strokeWidth={iconography.stroke} />}
        </Pressable>
        {detailsOpen ? (
          <>
            <ReaderField label="讨论标题（可选）" onChangeText={(value) => updateDraft({ title: value })} placeholder="留空则根据问题生成" value={title} />
          </>
        ) : null}
        <ReaderButton disabled={pending || !question.trim() || !canCreate} icon={MessageCircle} label={pending ? '正在创建' : '开始讨论'} onPress={() => { void create(); }} />
      </ReaderScroll>
      <FormSheet onClose={() => setSourceSheet(null)} title="选择关联书籍" visible={sourceSheet === 'book'}>
        <ReaderSearch onChangeText={setBookQuery} placeholder="搜索书名或作者" value={bookQuery} />
        <ReaderButton icon={X} label="独立问题" onPress={() => chooseBook(null)} secondary />
        {filteredBooks.length ? filteredBooks.map((item) => <ReaderSettingsRow icon={BookOpen} key={item.id} onPress={() => chooseBook(item.id)} title={item.title} value={readerPrimaryAuthor(item.authors)} />) : <ReaderEmpty detail="换个书名或作者再试。" icon={BookOpen} title="没有找到书籍" />}
      </FormSheet>
      <FormSheet onClose={() => setSourceSheet(null)} title="选择关联摘录" visible={sourceSheet === 'passage'}>
        <ReaderSearch onChangeText={setPassageQuery} placeholder="搜索摘录标题或原文" value={passageQuery} />
        <ReaderButton icon={BookOpen} label="不选摘录" onPress={() => choosePassage(null)} secondary />
        {bookPassages.length ? bookPassages.map((item) => {
          const selected = passageIds.includes(item.id);
          return <ReaderSettingsRow icon={selected ? Check : FileText} key={item.id} onPress={() => togglePassage(item.id)} title={passageDisplayTitle(item.title, item.pageLabel, item.sourcePreview)} value={selected ? '已选择' : item.sourcePreview.slice(0, 60)} />;
        }) : <ReaderEmpty detail="这本书还没有可关联的摘录。" icon={FileText} title="没有找到摘录" />}
        {bookPassages.length ? <ReaderButton icon={Check} label={`完成选择（${passageIds.length}/5）`} onPress={() => { setPassageQuery(''); setSourceSheet(null); }} /> : null}
      </FormSheet>
    </ReaderDetailPane>
  );
}

export function ReaderDiscussionScreen({
  discussion,
  messages,
  messagesError,
  messagesLoading,
  book,
  passage,
  passages,
  role,
  prompt,
  ai,
  repository,
  composerIntent,
  focusMessageId,
  linkedPassageState,
  wide,
  onBack,
  onComposerIntentConsumed,
  onFocus,
  onOpenPassage,
  onRetryMessages,
  onTrash,
}: {
  discussion: ReaderDiscussion;
  messages: readonly ReaderMessage[];
  messagesError: string | null;
  messagesLoading: boolean;
  book: ReaderBook | null;
  passage: ReaderPassage | null;
  passages?: readonly ReaderPassage[];
  role: ReaderRole | null;
  prompt: ReaderPrompt | null;
  ai: ReaderAiCoordinator | null;
  repository: ReaderDiscussionRepository;
  composerIntent: ReaderComposerIntent | null;
  focusMessageId: string | null;
  linkedPassageState: 'none' | 'active' | 'trashed';
  wide: boolean;
  onBack: () => void;
  onComposerIntentConsumed: () => void;
  onFocus: (messageId: string) => void;
  onOpenPassage: (() => void) | null;
  onRetryMessages: () => void;
  onTrash: () => void;
}) {
  const runtime = useReaderRuntime();
  const styles = useStyles();
  const active = useIsFocused();
  const [composerValue, setComposer] = useState(EMPTY_READER_DISCUSSION_COMPOSER);
  const clearComposer = useCallback(() => setComposer(EMPTY_READER_DISCUSSION_COMPOSER), []);
  const input = composerValue.text;
  const setInput = (text: string) => setComposer((current) => ({ ...current, text }));
  const handledIntentId = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRetry, setErrorRetry] = useState<'send' | null>(null);
  const sharing = useReaderShare((value) => { setErrorRetry(null); setError(value); });
  const [sending, setSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [messageMenu, setMessageMenu] = useState<ReaderMessage | null>(null);
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<ReaderMessageMenuAnchor | null>(null);
  const [followLatestToken, setFollowLatestToken] = useState(0);
  const discussionPassages = passages?.length ? passages : passage ? [passage] : [];
  useEffect(() => {
    if (!active || !composerIntent) return;
    if (composerValue.consumedIntentId === composerIntent.id) {
      if (handledIntentId.current !== composerIntent.id) {
        handledIntentId.current = composerIntent.id;
        onComposerIntentConsumed();
      }
      return;
    }
    if (handledIntentId.current === composerIntent.id) return;
    handledIntentId.current = composerIntent.id;
    let consumed = false;
    const finish = (resolution: ReaderComposerIntentResolution) => {
      if (consumed) return;
      consumed = true;
      setComposer((current) => resolveReaderComposerIntent(current, composerIntent, resolution));
      onComposerIntentConsumed();
    };
    if (!composerValue.text.trim()) {
      finish('replace');
      return;
    }
    Alert.alert('这个讨论已有草稿', '选择如何处理准备追加的问题。', [
      { text: '取消', style: 'cancel', onPress: () => finish('cancel') },
      { text: '替换草稿', style: 'destructive', onPress: () => finish('replace') },
      { text: '追加到草稿', onPress: () => finish('append') },
    ], { cancelable: true, onDismiss: () => finish('cancel') });
  }, [active, composerIntent, composerValue.consumedIntentId, composerValue.text, onComposerIntentConsumed]);
  const send = async () => {
    if (!ai || !prompt || !input.trim()) return;
    const value = input;
    setFollowLatestToken((current) => current + 1);
    let userMessageSaved = false;
    setSending(true); setError(null); setErrorRetry(null);
    try {
      await ensureReadingProgressBaseline(runtime.workspaceId, `reader:${discussion.id}`, latestReadableMessageId).catch(() => undefined);
      await ai.sendFollowUp(discussion, value, { book, passage: discussionPassages[0] ?? null, passages: discussionPassages, role }, prompt, messages, {
        onUserMessageSaved: () => {
          userMessageSaved = true;
          void clearComposer();
        },
      });
    } catch (cause) {
      setError(messageOf(cause, '回答失败'));
      if (!userMessageSaved) setErrorRetry('send');
    }
    finally { setSending(false); }
  };
  const pending = retryingMessageId !== null || messages.some((message) => message.status === 'pending');
  const requestClose = useReaderDraftGuard({
    dirty: Boolean(input.trim()),
    onBack,
  });
  const latestReadableMessageId = [...messages].reverse().find((message) => (
    message.role === 'assistant' && message.status === 'completed'
  ))?.id ?? null;
  const requestDelete = (message: ReaderMessage) => {
    const index = messages.findIndex((item) => item.id === message.id);
    const question = message.role === 'user' ? message : previousUser(messages, index);
    const answer = message.role === 'assistant' ? message : nextAssistant(messages, index);
    if (!question) return;
    Alert.alert('删除这组问答？', '问题和对应回答会一起从当前讨论移除。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { void repository.deleteMessagePair(question.id, answer?.id ?? null).catch((cause: unknown) => { setErrorRetry(null); setError(messageOf(cause, '删除消息失败')); }); } },
    ]);
  };
  const messageMenuItems = messageMenu ? [
    ...(messageMenu.role === 'assistant' ? [
      { key: 'favorite', label: messageMenu.favorite ? '取消收藏' : '收藏回答', icon: messageMenu.favorite ? BookmarkCheck : Bookmark, onPress: () => { void repository.setMessageFavorite(messageMenu.id, !messageMenu.favorite).catch((cause: unknown) => { setErrorRetry(null); setError(messageOf(cause, '更新收藏失败')); }); } },
      ...(messageMenu.status === 'completed' ? [{ key: 'focus', label: '专注阅读', icon: BookOpen, onPress: () => onFocus(messageMenu.id) }] : []),
      ...(messageMenu.status === 'completed' && messageMenu.content.trim() ? [{ key: 'share', label: '分享回答', icon: Share2, disabled: sharing.pending, onPress: () => {
        const answer = messageMenu;
        sharing.run(() => shareReaderText(readerAnswerShare(answer, discussion, book)));
      } }] : []),
    ] : []),
    { key: 'delete', label: '删除问答', icon: Trash2, danger: true, onPress: () => requestDelete(messageMenu) },
  ] : [];
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader
        action={<ReaderIconButton icon={MoreHorizontal} label="讨论操作" onPress={() => setMenuOpen((value) => !value)} />}
        onBack={!wide ? requestClose : undefined}
        title={discussion.title}
      />
      <ActionMenu
        items={[
          ...(linkedPassageState === 'active' && onOpenPassage
            ? [{ key: 'passage', label: '查看关联摘录', icon: FileText, onPress: onOpenPassage }]
            : linkedPassageState === 'trashed'
              ? [{ key: 'passage-trashed', label: '关联摘录在回收站', icon: FileText, disabled: true, onPress: () => undefined }]
              : []),
          { key: 'trash', label: '移到回收站', icon: Trash2, danger: true, onPress: onTrash },
        ]}
        onClose={() => setMenuOpen(false)}
        visible={menuOpen}
      />
      {error ? <ReaderError message={error} onRetry={errorRetry === 'send' ? () => { void send(); } : () => setError(null)} retryLabel={errorRetry === 'send' ? '重新发送' : '关闭'} /> : null}
      {messagesError ? <ReaderError message={messagesError} onRetry={onRetryMessages} /> : messagesLoading ? <ReaderSkeletonRows /> : (
        <ConversationViewport
          active={active}
          contentContainerStyle={styles.messageList}
          conversationKey={`reader:${discussion.id}`}
          {...(focusMessageId ? { focusMessageId } : {})}
          followLatestToken={followLatestToken}
          latestReadableMessageId={latestReadableMessageId}
          messageIds={messages.map((message) => message.id)}
          onLatestRead={() => { void repository.markDiscussionRead(discussion.id); }}
          workspaceId={runtime.workspaceId}
        >
          {messages.length ? messages.map((message, index) => (
          <ConversationAnchor id={message.id} key={message.id}>
            <MessageCard
              message={message}
              onCollapse={() => { void repository.setMessageCollapsed(message.id, !message.collapsed); }}
              onMenu={(anchor) => { setMessageMenu(message); setMessageMenuAnchor(anchor); }}
              onRetry={message.role === 'assistant' && (message.status === 'failed' || message.status === 'interrupted') && ai && prompt
                ? () => {
                  const question = previousUser(messages, index)?.content ?? '';
                  setFollowLatestToken((current) => current + 1);
                  setError(null); setErrorRetry(null);
                  setRetryingMessageId(message.id);
                  void ensureReadingProgressBaseline(runtime.workspaceId, `reader:${discussion.id}`, latestReadableMessageId).catch(() => undefined)
                    .then(() => ai.retryReply(discussion, message.id, question, { book, passage: discussionPassages[0] ?? null, passages: discussionPassages, role }, prompt, messages.slice(0, index)))
                    .catch((cause: unknown) => { setErrorRetry(null); setError(messageOf(cause, '重试失败')); })
                    .finally(() => setRetryingMessageId((current) => current === message.id ? null : current));
                }
                : null}
              retrying={retryingMessageId === message.id}
            />
          </ConversationAnchor>
          )) : <ReaderEmpty detail="这个讨论还没有消息。" icon={MessageCircle} title="开始讨论" />}
        </ConversationViewport>
      )}
      {!messagesLoading && !messagesError ? <View style={styles.composer}>
        <TextInput
          accessibilityLabel="后续问题"
          editable={!sending && !pending}
          multiline
          onChangeText={setInput}
          placeholder="继续追问"
          placeholderTextColor={styles.placeholder.color}
          style={styles.composerInput}
          value={input}
        />
        {pending ? <ReaderIconButton danger icon={Square} label="停止回答" onPress={() => ai?.stop(`discussion:${discussion.id}`)} />
          : <ReaderIconButton active disabled={!input.trim() || sending || !ai || !prompt} icon={Send} label="发送" onPress={() => { void send(); }} />}
      </View> : null}
      <ReaderMessageActionMenu
        anchor={messageMenuAnchor}
        items={messageMenuItems}
        onClose={() => { setMessageMenu(null); setMessageMenuAnchor(null); }}
        visible={messageMenu !== null && messageMenuAnchor !== null}
      />
    </ReaderDetailPane>
  );
}

function ReaderMessageActionMenu({ anchor, items, onClose, visible }: {
  anchor: ReaderMessageMenuAnchor | null;
  items: readonly ActionMenuItem[];
  onClose: () => void;
  visible: boolean;
}) {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const styles = useStyles();
  if (!anchor) return null;

  const menuWidth = Math.min(240, Math.max(0, width - spacing.lg * 2));
  const availableHeight = Math.max(minimumTouchTarget, height - insets.top - insets.bottom - spacing.lg * 2);
  const estimatedHeight = Math.min(items.length * (minimumTouchTarget + spacing.xs) + spacing.xs * 2, availableHeight);
  const bottomLimit = height - insets.bottom - spacing.lg;
  const belowTop = anchor.y + anchor.height + spacing.xs;
  const top = belowTop + estimatedHeight <= bottomLimit
    ? belowTop
    : Math.max(insets.top + spacing.lg, anchor.y - estimatedHeight - spacing.xs);
  const left = Math.min(
    Math.max(spacing.lg, anchor.x + anchor.width - menuWidth),
    Math.max(spacing.lg, width - spacing.lg - menuWidth),
  );
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.messageMenuOverlay}>
        <Pressable accessibilityLabel="关闭消息菜单" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.messageMenuPanel, { left, maxHeight: availableHeight, top, width: menuWidth }]}>
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
                  style={({ pressed }) => [styles.messageMenuItem, item.disabled && styles.messageMenuDisabled, pressed && styles.pressed]}
                >
                  <Icon color={item.danger ? palette.danger : palette.textMuted} size={20} />
                  <Text style={[styles.messageMenuLabel, item.danger && styles.messageMenuLabelDanger]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MessageCard({ message, onCollapse, onMenu, onRetry, retrying = false }: {
  message: ReaderMessage;
  onCollapse: () => void;
  onMenu: (anchor: ReaderMessageMenuAnchor) => void;
  onRetry: (() => void) | null;
  retrying?: boolean;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const assistant = message.role === 'assistant';
  const active = message.status === 'pending';
  const menuButtonRef = useRef<ComponentRef<typeof Pressable>>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const canCollapse = conversationMessageCanCollapse(contentHeight, message.collapsed);
  const timeLabel = active ? '' : messageStatusLabel(message.status) || relativeDate(message.createdAt);
  const openMenu = () => {
    menuButtonRef.current?.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  };

  if (!assistant) {
    return (
      <View style={[styles.messageCard, styles.userCard]}>
        <View style={styles.userContentRow}>
          <Text selectable style={styles.userMessage}>{message.content}</Text>
          <View style={styles.userMeta}>
            {timeLabel ? <Text style={styles.userTime}>{timeLabel}</Text> : null}
            <Pressable
              accessibilityLabel="问题操作"
              accessibilityRole="button"
              hitSlop={8}
              onPress={openMenu}
              ref={menuButtonRef}
              style={({ pressed }) => [styles.userMenuButton, pressed && styles.pressed]}
            >
              <MoreHorizontal color={palette.textMuted} size={16}  strokeWidth={iconography.stroke} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.messageCard, styles.assistantCard]}>
      <View onLayout={(event) => { if (!message.collapsed) setContentHeight(event.nativeEvent.layout.height); }}>
        {message.collapsed ? <Text numberOfLines={2} style={styles.collapsedText}>{message.content}</Text>
          : active && !message.content ? <View style={styles.generatingIndicator}><AiActivityDots /></View>
            : <><ReaderMarkdown content={message.content || message.errorMessage || '回答失败'} />{active ? <View style={styles.generatingTail}><AiActivityDots compact /></View> : null}</>}
      </View>
      {message.errorMessage ? <Text style={styles.messageError}>{message.errorMessage}</Text> : null}
      {onRetry ? <View style={styles.retryAction}><ReaderButton disabled={retrying} icon={RotateCcw} label={retrying ? '正在重试' : '重新回答'} onPress={onRetry} secondary /></View> : null}
      <View style={styles.assistantFooter}>
        <Text style={styles.messageTime}>{timeLabel}</Text>
        <View style={styles.assistantActions}>
          {message.status === 'completed' && canCollapse ? (
            <Pressable
              accessibilityLabel={message.collapsed ? '展开回答' : '收起回答'}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onCollapse}
              style={({ pressed }) => [styles.assistantActionItem, pressed && styles.pressed]}
            >
              {message.collapsed ? <ChevronDown color={palette.textMuted} size={14}  strokeWidth={iconography.stroke} /> : <ChevronUp color={palette.textMuted} size={14}  strokeWidth={iconography.stroke} />}
              <Text style={styles.assistantActionText}>{message.collapsed ? '展开' : '收起'}</Text>
            </Pressable>
          ) : null}
          {message.content ? (
            <Pressable
              accessibilityLabel="复制回答"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => { void Clipboard.setStringAsync(message.content); }}
              style={({ pressed }) => [styles.assistantActionItem, pressed && styles.pressed]}
            >
              <Copy color={palette.textMuted} size={14}  strokeWidth={iconography.stroke} />
              <Text style={styles.assistantActionText}>复制</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="回答操作"
            accessibilityRole="button"
            hitSlop={8}
            onPress={openMenu}
            ref={menuButtonRef}
            style={({ pressed }) => [styles.assistantMenuButton, pressed && styles.pressed]}
          >
            <MoreHorizontal color={palette.textMuted} size={16}  strokeWidth={iconography.stroke} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function ReaderFavoritesScreen({ favorites, discussions, books, error, loading, wide, onBack, onOpenDiscussion, onFocus, onUnfavorite, onRetry }: {
  favorites: readonly ReaderMessage[];
  discussions: readonly ReaderDiscussion[];
  books: readonly ReaderBook[];
  error: string | null;
  loading: boolean;
  wide: boolean;
  onBack: () => void;
  onOpenDiscussion: (id: string, messageId: string) => void;
  onFocus: (messageId: string, discussionId: string) => void;
  onUnfavorite: (messageId: string) => void;
  onRetry: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<ReaderMessage | null>(null);
  const sharing = useReaderShare(setShareError);
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader onBack={onBack} subtitle={`${favorites.length} 条回答`} title="收藏" />
      <ActionMenu visible={shareTarget !== null} onClose={() => setShareTarget(null)} items={shareTarget ? [{
        key: 'share', label: '分享回答', icon: Share2,
        disabled: sharing.pending || shareTarget.status !== 'completed' || !shareTarget.content.trim(),
        onPress: () => {
          const discussion = discussions.find((item) => item.id === shareTarget.discussionId) ?? null;
          const book = books.find((item) => item.id === discussion?.bookId) ?? null;
          const answer = shareTarget;
          sharing.run(() => shareReaderText(readerAnswerShare(answer, discussion, book)));
        },
      }] : []} />
      {shareError ? <ReaderError message={shareError} onRetry={() => setShareError(null)} retryLabel="关闭" /> : null}
      <ReaderScroll>
        {loading ? <ReaderSkeletonRows /> : error ? <ReaderError message={error} onRetry={onRetry} /> : favorites.length ? favorites.map((message) => {
          const discussion = discussions.find((item) => item.id === message.discussionId);
          const book = discussion?.bookId ? books.find((item) => item.id === discussion.bookId) : null;
          return (
            <View key={message.id} style={styles.favoriteRow}>
              <Pressable accessibilityRole="button" accessibilityHint="长按分享回答" onLongPress={() => setShareTarget(message)} onPress={() => onOpenDiscussion(message.discussionId, message.id)} style={({ pressed }) => [styles.favoriteMain, pressed && styles.pressed]}>
                <BookmarkCheck color={palette.brand} size={20}  strokeWidth={iconography.stroke} />
                <View style={styles.favoriteCopy}>
                  <Text numberOfLines={1} style={styles.favoriteTitle}>{discussion?.title ?? '已收藏回答'}</Text>
                  <Text numberOfLines={1} style={styles.favoriteSource}>{book?.title ?? '独立讨论'}</Text>
                  <Text numberOfLines={4} style={styles.favoriteText}>{plainMessagePreview(message.content)}</Text>
                </View>
              </Pressable>
              <ReaderIconButton icon={BookOpen} label="专注阅读" onPress={() => onFocus(message.id, message.discussionId)} />
              <ReaderIconButton danger icon={BookmarkX} label="取消收藏" onPress={() => onUnfavorite(message.id)} />
            </View>
          );
        }) : <ReaderEmpty detail="在讨论回答菜单中点击收藏，即可汇总到这里。" icon={Bookmark} title="还没有收藏" />}
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

export function ReaderFocusedMessageScreen({ message, discussion, book, onBack }: {
  message: ReaderMessage;
  discussion: ReaderDiscussion | null;
  book: ReaderBook | null;
  onBack: () => void;
}) {
  const runtime = useReaderRuntime();
  const styles = useStyles();
  const reading = useFocusedReadingPreferences();
  const [controls, setControls] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const sharing = useReaderShare(setShareError);
  const progressKey = `reader-message:${message.id}`;
  return (
    <ReaderDetailPane>
      <ReaderHeader action={<View style={styles.readerControlRow}>
        {message.status === 'completed' && message.content.trim() ? <ReaderIconButton icon={Share2} label="分享回答" onPress={() => sharing.run(() => shareReaderText(readerAnswerShare(message, discussion, book)))} /> : null}
        <ReaderIconButton icon={MoreHorizontal} label="阅读设置" onPress={() => setControls((value) => !value)} />
      </View>} onBack={onBack} title="专注阅读" />
      {shareError ? <ReaderError message={shareError} onRetry={() => setShareError(null)} retryLabel="关闭" /> : null}
      {controls ? (
        <View style={styles.readerControls}>
          <View style={styles.chips}>
            <ReaderChip label="滚动" onPress={() => { void reading.update({ mode: 'scroll' }); }} selected={reading.value.mode === 'scroll'} />
            <ReaderChip label="翻页" onPress={() => { void reading.update({ mode: 'paged' }); }} selected={reading.value.mode === 'paged'} />
            <ReaderChip label="系统字体" onPress={() => { void reading.update({ fontFamily: 'system' }); }} selected={reading.value.fontFamily === 'system'} />
            <ReaderChip label="衬线字体" onPress={() => { void reading.update({ fontFamily: 'serif' }); }} selected={reading.value.fontFamily === 'serif'} />
          </View>
          <View style={styles.readerControlRow}>
            <ReaderButton disabled={reading.value.fontSize <= 14} label="A-" onPress={() => { void reading.update({ fontSize: reading.value.fontSize - 1 }); }} secondary />
            <Text style={styles.readerControlValue}>{reading.value.fontSize}px</Text>
            <ReaderButton disabled={reading.value.fontSize >= 32} label="A+" onPress={() => { void reading.update({ fontSize: reading.value.fontSize + 1 }); }} secondary />
          </View>
        </View>
      ) : null}
      <FocusedReadingContent content={message.content} preferences={reading.value} progressKey={progressKey} workspaceId={runtime.workspaceId} />
    </ReaderDetailPane>
  );
}

function previousUser(messages: readonly ReaderMessage[], answerIndex: number): ReaderMessage | null {
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message;
  }
  return null;
}

function nextAssistant(messages: readonly ReaderMessage[], questionIndex: number): ReaderMessage | null {
  for (let index = questionIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'user') return null;
    if (message?.role === 'assistant') return message;
  }
  return null;
}

function discussionContextLabel(book: ReaderBook | null, passage: ReaderPassage | ReaderPassageIndex | readonly (ReaderPassage | ReaderPassageIndex)[] | null, prompt: ReaderPrompt | null): string {
  const passages = Array.isArray(passage) ? passage : passage ? [passage] : [];
  if (!book && passages.length === 0) return '独立问题';
  // Without excerpts the AI sees at most the title, authors and publisher, never the book's text.
  if (passages.length === 0) return prompt?.includeBook === false ? '不提供书籍信息，AI 没有这本书的内容' : '仅提供书名、作者和出版社，AI 没有这本书的全文';
  if (passages.length > 1) return `基于 ${passages.length} 条摘录`;
  const first = passages[0];
  if (!first) return '关联摘录';
  if (prompt?.includeSource) return first.pageLabel.trim() ? `基于摘录 · ${first.pageLabel}` : '基于摘录原文';
  if (prompt?.includeSummary && ('summary' in first ? first.summary.trim() : first.summaryPreview.trim())) return '基于摘录摘要';
  return '关联摘录';
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

function plainMessagePreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/[>*_~`#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function messageStatusLabel(status: ReaderMessage['status'] | null): string {
  if (status === 'pending') return '';
  if (status === 'failed') return '回答失败';
  if (status === 'interrupted') return '已中断';
  return '';
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function useStyles() { return useThemedStyles(createStyles); }

function createStyles(palette: Palette) {
  return StyleSheet.create({
    fill: { flex: 1 },
    headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, height: READER_PRIMARY_ACTION_HEIGHT },
    primaryAction: { height: READER_PRIMARY_ACTION_HEIGHT },
    searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, paddingRight: spacing.lg },
    searchInline: { flex: 1, marginRight: 0 },
    filterChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    list: { paddingBottom: spacing.xxl },
    discussionRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 92, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    discussionIcon: { alignItems: 'center', backgroundColor: palette.surfaceMuted, borderRadius: radius.control, height: 44, justifyContent: 'center', width: 44 },
    discussionIconUnread: { backgroundColor: palette.primarySoft },
    discussionCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    titleLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    discussionTitle: { color: palette.text, flex: 1, fontSize: 15, fontWeight: '600' },
    unreadTitle: { fontWeight: '800' },
    discussionPreview: { color: palette.textMuted, fontSize: 13, lineHeight: 19 },
    discussionMeta: { color: palette.textSubtle, fontSize: 11 },
    form: { gap: spacing.lg, padding: spacing.lg },
    formLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    aiNotice: { backgroundColor: palette.surfaceSoft, borderRadius: radius.control, gap: spacing.sm, padding: spacing.md },
    aiNoticeText: { color: palette.textMuted, fontSize: 13, lineHeight: 19 },
    contextHint: { color: palette.textSubtle, fontSize: 12, lineHeight: 18, marginTop: -spacing.md },
    detailToggle: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
    detailToggleText: { color: palette.brand, fontSize: 14, fontWeight: '700' },
    messageList: { flexGrow: 1, gap: spacing.lg, padding: spacing.lg },
    messageCard: { borderRadius: radius.card, gap: spacing.md, padding: spacing.lg },
    assistantCard: { backgroundColor: palette.surface },
    userCard: { alignSelf: 'flex-end', backgroundColor: palette.primarySoft, maxWidth: '88%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    userContentRow: { alignItems: 'flex-end', flexDirection: 'row', gap: spacing.sm },
    userMeta: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: spacing.xs, paddingBottom: 1 },
    userMenuButton: { alignItems: 'center', borderRadius: radius.control, height: 24, justifyContent: 'center', width: 24 },
    userTime: { color: palette.textSubtle, fontSize: 11 },
    messageTime: { color: palette.textSubtle, fontSize: 11 },
    assistantFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 26, marginTop: spacing.xs },
    assistantActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
    assistantActionItem: { alignItems: 'center', borderRadius: radius.control, flexDirection: 'row', gap: 4, height: 26, justifyContent: 'center', paddingHorizontal: spacing.xs },
    assistantActionText: { color: palette.textMuted, fontSize: 12 },
    assistantMenuButton: { alignItems: 'center', borderRadius: radius.control, height: 26, justifyContent: 'center', width: 26 },
    userMessage: { color: palette.text, flexShrink: 1, fontSize: 15, lineHeight: 22 },
    collapsedText: { color: palette.textMuted, fontSize: 14, lineHeight: 21 },
    messageError: { color: palette.danger, fontSize: 12, lineHeight: 18 },
    generatingIndicator: { alignSelf: 'flex-start' },
    generatingTail: { alignItems: 'flex-start', paddingTop: spacing.sm },
    messageMenuOverlay: { backgroundColor: palette.overlay, flex: 1 },
    messageMenuPanel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden', paddingVertical: spacing.xs, position: 'absolute' },
    messageMenuItem: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: minimumTouchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    messageMenuLabel: { ...typography.body, color: palette.text, flex: 1 },
    messageMenuLabelDanger: { color: palette.danger },
    messageMenuDisabled: { opacity: interaction.disabledOpacity },
    retryAction: { alignSelf: 'flex-start' },
    composer: { alignItems: 'flex-end', backgroundColor: palette.nav, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
    composerInput: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, color: palette.text, flex: 1, fontSize: 15, maxHeight: 132, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    placeholder: { color: palette.textSubtle },
    favoriteRow: { alignItems: 'flex-start', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.lg },
    favoriteMain: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', gap: spacing.md, minWidth: 0, paddingVertical: spacing.xs },
    favoriteCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    favoriteTitle: { color: palette.text, fontSize: 14, fontWeight: '700' },
    favoriteSource: { color: palette.brand, fontSize: 12 },
    favoriteText: { color: palette.textMuted, fontSize: 13, lineHeight: 20 },
    readerControls: { backgroundColor: palette.surface, borderBottomColor: palette.border, borderBottomWidth: 1, gap: spacing.md, padding: spacing.md },
    readerControlRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
    readerControlValue: { color: palette.text, fontSize: 14, fontWeight: '700' },
    focusPage: { flexGrow: 1, justifyContent: 'center', paddingBottom: spacing.xxl, paddingTop: spacing.xl },
    focusScroll: { justifyContent: 'center', paddingBottom: spacing.xxl, paddingTop: spacing.xl },
    pageNumber: { color: palette.textSubtle, fontSize: 11, marginTop: spacing.xl, textAlign: 'center' },
    pressed: { opacity: 0.66 },
  });
}
