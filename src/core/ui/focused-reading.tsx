import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { localState } from '@/core/storage/local-state';
import {
  DEFAULT_FOCUSED_READING_PREFERENCES,
  focusedReadingPageCapacity,
  normalizeFocusedReadingPreferences,
  paginateFocusedContent,
  readingContentRevision,
  type FocusedReadingPreferences,
} from './focused-reading-core';
import { AppMarkdown } from './markdown';
import { useReadingProgress } from './conversation-progress';

export type { FocusedReadingFontFamily, FocusedReadingMode, FocusedReadingPageCapacity, FocusedReadingPreferences } from './focused-reading-core';
export { focusedReadingPageCapacity, normalizeFocusedReadingPreferences, paginateFocusedContent, readingContentRevision } from './focused-reading-core';

const STORAGE_KEY = 'reader.focused-reading.v1';
const DEFAULTS = DEFAULT_FOCUSED_READING_PREFERENCES;

let cached: FocusedReadingPreferences | null = null;
let loading: Promise<FocusedReadingPreferences> | null = null;
const listeners = new Set<(value: FocusedReadingPreferences) => void>();

export function useFocusedReadingPreferences() {
  const [value, setValue] = useState(cached ?? DEFAULTS);
  useEffect(() => {
    listeners.add(setValue);
    void loadPreferences().then(setValue);
    return () => { listeners.delete(setValue); };
  }, []);
  const update = useCallback(async (patch: Partial<FocusedReadingPreferences>) => {
    const next = normalizeFocusedReadingPreferences({ ...value, ...patch });
    cached = next;
    for (const listener of listeners) listener(next);
    await localState.setItem(STORAGE_KEY, JSON.stringify(next));
  }, [value]);
  return { value, update };
}

export function FocusedReadingContent({
  content,
  progressKey,
  workspaceId,
  preferences,
}: {
  content: string;
  progressKey: string;
  workspaceId: string;
  preferences: FocusedReadingPreferences;
}) {
  const { palette } = useAppTheme();
  const progress = useReadingProgress(workspaceId, progressKey);
  const scrollRef = useRef<ScrollView>(null);
  const pagerRef = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const revision = useMemo(() => readingContentRevision(content), [content]);
  const capacity = useMemo(() => focusedReadingPageCapacity(viewport.width, viewport.height, preferences), [preferences, viewport]);
  const pages = useMemo(() => paginateFocusedContent(content, capacity), [capacity, content]);
  const initialized = useRef<string | null>(null);
  const identity = `${progressKey}:${revision}:${preferences.mode}:${viewport.width}:${viewport.height}:${preferences.mode === 'scroll' ? scrollContentHeight : pages.length}`;

  useEffect(() => {
    if (!progress.hydrated || viewport.width <= 0 || viewport.height <= 0
      || (preferences.mode === 'scroll' && scrollContentHeight <= 0)
      || initialized.current === identity) return;
    initialized.current = identity;
    const recorded = progress.value;
    const sameContent = recorded?.contentRevision === revision;
    const normalized = sameContent ? recorded.normalizedProgress : 0;
    if (preferences.mode === 'paged') {
      const index = Math.max(0, Math.min(pages.length - 1, Math.round(normalized * Math.max(0, pages.length - 1))));
      requestAnimationFrame(() => pagerRef.current?.scrollTo({ animated: false, x: index * viewport.width }));
      void progress.patch({ contentRevision: revision, pageIndex: index, normalizedProgress: normalized }).catch(() => undefined);
    } else {
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y: normalized * Math.max(0, scrollContentHeight - viewport.height) }));
      void progress.patch({ contentRevision: revision, pageIndex: 0, normalizedProgress: normalized }).catch(() => undefined);
    }
  }, [identity, pages.length, preferences.mode, progress, revision, scrollContentHeight, viewport]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width: Math.round(width), height: Math.round(height) });
  };
  const saveScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const max = Math.max(1, contentSize.height - layoutMeasurement.height);
    void progress.patch({ contentRevision: revision, normalizedProgress: Math.max(0, Math.min(1, contentOffset.y / max)) }).catch(() => undefined);
  };
  const savePage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(pages.length - 1, Math.round(event.nativeEvent.contentOffset.x / Math.max(1, viewport.width))));
    void progress.patch({ contentRevision: revision, pageIndex: index, normalizedProgress: pages.length <= 1 ? 0 : index / (pages.length - 1) }).catch(() => undefined);
  };

  return <View onLayout={onLayout} style={styles.frame}>
    {viewport.width > 0 && viewport.height > 0 ? preferences.mode === 'paged' ? (
      <ScrollView horizontal onMomentumScrollEnd={savePage} pagingEnabled ref={pagerRef} showsHorizontalScrollIndicator={false}>
        {pages.map((page, index) => {
          const body = (
            <View style={{ paddingHorizontal: preferences.pageMargin, paddingTop: 18, paddingBottom: 10 }}>
              <AppMarkdown content={page.content} fontSize={preferences.fontSize} serif={preferences.fontFamily === 'serif'} />
            </View>
          );
          return (
            <View
              key={`${index}-${page.content.slice(0, 24)}`}
              style={[styles.page, { backgroundColor: palette.canvas, height: viewport.height, width: viewport.width }]}
            >
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.pageScrollContent}
                showsVerticalScrollIndicator={page.oversized}
                style={styles.pageScroll}
              >
                {body}
              </ScrollView>
              {pages.length > 1 ? (
                <View style={styles.pageFooter}>
                  <Text style={[styles.pageNumber, { color: palette.textSubtle }]}>
                    {index + 1} / {pages.length}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    ) : (
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: preferences.pageMargin, paddingVertical: 20 }}
        onContentSizeChange={(_width, height) => setScrollContentHeight(Math.round(height))}
        onMomentumScrollEnd={saveScroll}
        onScrollEndDrag={saveScroll}
        ref={scrollRef}
        scrollEventThrottle={64}
      >
              <AppMarkdown content={content} fontSize={preferences.fontSize} serif={preferences.fontFamily === 'serif'} />
      </ScrollView>
    ) : null}
  </View>;
}

async function loadPreferences(): Promise<FocusedReadingPreferences> {
  if (cached) return cached;
  if (loading) return loading;
  loading = localState.getItem(STORAGE_KEY).then((raw) => {
    if (!raw) return DEFAULTS;
    try { return normalizeFocusedReadingPreferences(JSON.parse(raw) as unknown); }
    catch { return DEFAULTS; }
  }).catch(() => DEFAULTS).then((value) => {
    cached = value;
    loading = null;
    return value;
  });
  return loading;
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0 },
  page: { flex: 1, overflow: 'hidden' },
  pageScroll: { flex: 1 },
  pageScrollContent: { flexGrow: 1 },
  pageFooter: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    paddingBottom: 4,
  },
  pageNumber: {
    fontSize: 11,
  },
});
