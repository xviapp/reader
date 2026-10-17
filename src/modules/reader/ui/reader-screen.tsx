import { router } from 'expo-router';
import { ArrowLeft, BookOpen, MessageCircle, Settings, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { discardReadingSession } from '@/core/reading/reading-session-store.native';
import { type Palette } from '@/core/design/tokens';
import { useAppTheme } from '@/core/design/theme';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { useReaderRuntime } from '@/core/runtime/reader-runtime';
import { clearReadingProgress } from '@/core/ui/conversation-progress';

import type {
  ReaderDiscussionRepository,
  ReaderLibraryRepository,
  ReaderSearchRepository,
  ReaderTaskRepository,
  ReaderTrashRepository,
} from '../application/ports';
import { useReaderRepositoryState } from '../composition';
import type { ReaderBookStatus, ReaderDiscussion, ReaderMessage, ReaderPassage, ReaderPassageIndex } from '../domain/model';
import { readerDiscussionPassageIds } from '../domain/rules';
import {
  ReaderDiscussionsScreen,
  ReaderDiscussionScreen,
  ReaderFavoritesScreen,
  ReaderFocusedMessageScreen,
  ReaderNewDiscussionScreen,
} from './discussions';
import { createReaderComposerIntent, readerDiscussionsForPassage } from './discussion-flow';
import {
  ReaderBookDetailScreen,
  ReaderBookFormScreen,
  ReaderLibraryScreen,
  ReaderTrashScreen,
} from './library';
import { isPrimaryRoute, primaryOf, primaryRoute, shouldShowReaderPrimaryPane, type ReaderRoute } from './navigation';
import {
  ReaderPassageCaptureScreen,
  ReaderPassageDetailScreen,
  ReaderPassageSourceScreen,
} from './passages';
import { ReaderReadingRecordsScreen } from './reading-records';
import { ReaderSearchScreen } from './search';
import {
  ReaderBottomNav,
  ReaderButton,
  ReaderDetailPane,
  ReaderEmpty,
  ReaderError,
  ReaderPrimaryPane,
  ReaderSkeletonRows,
} from './reader-ui';
import { ReaderSettingsScreen } from './settings';
import { useReaderNavigationState } from './reader-navigation-state';
import { ReaderNavigationGuardProvider, useReaderNavigation } from './use-reader-navigation';
import { useReaderPassage, useReaderPassages, useReaderWorkspace } from './use-reader-workspace';

const WIDE_READER_WIDTH = 840;

export function ReaderScreen({ route: detailRoute }: { route?: ReaderRoute }) {
  const runtime = useReaderRuntime();
  const theme = useAppTheme();
  const reader = useReaderRepositoryState();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_READER_WIDTH;
  const repository = reader.repository;
  const workspace = useReaderWorkspace();
  const [workspaceState, setWorkspaceState] = useReaderNavigationState();
  const { libraryQuery, libraryStatus, discussionQuery, discussionBookFilter } = workspaceState;
  const route = detailRoute ?? primaryRoute(workspaceState.primary);
  const { navigate, replaceRoute, replaceFromSidebar, goBack, selectPrimary, registerGuard } = useReaderNavigation(route);
  const setLibraryQuery = useCallback((libraryQuery: string) => {
    setWorkspaceState((current) => ({ ...current, libraryQuery }));
  }, [setWorkspaceState]);
  const setLibraryStatus = useCallback((libraryStatus: ReaderBookStatus | 'all') => {
    setWorkspaceState((current) => ({ ...current, libraryStatus }));
  }, [setWorkspaceState]);
  const setDiscussionQuery = useCallback((discussionQuery: string) => {
    setWorkspaceState((current) => ({ ...current, discussionQuery }));
  }, [setWorkspaceState]);
  const setDiscussionBookFilter = useCallback((discussionBookFilter: string | null) => {
    setWorkspaceState((current) => ({ ...current, discussionBookFilter }));
  }, [setWorkspaceState]);
  const [operationError, setOperationError] = useState<string | null>(null);

  const activeDiscussionId = discussionIdOf(route);
  const messages = useDiscussionMessages(repository, activeDiscussionId);
  const primary = primaryOf(route);
  const loading = reader.dataPhase !== 'ready' || (
    primary === 'library' ? workspace.libraryLoading
      : primary === 'discussions' ? workspace.discussionsLoading
        : workspace.settingsLoading
  );
  const workspaceError = reader.dataError ?? (
    primary === 'library' ? workspace.libraryError
      : primary === 'discussions' ? workspace.discussionsError
        : workspace.settingsError
  );
  const passageDetailId = passageIdForRoute(route, workspace.discussions, workspace.passages);
  const passageDetail = useReaderPassage(repository, passageDetailId);
  const activeDiscussion = activeDiscussionId ? workspace.discussions.find((item) => item.id === activeDiscussionId) ?? null : null;
  const activeDiscussionPassageIds = useMemo(
    () => activeDiscussion ? readerDiscussionPassageIds(activeDiscussion) : [],
    [activeDiscussion],
  );
  const activeDiscussionPassages = useReaderPassages(repository, activeDiscussionPassageIds);
  const retryWorkspace = () => {
    workspace.retry();
    if (reader.dataPhase === 'error') reader.retryData();
  };
  const deletedCount = workspace.books.filter((item) => item.deletedAt !== null).length
    + workspace.passages.filter((item) => item.deletedAt !== null).length
    + workspace.discussions.filter((item) => item.deletedAt !== null).length;

  const primaryContent = primary === 'library' ? (
    <ReaderLibraryScreen
      books={workspace.books}
      error={workspaceError}
      loading={loading}
      onAdd={() => navigate({ name: 'book-form', bookId: null })}
      onOpen={(bookId) => {
        const next = { name: 'book', bookId, tab: 'passages' } as const;
        if (wide && !isPrimaryRoute(route) && primaryOf(route) === 'library') replaceFromSidebar(next);
        else navigate(next);
      }}
      onQueryChange={setLibraryQuery}
      onStatusChange={setLibraryStatus}
      onRetry={retryWorkspace}
      onSearch={() => navigate({ name: 'search', bookId: null })}
      passages={workspace.passages}
      query={libraryQuery}
      status={libraryStatus}
    />
  ) : primary === 'discussions' ? (
    <ReaderDiscussionsScreen
      books={workspace.books}
      discussions={workspace.discussions}
      error={workspaceError}
      bookFilterId={discussionBookFilter}
      loading={loading}
      onAdd={() => navigate({ name: 'discussion-new', bookId: null, passageId: null, question: '' })}
      onFavorites={() => navigate({ name: 'discussion-favorites' })}
      onBookFilterChange={setDiscussionBookFilter}
      onOpen={(discussionId) => {
        const next = { name: 'discussion', discussionId } as const;
        if (wide && !isPrimaryRoute(route) && primaryOf(route) === 'discussions') replaceFromSidebar(next);
        else navigate(next);
      }}
      onQueryChange={setDiscussionQuery}
      onRetry={retryWorkspace}
      onTrash={() => navigate({ name: 'discussion-trash' })}
      query={discussionQuery}
    />
  ) : (
    <ReaderSettingsScreen
      aiConfiguration={runtime.aiConfiguration}
      aiPhase={runtime.aiPhase}
      deletedCount={deletedCount}
      preferences={workspace.preferences}
      themeMode={theme.mode}
    />
  );

  const primaryPane = (
    <ReaderPrimaryPane wide={wide}>
      <View style={styles.primaryScene}>{primaryContent}</View>
      <ReaderBottomNav active={primary} onSelect={selectPrimary} />
    </ReaderPrimaryPane>
  );

  const detailPane = reader.dataError
    ? <ReaderDetailPane wide={wide}><ReaderError message={reader.dataError} onRetry={reader.retryData} /></ReaderDetailPane>
    : repository
    ? renderDetail({
      route,
      repository,
      dataReady: reader.dataPhase === 'ready',
      workspace,
      messages: messages.items,
      messagesError: messages.error,
      messagesLoading: messages.loading,
      passageDetail,
      discussionPassages: activeDiscussionPassages.items,
      retryMessages: messages.retry,
      runtime,
      wide,
      navigate,
      replaceRoute,
      goBack,
      setOperationError,
    })
      : <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;

  return (
    <ReaderNavigationGuardProvider register={registerGuard}>
      <SafeAreaView style={styles.safeArea}>
        {operationError ? <ReaderError message={operationError} onRetry={() => setOperationError(null)} retryLabel="关闭" /> : null}
        <View style={[styles.workspace, wide && styles.workspaceWide]}>
          {shouldShowReaderPrimaryPane(route, wide) ? primaryPane : null}
          {wide || !isPrimaryRoute(route) ? detailPane : null}
        </View>
      </SafeAreaView>
    </ReaderNavigationGuardProvider>
  );
}

interface DetailContext {
  route: ReaderRoute;
  repository: ReaderLibraryRepository
    & ReaderDiscussionRepository
    & ReaderSearchRepository
    & ReaderTaskRepository
    & ReaderTrashRepository;
  dataReady: boolean;
  workspace: ReturnType<typeof useReaderWorkspace>;
  messages: readonly ReaderMessage[];
  messagesError: string | null;
  messagesLoading: boolean;
  passageDetail: ReturnType<typeof useReaderPassage>;
  discussionPassages: readonly ReaderPassage[];
  retryMessages: () => void;
  runtime: ReturnType<typeof useReaderRuntime>;
  wide: boolean;
  navigate: (route: ReaderRoute) => void;
  replaceRoute: (route: ReaderRoute) => void;
  goBack: () => void;
  setOperationError: (value: string | null) => void;
}

function renderDetail(context: DetailContext) {
  const { route, repository, dataReady, workspace, messages, messagesError, messagesLoading, passageDetail, discussionPassages, retryMessages, runtime, wide, navigate, replaceRoute, goBack, setOperationError } = context;
  const discussionPrompt = workspace.prompts.find((item) => item.stage === 'discussion') ?? null;
  const followUpPrompt = workspace.prompts.find((item) => item.stage === 'follow-up') ?? null;

  if (route.name === 'search') return <ReaderSearchScreen
    bookId={route.bookId}
    onBack={goBack}
    onOpenBook={(bookId) => navigate({ name: 'book', bookId, tab: 'passages' })}
    onOpenDiscussion={(discussionId, messageId) => navigate({ name: 'discussion', discussionId, ...(messageId ? { focusMessageId: messageId } : {}) })}
    onOpenPassage={(passageId) => navigate({ name: 'passage', passageId, tab: 'questions' })}
    repository={repository}
    wide={wide}
  />;

  if (route.name === 'book') {
    if (!dataReady) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    const book = workspace.books.find((item) => item.id === route.bookId && item.deletedAt === null);
    if (!book && workspace.libraryLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    if (!book) return <ReaderMissing onBack={goBack} title="找不到这本书" />;
    return <ReaderBookDetailScreen
      ai={workspace.ai}
      aiAvailable={runtime.ai !== null}
      book={book}
      books={workspace.books}
      discussionState={{ loading: workspace.discussionRowsLoading, error: workspace.discussionRowsError, onRetry: workspace.retryDiscussionRows }}
      discussions={workspace.discussions}
      favoriteState={{ loading: workspace.favoritesLoading, error: workspace.favoritesError, onRetry: workspace.retryFavorites }}
      favorites={workspace.favorites}
      onBack={goBack}
      onCapture={() => navigate({ name: 'passage-capture', bookId: book.id })}
      onDiscuss={() => navigate({ name: 'discussion-new', bookId: book.id, passageId: null, question: '' })}
      onEdit={() => navigate({ name: 'book-form', bookId: book.id })}
      onFocusFavorite={(messageId, discussionId) => navigate({ name: 'discussion-reader', discussionId, messageId })}
      onOpenDiscussion={(discussionId, focusMessageId) => navigate({ name: 'discussion', discussionId, ...(focusMessageId ? { focusMessageId } : {}) })}
      onOpenPassage={(passageId) => navigate({ name: 'passage', passageId, tab: 'questions' })}
      onOpenPassageSource={(passageId) => navigate({ name: 'passage-source', passageId })}
      onOpenTrash={() => navigate({ name: 'book-trash', bookId: book.id })}
      onOpenReading={() => navigate({ name: 'book-reading', bookId: book.id })}
      onOpenBookTimer={(bookId) => navigate({ name: 'book', bookId, tab: 'passages', endSession: true })}
      endSessionRequested={route.endSession === true}
      onEndSessionHandled={() => replaceRoute({ name: 'book', bookId: book.id, tab: route.tab })}
      onSearch={() => navigate({ name: 'search', bookId: book.id })}
      onTabChange={(tab) => replaceRoute({ name: 'book', bookId: book.id, tab })}
      onTrash={() => confirmTrashBook(book.title, () => {
        void workspace.ai?.trashBook(book.id).then(async () => {
          // A timer on a trashed book could never be ended; it is dropped rather than recorded.
          await discardReadingSession(book.id);
          await Promise.all(workspace.discussions
            .filter((discussion) => discussion.bookId === book.id)
            .map((discussion) => clearReadingProgress(runtime.workspaceId, `reader:${discussion.id}`)));
          goBack();
        }).catch((cause: unknown) => setOperationError(messageOf(cause, '删除书籍失败')));
      })}
      onTrashDiscussion={(discussionId) => confirmTrashDiscussion(() => {
        void workspace.ai?.trashDiscussion(discussionId).then(async () => {
          await clearReadingProgress(runtime.workspaceId, `reader:${discussionId}`);
        }).catch((cause: unknown) => setOperationError(messageOf(cause, '删除讨论失败')));
      })}
      onTrashPassage={(passageId) => confirmTrashPassage(() => {
        void workspace.ai?.trashPassage(passageId).catch((cause: unknown) => setOperationError(messageOf(cause, '删除摘录失败')));
      })}
      onUnfavorite={(messageId) => {
        void repository.setMessageFavorite(messageId, false).catch((cause: unknown) => setOperationError(messageOf(cause, '取消收藏失败')));
      }}
      passageState={{ loading: workspace.passagesLoading, error: workspace.passagesError, onRetry: workspace.retryPassages }}
      passages={workspace.passages}
      repository={repository}
      tab={route.tab}
      wide={wide}
    />;
  }

  if (route.name === 'book-form') {
    if (!dataReady || (route.bookId && workspace.libraryLoading && !workspace.books.some((item) => item.id === route.bookId))) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    const book = route.bookId ? workspace.books.find((item) => item.id === route.bookId && item.deletedAt === null) ?? null : null;
    if (route.bookId && !book) return <ReaderMissing onBack={goBack} title="找不到这本书" />;
    return <ReaderBookFormScreen
      ai={workspace.ai}
      aiAvailable={runtime.ai !== null}
      book={book}
      key={`book-form:${route.bookId ?? 'new'}`}
      media={runtime.media}
      onBack={goBack}
      onSave={async (draft, previousCover) => {
        if (book) {
          await repository.updateBook(book.id, draft);
          if (previousCover && previousCover !== draft.coverUri) await runtime.media.deleteImage(previousCover);
          return book.id;
        }
        return repository.createBook(draft);
      }}
      onSaved={(bookId) => {
        if (book) goBack();
        else replaceRoute({ name: 'book', bookId, tab: 'passages' });
      }}
      roles={workspace.roles}
      wide={wide}
    />;
  }

  if (route.name === 'book-reading') {
    if (!dataReady) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    const book = workspace.books.find((item) => item.id === route.bookId && item.deletedAt === null);
    if (!book && workspace.libraryLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    if (!book) return <ReaderMissing onBack={goBack} title="找不到这本书" />;
    return <ReaderReadingRecordsScreen book={book} onBack={goBack} repository={repository} wide={wide} />;
  }

  if (route.name === 'reader-trash' || route.name === 'discussion-trash' || route.name === 'book-trash') {
    return <ReaderTrashScreen
      {...(route.name === 'book-trash' ? { bookId: route.bookId } : {})}
      books={workspace.books}
      discussions={workspace.discussions}
      media={runtime.media}
      onBack={goBack}
      onError={setOperationError}
      passages={workspace.passages}
      repository={repository}
      {...(route.name === 'discussion-trash' ? { scope: 'discussions' as const } : {})}
      wide={wide}
    />;
  }

  if (route.name === 'passage-capture') {
    if (!dataReady) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    const book = workspace.books.find((item) => item.id === route.bookId && item.deletedAt === null);
    if (!book && workspace.libraryLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    if (!book) return <ReaderMissing onBack={goBack} title="找不到这本书" />;
    return <ReaderPassageCaptureScreen
      ai={workspace.ai}
      aiAvailable={runtime.ai !== null}
      book={book}
      key={`passage-capture:${book.id}`}
      media={runtime.media}
      ocr={runtime.ocr}
      onBack={goBack}
      onAnalysisError={(message) => setOperationError(message)}
      onConfigureAi={() => router.push('/settings/ai')}
      onSaved={(passageId) => replaceRoute({ name: 'passage', passageId, tab: 'questions' })}
      preferences={workspace.preferences}
      repository={repository}
      wide={wide}
    />;
  }

  if (route.name === 'passage' || route.name === 'passage-source') {
    if (!dataReady) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    if (passageDetail.loading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows /></ReaderDetailPane>;
    if (passageDetail.error) return <ReaderDetailPane wide={wide}><ReaderError message={passageDetail.error} onRetry={passageDetail.retry} /></ReaderDetailPane>;
    const passage = passageDetail.item?.id === route.passageId && passageDetail.item.deletedAt === null ? passageDetail.item : null;
    const book = passage ? workspace.books.find((item) => item.id === passage.bookId && item.deletedAt === null) : null;
    if (!book && workspace.libraryLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    if (!passage || !book) return <ReaderMissing onBack={goBack} title="找不到这条摘录" />;
    if (route.name === 'passage-source') return <ReaderPassageSourceScreen ai={workspace.ai} aiAvailable={runtime.ai !== null} key={`passage-source:${passage.id}`} media={runtime.media} onBack={goBack} onConfigureAi={() => router.push('/settings/ai')} passage={passage} repository={repository} wide={wide} />;
    return <ReaderPassageDetailScreen
      ai={workspace.ai}
      aiAvailable={runtime.ai !== null}
      book={book}
      discussionState={{ loading: workspace.discussionRowsLoading, error: workspace.discussionRowsError, onRetry: workspace.retryDiscussionRows }}
      discussions={readerDiscussionsForPassage(workspace.discussions, passage.id)}
      media={runtime.media}
      onBack={goBack}
      onNewDiscussion={(question) => navigate({ name: 'discussion-new', bookId: book.id, passageId: passage.id, question })}
      onOpenDiscussion={(discussionId, question) => navigate(question
        ? { name: 'discussion', discussionId, composerIntent: createReaderComposerIntent(question) }
        : { name: 'discussion', discussionId })}
      onConfigureAi={() => router.push('/settings/ai')}
      onSource={() => navigate({ name: 'passage-source', passageId: passage.id })}
      onTabChange={(tab) => replaceRoute({ name: 'passage', passageId: passage.id, tab })}
      repository={repository}
      onTrash={() => confirmTrashPassage(() => { void workspace.ai?.trashPassage(passage.id).then(goBack).catch((cause: unknown) => setOperationError(messageOf(cause, '删除摘录失败'))); })}
      onTrashDiscussion={(discussionId) => confirmTrashDiscussion(() => {
        void workspace.ai?.trashDiscussion(discussionId).then(async () => {
          await clearReadingProgress(runtime.workspaceId, `reader:${discussionId}`);
        }).catch((cause: unknown) => setOperationError(messageOf(cause, '删除讨论失败')));
      })}
      passage={passage}
      tab={route.tab}
      wide={wide}
    />;
  }

  if (route.name === 'discussion-new') {
    if (!dataReady || workspace.libraryLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    const initialBook = route.bookId ? workspace.books.find((item) => item.id === route.bookId && item.deletedAt === null) ?? null : null;
    const initialPassage = route.passageId ? workspace.passages.find((item) => item.id === route.passageId && item.deletedAt === null) ?? null : null;
    return <ReaderNewDiscussionScreen
      ai={workspace.ai}
      aiAvailable={runtime.ai !== null}
      books={workspace.books}
      initialBook={initialBook}
      initialPassage={initialPassage}
      initialQuestion={route.question}
      key={`discussion-new:${route.passageId ?? route.bookId ?? 'free'}`}
      onBack={goBack}
      onConfigureAi={() => router.push('/settings/ai')}
      onCreated={(discussionId) => replaceRoute({ name: 'discussion', discussionId })}
      passages={workspace.passages}
      prompt={discussionPrompt}
      roles={workspace.roles}
      wide={wide}
    />;
  }

  if (route.name === 'discussion') {
    if (!dataReady) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    const discussion = workspace.discussions.find((item) => item.id === route.discussionId && item.deletedAt === null);
    if (!discussion && workspace.discussionsLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
    if (!discussion) return <ReaderMissing onBack={goBack} title="找不到这个讨论" />;
    const book = discussion.bookId ? workspace.books.find((item) => item.id === discussion.bookId) ?? null : null;
    const passage = discussion.passageId && passageDetail.item?.id === discussion.passageId ? passageDetail.item : null;
    const sourcePassageIds = readerDiscussionPassageIds(discussion);
    const linkedPassageState = sourcePassageIds.length === 0
      ? 'none'
      : discussionPassages.length > 0 || (passage && passage.deletedAt === null)
        ? 'active'
        : passage?.deletedAt ? 'trashed' : 'none';
    const activePassageId = linkedPassageState === 'active' ? discussionPassages[0]?.id ?? passage?.id ?? null : null;
    return <ReaderDiscussionScreen
      ai={workspace.ai}
      book={book}
      composerIntent={route.composerIntent ?? null}
      discussion={discussion}
      focusMessageId={route.focusMessageId ?? null}
      key={`discussion:${discussion.id}`}
      messages={messages}
      messagesError={messagesError}
      messagesLoading={messagesLoading}
      passages={discussionPassages}
      linkedPassageState={linkedPassageState}
      onBack={goBack}
      onComposerIntentConsumed={() => replaceRoute({ name: 'discussion', discussionId: discussion.id })}
      onFocus={(messageId) => navigate({ name: 'discussion-reader', discussionId: discussion.id, messageId })}
      onOpenPassage={activePassageId
        ? () => navigate({ name: 'passage', passageId: activePassageId, tab: 'questions' })
        : null}
      onRetryMessages={retryMessages}
      onTrash={() => confirmTrashDiscussion(() => { void workspace.ai?.trashDiscussion(discussion.id).then(async () => { await clearReadingProgress(runtime.workspaceId, `reader:${discussion.id}`); goBack(); }).catch((cause: unknown) => setOperationError(messageOf(cause, '删除讨论失败'))); })}
      passage={passage}
      prompt={followUpPrompt}
      repository={repository}
      role={workspace.roles.find((item) => item.id === book?.roleId) ?? null}
      wide={wide}
    />;
  }

  if (route.name === 'discussion-favorites') return <ReaderFavoritesScreen
    books={workspace.books}
    discussions={workspace.discussions}
    error={workspace.favoritesError}
    favorites={workspace.favorites}
    loading={workspace.favoritesLoading}
    onBack={goBack}
    onFocus={(messageId, discussionId) => navigate({ name: 'discussion-reader', discussionId, messageId })}
    onOpenDiscussion={(discussionId, messageId) => navigate({ name: 'discussion', discussionId, focusMessageId: messageId })}
    onUnfavorite={(messageId) => {
      void repository.setMessageFavorite(messageId, false).catch((cause: unknown) => setOperationError(messageOf(cause, '取消收藏失败')));
    }}
    onRetry={workspace.retryFavorites}
    wide={wide}
  />;

  if (route.name === 'discussion-reader') {
    if (messagesLoading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows /></ReaderDetailPane>;
    if (messagesError) return <ReaderDetailPane wide={wide}><ReaderError message={messagesError} onRetry={retryMessages} /></ReaderDetailPane>;
    const message = messages.find((item) => item.id === route.messageId) ?? workspace.favorites.find((item) => item.id === route.messageId);
    if (!message || !workspace.preferences) return <ReaderMissing onBack={goBack} title="找不到这条回答" />;
    const discussion = workspace.discussions.find((item) => item.id === message.discussionId) ?? null;
    const book = workspace.books.find((item) => item.id === discussion?.bookId) ?? null;
    return <ReaderFocusedMessageScreen book={book} discussion={discussion} message={message} onBack={goBack} />;
  }

  const icon = primaryOf(route) === 'discussions' ? MessageCircle : primaryOf(route) === 'settings' ? Settings : BookOpen;
  return <ReaderPlaceholder icon={icon} title={primaryOf(route) === 'library' ? '从书架选择一本书' : primaryOf(route) === 'discussions' ? '从左侧选择一个讨论' : '选择一项 Reader 设置'} />;
}

function ReaderPlaceholder({ icon, title }: { icon: LucideIcon; title: string }) {
  return <ReaderDetailPane wide><ReaderEmpty icon={icon} title={title} /></ReaderDetailPane>;
}

function ReaderMissing({ title, onBack }: { title: string; onBack: () => void }) {
  return <ReaderDetailPane><ReaderEmpty action={<ReaderButton icon={ArrowLeft} label="返回" onPress={onBack} secondary />} detail="内容可能已被删除或尚未加载。" icon={BookOpen} title={title} /></ReaderDetailPane>;
}

function discussionIdOf(route: ReaderRoute): string | null {
  if (route.name === 'discussion' || route.name === 'discussion-reader') return route.discussionId;
  return null;
}

function passageIdForRoute(
  route: ReaderRoute,
  discussions: readonly ReaderDiscussion[],
  passages: readonly ReaderPassageIndex[],
): string | null {
  if (route.name === 'passage' || route.name === 'passage-source') return route.passageId;
  if (route.name === 'discussion-new') return route.passageId;
  if (route.name === 'discussion') {
    return discussions.find((item) => item.id === route.discussionId)?.passageId ?? null;
  }
  return null;
}

function useDiscussionMessages(repository: ReaderDiscussionRepository | null, discussionId: string | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    repository: ReaderDiscussionRepository | null;
    discussionId: string | null;
    items: readonly ReaderMessage[];
    error: string | null;
  }>({ repository: null, discussionId: null, items: [], error: null });
  useEffect(() => {
    if (!repository || !discussionId) return;
    return repository.watchMessages(
      discussionId,
      (items) => setState({ repository, discussionId, items, error: null }),
      (error) => setState({ repository, discussionId, items: [], error: error.message }),
    );
  }, [discussionId, repository, revision]);
  const current = state.repository === repository && state.discussionId === discussionId;
  return {
    items: current ? state.items : [],
    error: current ? state.error : null,
    loading: Boolean(repository && discussionId && !current),
    retry: () => setRevision((value) => value + 1),
  };
}

function confirmTrashBook(title: string, action: () => void) {
  Alert.alert('将书籍移到回收站？', `《${title}》以及其中的摘录和讨论会一起移入回收站。`, [{ text: '取消', style: 'cancel' }, { text: '移到回收站', style: 'destructive', onPress: action }]);
}

function confirmTrashPassage(action: () => void) {
  Alert.alert('将摘录移到回收站？', '原文、图片和分析结果会保留在回收站中。', [{ text: '取消', style: 'cancel' }, { text: '移到回收站', style: 'destructive', onPress: action }]);
}

function confirmTrashDiscussion(action: () => void) {
  Alert.alert('将讨论移到回收站？', '问题、回答和收藏状态会一起保留在回收站中。', [{ text: '取消', style: 'cancel' }, { text: '移到回收站', style: 'destructive', onPress: action }]);
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { backgroundColor: palette.canvas, flex: 1 },
    workspace: { flex: 1 },
    workspaceWide: { flexDirection: 'row' },
    primaryScene: { flex: 1 },
  });
}
