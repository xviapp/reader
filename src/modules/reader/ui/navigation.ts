import { normalizeReaderComposerIntent, type ReaderComposerIntent } from './discussion-flow';

export type ReaderPrimaryName = 'library' | 'discussions' | 'settings';
export type ReaderBookTab = 'passages' | 'discussions' | 'favorites';
export type ReaderPassageTab = 'questions' | 'discussions';

export type ReaderBackAction = 'router-back' | 'home' | 'exit-app';

export function resolveReaderBackAction(primary: boolean, canGoBack: boolean): ReaderBackAction {
  if (canGoBack) return 'router-back';
  return primary ? 'exit-app' : 'home';
}

export type ReaderRoute =
  | { name: 'library' }
  | { name: 'search'; bookId: string | null }
  /** `endSession` opens the book with its timer's end sheet, e.g. to correct a timer left running. */
  | { name: 'book'; bookId: string; tab: ReaderBookTab; endSession?: true }
  | { name: 'book-form'; bookId: string | null }
  | { name: 'book-trash'; bookId: string }
  | { name: 'book-reading'; bookId: string }
  | { name: 'reader-trash' }
  | { name: 'passage-capture'; bookId: string }
  | { name: 'passage'; passageId: string; tab: ReaderPassageTab }
  | { name: 'passage-source'; passageId: string }
  | { name: 'discussions' }
  | { name: 'discussion-new'; bookId: string | null; passageId: string | null; question: string }
  | { name: 'discussion'; discussionId: string; composerIntent?: ReaderComposerIntent; focusMessageId?: string }
  | { name: 'discussion-reader'; discussionId: string; messageId: string }
  | { name: 'discussion-favorites' }
  | { name: 'discussion-trash' }
  | { name: 'settings' };

export type ReaderPrimaryRoute = Extract<ReaderRoute, { name: ReaderPrimaryName }>;
export type ReaderDetailRoute = Exclude<ReaderRoute, ReaderPrimaryRoute>;
export type ReaderRouteParams = Record<string, string | string[] | undefined>;

/** Route params stay serializable; page-local state is owned by the mounted screen. */
export function readerRouteHref(route: ReaderDetailRoute) {
  switch (route.name) {
    case 'search': return { pathname: '/search' as const, params: { bookId: route.bookId ?? undefined } };
    case 'book': return { pathname: '/books/[bookId]' as const, params: { bookId: route.bookId, tab: route.tab, endSession: route.endSession ? '1' : undefined } };
    case 'book-form': return route.bookId
      ? { pathname: '/books/[bookId]/edit' as const, params: { bookId: route.bookId } }
      : { pathname: '/books/new' as const, params: {} };
    case 'book-trash': return { pathname: '/books/[bookId]/trash' as const, params: { bookId: route.bookId } };
    case 'book-reading': return { pathname: '/books/[bookId]/reading' as const, params: { bookId: route.bookId } };
    case 'passage-capture': return { pathname: '/books/[bookId]/capture' as const, params: { bookId: route.bookId } };
    case 'reader-trash': return { pathname: '/settings/trash' as const, params: {} };
    case 'passage': return { pathname: '/passages/[passageId]' as const, params: { passageId: route.passageId, tab: route.tab } };
    case 'passage-source': return { pathname: '/passages/[passageId]/source' as const, params: { passageId: route.passageId } };
    case 'discussion-new': return { pathname: '/discussions/new' as const, params: { bookId: route.bookId ?? undefined, passageId: route.passageId ?? undefined, question: route.question } };
    case 'discussion': return {
      pathname: '/discussions/[discussionId]' as const,
      params: {
        discussionId: route.discussionId,
        intentId: route.composerIntent?.id,
        intentQuestion: route.composerIntent?.question,
        focusMessageId: route.focusMessageId,
      },
    };
    case 'discussion-reader': return { pathname: '/discussions/[discussionId]/messages/[messageId]' as const, params: { discussionId: route.discussionId, messageId: route.messageId } };
    case 'discussion-favorites': return { pathname: '/discussions/favorites' as const, params: {} };
    case 'discussion-trash': return { pathname: '/discussions/trash' as const, params: {} };
  }
}

export function readerRouteFromParams(name: ReaderDetailRoute['name'], params: ReaderRouteParams): ReaderDetailRoute | null {
  const param = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) || undefined;
  };
  const route = normalizeReaderRoute({
    name,
    bookId: param('bookId') ?? (name === 'book-form' || name === 'discussion-new' || name === 'search' ? null : undefined),
    passageId: param('passageId') ?? (name === 'discussion-new' ? null : undefined),
    discussionId: param('discussionId'),
    messageId: param('messageId'),
    tab: param('tab'),
    endSession: param('endSession') === '1',
    question: param('question') ?? '',
    composerIntent: { id: param('intentId'), question: param('intentQuestion') ?? '' },
    focusMessageId: param('focusMessageId'),
  });
  return route && !isPrimaryRoute(route) ? route : null;
}

/** Tab changes and consumed intents update params, not the navigation stack. */
export function isSameReaderPage(current: ReaderDetailRoute, next: ReaderDetailRoute): boolean {
  const left = readerRouteHref(current);
  const right = readerRouteHref(next);
  if (left.pathname !== right.pathname) return false;
  return ['bookId', 'passageId', 'discussionId', 'messageId'].every((key) => (
    !left.pathname.includes(`[${key}]`)
    || (left.params as ReaderRouteParams)[key] === (right.params as ReaderRouteParams)[key]
  ));
}

export function primaryOf(route: ReaderRoute): ReaderPrimaryName {
  if (route.name.startsWith('discussion')) return 'discussions';
  if (route.name.startsWith('settings')) return 'settings';
  return 'library';
}

export function isPrimaryRoute(route: ReaderRoute): route is ReaderPrimaryRoute {
  return route.name === 'library' || route.name === 'discussions' || route.name === 'settings';
}

export function shouldShowReaderPrimaryPane(route: ReaderRoute, wide: boolean): boolean {
  return route.name !== 'discussion-reader' && (wide || isPrimaryRoute(route));
}

export function primaryRoute(name: ReaderPrimaryName): ReaderRoute {
  return { name };
}

export function normalizeReaderRoute(value: unknown): ReaderRoute | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  switch (value.name) {
    case 'library':
    case 'search':
    case 'reader-trash':
    case 'discussions':
    case 'discussion-favorites':
    case 'discussion-trash':
    case 'settings':
      return value.name === 'search'
        ? { name: 'search', bookId: typeof value.bookId === 'string' ? value.bookId : null }
        : { name: value.name };
    case 'book':
      return typeof value.bookId === 'string' ? {
        name: value.name,
        bookId: value.bookId,
        tab: value.tab === 'discussions' || value.tab === 'favorites' ? value.tab : 'passages',
        ...(value.endSession === true ? { endSession: true as const } : {}),
      } : null;
    case 'book-trash':
    case 'book-reading':
    case 'passage-capture':
      return typeof value.bookId === 'string' ? { name: value.name, bookId: value.bookId } : null;
    case 'book-form':
      return value.bookId === null || typeof value.bookId === 'string'
        ? { name: value.name, bookId: value.bookId }
        : null;
    case 'passage':
      return typeof value.passageId === 'string' ? {
        name: value.name,
        passageId: value.passageId,
        tab: value.tab === 'discussions' ? 'discussions' : 'questions',
      } : null;
    case 'passage-source':
      return typeof value.passageId === 'string' ? { name: value.name, passageId: value.passageId } : null;
    case 'discussion-new':
      if (value.bookId !== null && typeof value.bookId !== 'string') return null;
      if (value.passageId !== null && typeof value.passageId !== 'string') return null;
      return {
        name: value.name,
        bookId: value.bookId,
        passageId: value.passageId,
        question: typeof value.question === 'string' ? value.question.slice(0, 2_000) : '',
      };
    case 'discussion':
      if (typeof value.discussionId !== 'string') return null;
      if (value.name === 'discussion') {
        const composerIntent = normalizeReaderComposerIntent(value.composerIntent);
        return {
          name: value.name,
          discussionId: value.discussionId,
          ...(composerIntent ? { composerIntent } : {}),
          ...(typeof value.focusMessageId === 'string' ? { focusMessageId: value.focusMessageId } : {}),
        };
      }
      return { name: value.name, discussionId: value.discussionId };
    case 'discussion-reader':
      return typeof value.discussionId === 'string' && typeof value.messageId === 'string'
        ? { name: value.name, discussionId: value.discussionId, messageId: value.messageId }
        : null;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
