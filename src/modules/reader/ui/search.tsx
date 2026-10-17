import { BookOpen, FileText, MessageCircle, Search as SearchIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';

import type { ReaderSearchRepository } from '../application/ports';
import type { ReaderSearchResult, ReaderSearchResultKind } from '../domain/model';
import { passageLocationLabel } from '../domain/rules';
import {
  ReaderChip,
  ReaderDetailPane,
  ReaderEmpty,
  ReaderError,
  ReaderButton,
  ReaderHeader,
  ReaderSearch,
  ReaderScroll,
  ReaderSkeletonRows,
} from './reader-ui';

type SearchKind = ReaderSearchResultKind | 'all';

export function ReaderSearchScreen({ repository, bookId, wide, onBack, onOpenBook, onOpenPassage, onOpenDiscussion }: {
  repository: ReaderSearchRepository;
  bookId: string | null;
  wide: boolean;
  onBack: () => void;
  onOpenBook: (id: string) => void;
  onOpenPassage: (id: string) => void;
  onOpenDiscussion: (id: string, messageId?: string) => void;
}) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind>('all');
  const [results, setResults] = useState<readonly ReaderSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const requestId = useRef(0);
  useEffect(() => {
    const value = query.trim();
    const id = requestId.current + 1;
    requestId.current = id;
    if (!value) {
      const timer = setTimeout(() => {
        setResults([]);
        setLoading(false);
        setLoadingMore(false);
        setHasMore(false);
        setError(null);
      }, 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setResults([]);
      setLoading(true);
      setLoadingMore(false);
      setHasMore(false);
      setError(null);
      void repository.search(value, kind, bookId, 80, 0)
        .then((next) => {
          if (requestId.current === id) {
            setResults(next);
            setHasMore(next.length === 80);
          }
        })
        .catch((cause: unknown) => {
          if (requestId.current === id) setError(cause instanceof Error ? cause.message : '搜索失败');
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [bookId, kind, query, repository, retryToken]);

  const loadMore = () => {
    const value = query.trim();
    if (!value || !hasMore || loading || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    void repository.search(value, kind, bookId, 80, results.length)
      .then((next) => {
        if (requestId.current !== id) return;
        setResults((current) => [...current, ...next]);
        setHasMore(next.length === 80);
      })
      .catch((cause: unknown) => {
        if (requestId.current === id) setError(cause instanceof Error ? cause.message : '加载更多失败');
      })
      .finally(() => {
        if (requestId.current === id) setLoadingMore(false);
      });
  };

  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader onBack={onBack} subtitle={bookId ? '当前书籍' : '书籍、摘录和讨论'} title="搜索" />
      <ReaderSearch onChangeText={setQuery} placeholder="搜索书名、摘录、摘要或讨论" value={query} />
      <View style={styles.filters}>
        {([['all', '全部'], ['book', '书籍'], ['passage', '摘录'], ['discussion', '讨论'], ['message', '回答']] as const).map(([value, label]) => (
          <ReaderChip key={value} label={label} onPress={() => setKind(value)} selected={kind === value} />
        ))}
      </View>
      {error ? <ReaderError message={error} onRetry={() => setRetryToken((value) => value + 1)} /> : null}
      {!query.trim() ? <ReaderEmpty detail="搜索完整书籍资料、摘录原文、摘要和讨论历史。" icon={SearchIcon} title="查找你的阅读记录" />
        : loading ? <ReaderSkeletonRows count={5} />
          : results.length ? <ReaderScroll style={styles.list}>
            {results.map((result) => <SearchRow key={`${result.kind}:${result.id}`} onOpenBook={onOpenBook} onOpenDiscussion={onOpenDiscussion} onOpenPassage={onOpenPassage} result={result} />)}
            {hasMore ? <ReaderButton disabled={loadingMore} label={loadingMore ? '正在加载' : '加载更多'} onPress={loadMore} secondary /> : null}
          </ReaderScroll>
            : <ReaderEmpty detail="换个关键词或切换内容范围。" icon={SearchIcon} title="没有找到匹配内容" />}
    </ReaderDetailPane>
  );
}

function SearchRow({ result, onOpenBook, onOpenPassage, onOpenDiscussion }: {
  result: ReaderSearchResult;
  onOpenBook: (id: string) => void;
  onOpenPassage: (id: string) => void;
  onOpenDiscussion: (id: string, messageId?: string) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const Icon = result.kind === 'book' ? BookOpen : result.kind === 'passage' ? FileText : MessageCircle;
  const open = () => {
    if (result.kind === 'book') onOpenBook(result.id);
    else if (result.kind === 'passage') onOpenPassage(result.id);
    else if (result.discussionId) onOpenDiscussion(result.discussionId, result.kind === 'message' ? result.id : undefined);
  };
  const subtitle = [result.subtitle, result.pageLabel ? passageLocationLabel(result.pageLabel) : ''].filter(Boolean).join(' · ');
  const preview = result.sourceMatch ? `识别文字中有匹配${result.preview ? ` · ${result.preview}` : ''}` : result.preview;
  return (
    <Pressable accessibilityLabel={`打开搜索结果：${result.title}`} accessibilityRole="button" onPress={open} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {result.imageUri ? <Image resizeMode="cover" source={{ uri: result.imageUri }} style={styles.thumbnail} /> : <View style={styles.icon}><Icon color={palette.brand} size={20} /></View>}
      <View style={styles.copy}>
        <View style={styles.titleLine}><Text numberOfLines={1} style={styles.title}>{result.title}</Text><Text style={styles.kind}>{kindLabel(result.kind)}</Text></View>
        {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
        <Text numberOfLines={3} style={styles.preview}>{preview || '没有可显示的摘要。'}</Text>
      </View>
    </Pressable>
  );
}

function kindLabel(kind: ReaderSearchResultKind): string {
  if (kind === 'book') return '书籍';
  if (kind === 'passage') return '摘录';
  if (kind === 'discussion') return '讨论';
  return '回答';
}

function useStyles() { return useThemedStyles(createStyles); }

function createStyles(palette: Palette) {
  return StyleSheet.create({
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    list: { paddingBottom: spacing.xxl },
    row: { alignItems: 'flex-start', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 96, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    thumbnail: { backgroundColor: palette.surfaceMuted, borderRadius: radius.control, height: 70, width: 52 },
    icon: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.control, height: 48, justifyContent: 'center', width: 48 },
    copy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    titleLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    title: { color: palette.text, flex: 1, fontSize: 15, fontWeight: '700' },
    kind: { color: palette.textSubtle, fontSize: 11 },
    subtitle: { color: palette.textMuted, fontSize: 12 },
    preview: { color: palette.textMuted, fontSize: 13, lineHeight: 19 },
    pressed: { opacity: 0.66 },
  });
}
