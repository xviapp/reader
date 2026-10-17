import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown } from 'lucide-react-native';
import {
  AppState,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius } from '@/core/design/tokens';
import { UnreadDot } from './ai-activity';
import {
  conversationAnchorForOffset,
  conversationCheckpointForViewport,
  conversationHasUnread,
  conversationRestoreCanProceed,
  CONVERSATION_LATEST_THRESHOLD,
  type ConversationItemLayout,
  latestConversationItemIsReadable,
  offsetForConversationAnchor,
  shouldRestoreConversationAnchor,
} from './conversation-progress-core';
import { type ReadingProgressPatch, useReadingProgress } from './conversation-progress';

const SAVE_DELAY_MS = 160;
const RESTORE_LAYOUT_DEADLINE_MS = 700;

interface ConversationLayoutRegistry {
  register(id: string, layout: ConversationItemLayout): void;
  unregister(id: string): void;
}

const ConversationLayoutContext = createContext<ConversationLayoutRegistry | null>(null);

export function ConversationViewport({
  active = true,
  children,
  contentContainerStyle,
  conversationKey,
  focusMessageId,
  followLatestToken,
  latestReadableMessageId,
  messageIds,
  onLatestRead,
  workspaceId,
}: PropsWithChildren<{
  active?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  conversationKey: string;
  focusMessageId?: string;
  followLatestToken?: number | string;
  latestReadableMessageId: string | null;
  messageIds: readonly string[];
  onLatestRead?: (messageId: string) => void;
  workspaceId: string;
}>) {
  const identity = `${workspaceId}:${conversationKey}`;
  const { palette } = useAppTheme();
  const progress = useReadingProgress(workspaceId, conversationKey);
  const activeRef = useRef(active);
  const patchProgress = progress.patch;
  const scrollRef = useRef<ScrollView>(null);
  const layouts = useRef(new Map<string, ConversationItemLayout>());
  const viewportHeight = useRef(0);
  const viewportOffset = useRef(0);
  const contentHeight = useRef(0);
  const following = useRef(true);
  const suppressScroll = useRef(false);
  const restoredIdentity = useRef<string | null>(null);
  const focusedToken = useRef<string | null>(null);
  const followedToken = useRef<number | string | undefined>(followLatestToken);
  const followLatestTokenRef = useRef(followLatestToken);
  const pendingFollowLatest = useRef(false);
  const notifiedReadId = useRef<string | null>(null);
  const pendingPatch = useRef<ReadingProgressPatch | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestReadableIdRef = useRef(latestReadableMessageId);
  const onLatestReadRef = useRef(onLatestRead);
  const tryRestoreRef = useRef<() => void>(() => undefined);
  const [revealedIdentity, setRevealedIdentity] = useState<string | null>(null);
  const [showLatestIdentity, setShowLatestIdentity] = useState<string | null>(null);
  const [restoreDeadlineIdentity, setRestoreDeadlineIdentity] = useState<string | null>(null);
  const revealed = revealedIdentity === identity;
  const showLatest = showLatestIdentity === identity;
  const restoreDeadlineReached = restoreDeadlineIdentity === identity;
  const latestUnread = progress.hydrated
    && conversationHasUnread(progress.value, latestReadableMessageId);
  const setShowLatest = useCallback((visible: boolean) => {
    setShowLatestIdentity(visible ? identity : null);
  }, [identity]);

  useEffect(() => {
    latestReadableIdRef.current = latestReadableMessageId;
    onLatestReadRef.current = onLatestRead;
    followLatestTokenRef.current = followLatestToken;
  }, [followLatestToken, latestReadableMessageId, onLatestRead]);

  const flushPatch = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const patch = pendingPatch.current;
    pendingPatch.current = null;
    if (patch) void patchProgress(patch).catch(() => undefined);
  }, [patchProgress]);

  const queuePatch = useCallback((patch: ReadingProgressPatch) => {
    if (!activeRef.current) return;
    pendingPatch.current = { ...(pendingPatch.current ?? {}), ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushPatch, SAVE_DELAY_MS);
  }, [flushPatch]);

  const markLatestRead = useCallback(() => {
    if (!activeRef.current) return;
    const latestId = latestReadableIdRef.current;
    if (!latestId) return;
    queuePatch({ readId: latestId });
    if (notifiedReadId.current === latestId) return;
    notifiedReadId.current = latestId;
    onLatestReadRef.current?.(latestId);
  }, [queuePatch]);

  const queueCurrentAnchor = useCallback((atLatest: boolean) => {
    const top = Math.max(0, contentHeight.current - viewportHeight.current);
    viewportOffset.current = top;
    const anchor = conversationAnchorForOffset([...layouts.current.values()], top + 4);
    queuePatch({ ...anchor, atLatest });
  }, [queuePatch]);

  const queueFinalViewport = useCallback(() => {
    if (!activeRef.current) return;
    if (restoredIdentity.current !== identity || viewportHeight.current <= 0 || contentHeight.current <= 0) return;
    const checkpoint = conversationCheckpointForViewport({
      contentHeight: contentHeight.current,
      latestReadableId: latestReadableIdRef.current,
      layouts: [...layouts.current.values()],
      viewportHeight: viewportHeight.current,
      viewportOffset: viewportOffset.current,
    });
    pendingPatch.current = { ...(pendingPatch.current ?? {}), ...checkpoint };
    if (!checkpoint.readId || notifiedReadId.current === checkpoint.readId) return;
    notifiedReadId.current = checkpoint.readId;
    onLatestReadRef.current?.(checkpoint.readId);
  }, [identity]);

  const revealAfterPositioning = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (restoredIdentity.current !== identity) return;
      suppressScroll.current = false;
      setRevealedIdentity(identity);
    }));
  }, [identity]);

  const settleRestoredOffset = useCallback((offset: number) => {
    const clampedOffset = Math.max(0, Math.min(offset, contentHeight.current - viewportHeight.current));
    viewportOffset.current = clampedOffset;
    const atLatest = contentHeight.current - clampedOffset - viewportHeight.current <= CONVERSATION_LATEST_THRESHOLD;
    following.current = atLatest;
    setShowLatest(!atLatest);
    const latestId = latestReadableIdRef.current;
    const latestLayout = latestId ? layouts.current.get(latestId) ?? null : null;
    if (atLatest || latestConversationItemIsReadable(latestLayout, clampedOffset, viewportHeight.current)) {
      markLatestRead();
    }
  }, [markLatestRead, setShowLatest]);

  const scrollToEnd = useCallback((animated: boolean) => {
    if (!activeRef.current) return;
    suppressScroll.current = !animated;
    scrollRef.current?.scrollToEnd({ animated });
    following.current = true;
    setShowLatest(false);
    queueCurrentAnchor(true);
    markLatestRead();
    if (!animated) revealAfterPositioning();
  }, [markLatestRead, queueCurrentAnchor, revealAfterPositioning, setShowLatest]);

  const tryRestore = useCallback(() => {
    if (!activeRef.current) return;
    if (!progress.hydrated || restoredIdentity.current === identity || viewportHeight.current <= 0) return;
    if (messageIds.length === 0) {
      restoredIdentity.current = identity;
      following.current = true;
      queuePatch({ anchorId: null, anchorOffset: 0, anchorIndex: 0, atLatest: true, readId: latestReadableMessageId });
      revealAfterPositioning();
      return;
    }
    const measuredLayouts = [...layouts.current.values()];
    const allLayoutsMeasured = messageIds.every((id) => layouts.current.has(id));
    if (!conversationRestoreCanProceed(messageIds, measuredLayouts, restoreDeadlineReached)) return;
    if (pendingFollowLatest.current) {
      pendingFollowLatest.current = false;
      restoredIdentity.current = identity;
      scrollToEnd(false);
      return;
    }
    const recorded = progress.value;
    const focusedLayout = focusMessageId ? layouts.current.get(focusMessageId) : null;
    if (focusMessageId && focusedLayout) {
      restoredIdentity.current = identity;
      focusedToken.current = `${identity}:${focusMessageId}`;
      const offset = Math.max(0, Math.min(focusedLayout.y - 20, contentHeight.current - viewportHeight.current));
      settleRestoredOffset(offset);
      suppressScroll.current = true;
      scrollRef.current?.scrollTo({ animated: false, y: offset });
      queuePatch({ anchorId: focusMessageId, anchorOffset: 0, anchorIndex: Math.max(0, messageIds.indexOf(focusMessageId)), atLatest: false });
      revealAfterPositioning();
      return;
    }
    if (shouldRestoreConversationAnchor(recorded)) {
      const offset = offsetForConversationAnchor(recorded!, measuredLayouts, messageIds);
      if (offset === null) {
        if (allLayoutsMeasured) return;
      } else {
        const clampedOffset = Math.max(0, Math.min(offset, contentHeight.current - viewportHeight.current));
        restoredIdentity.current = identity;
        settleRestoredOffset(clampedOffset);
        suppressScroll.current = true;
        scrollRef.current?.scrollTo({ animated: false, y: clampedOffset });
        revealAfterPositioning();
        return;
      }
    }
    if (contentHeight.current <= 0) return;
    restoredIdentity.current = identity;
    if (!allLayoutsMeasured && recorded?.atLatest === false) {
      settleRestoredOffset(0);
      suppressScroll.current = true;
      scrollRef.current?.scrollTo({ animated: false, y: 0 });
      revealAfterPositioning();
    } else {
      scrollToEnd(false);
    }
  }, [focusMessageId, identity, latestReadableMessageId, messageIds, progress.hydrated, progress.value, queuePatch, restoreDeadlineReached, revealAfterPositioning, scrollToEnd, settleRestoredOffset]);
  useEffect(() => {
    tryRestoreRef.current = tryRestore;
  }, [tryRestore]);

  const registerLayout = useCallback((id: string, layout: ConversationItemLayout) => {
    layouts.current.set(id, layout);
    requestAnimationFrame(() => tryRestoreRef.current());
  }, []);
  const unregisterLayout = useCallback((id: string) => {
    layouts.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    layouts.current.clear();
    contentHeight.current = 0;
    restoredIdentity.current = null;
    focusedToken.current = null;
    notifiedReadId.current = null;
    following.current = true;
    suppressScroll.current = false;
    pendingFollowLatest.current = false;
    followedToken.current = followLatestTokenRef.current;
    return () => {
      queueFinalViewport();
      flushPatch();
    };
  }, [flushPatch, identity, queueFinalViewport]);

  useLayoutEffect(() => {
    activeRef.current = active;
    return () => {
      if (activeRef.current) {
        queueFinalViewport();
        flushPatch();
      }
      activeRef.current = false;
    };
  }, [active, flushPatch, queueFinalViewport]);

  useEffect(() => {
    if (!progress.hydrated || revealed || messageIds.length === 0) return undefined;
    const timer = setTimeout(() => setRestoreDeadlineIdentity(identity), RESTORE_LAYOUT_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [identity, messageIds.length, progress.hydrated, revealed]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushPatch();
    });
    return () => subscription.remove();
  }, [flushPatch]);

  useEffect(() => {
    tryRestore();
  }, [active, tryRestore]);

  useEffect(() => {
    if (!active || !focusMessageId || restoredIdentity.current !== identity) return;
    const token = `${identity}:${focusMessageId}`;
    if (focusedToken.current === token) return;
    const layout = layouts.current.get(focusMessageId);
    if (!layout) return;
    focusedToken.current = token;
    following.current = false;
    setShowLatest(true);
    scrollRef.current?.scrollTo({ animated: true, y: Math.max(0, layout.y - 20) });
    queuePatch({ anchorId: focusMessageId, anchorOffset: 0, anchorIndex: Math.max(0, messageIds.indexOf(focusMessageId)), atLatest: false });
  }, [active, focusMessageId, identity, messageIds, queuePatch, setShowLatest]);

  useEffect(() => {
    if (!active || followLatestToken === undefined || followedToken.current === followLatestToken) return;
    followedToken.current = followLatestToken;
    if (restoredIdentity.current !== identity) {
      pendingFollowLatest.current = true;
      return;
    }
    scrollToEnd(true);
  }, [active, followLatestToken, identity, scrollToEnd]);

  useEffect(() => {
    if (active && restoredIdentity.current === identity && following.current) {
      requestAnimationFrame(() => scrollToEnd(false));
    }
  }, [active, identity, latestReadableMessageId, messageIds.length, scrollToEnd]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!activeRef.current || restoredIdentity.current !== identity || suppressScroll.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const offset = Math.max(0, contentOffset.y);
    viewportOffset.current = offset;
    const checkpoint = conversationCheckpointForViewport({
      contentHeight: contentSize.height,
      latestReadableId: latestReadableIdRef.current,
      layouts: [...layouts.current.values()],
      viewportHeight: layoutMeasurement.height,
      viewportOffset: offset,
    });
    const atLatest = checkpoint.atLatest;
    following.current = atLatest;
    setShowLatest(!atLatest);
    queuePatch(checkpoint);
    if (checkpoint.readId) markLatestRead();
  }, [identity, markLatestRead, queuePatch, setShowLatest]);

  useEffect(() => {
    if (!active || restoredIdentity.current !== identity || !latestReadableMessageId) return;
    const frame = requestAnimationFrame(() => {
      const latestLayout = layouts.current.get(latestReadableMessageId) ?? null;
      const atLatest = contentHeight.current - viewportOffset.current - viewportHeight.current <= CONVERSATION_LATEST_THRESHOLD;
      if (atLatest || latestConversationItemIsReadable(
        latestLayout,
        viewportOffset.current,
        viewportHeight.current,
      )) markLatestRead();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, identity, latestReadableMessageId, markLatestRead, messageIds.length]);

  const contextValue = useMemo<ConversationLayoutRegistry>(() => ({
    register: registerLayout,
    unregister: unregisterLayout,
  }), [registerLayout, unregisterLayout]);
  return (
    <View style={styles.frame}>
      <ScrollView
        contentContainerStyle={contentContainerStyle}
        importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
          tryRestoreRef.current();
          if (restoredIdentity.current === identity && following.current) scrollToEnd(false);
        }}
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
          tryRestoreRef.current();
        }}
        onScroll={onScroll}
        ref={scrollRef}
        scrollEnabled={revealed}
        scrollEventThrottle={32}
        style={!revealed ? styles.hidden : undefined}
      >
        <ConversationLayoutContext.Provider value={contextValue}>
          {children}
        </ConversationLayoutContext.Provider>
      </ScrollView>
      {!revealed ? (
        <View pointerEvents="none" style={[styles.restoreMask, { backgroundColor: palette.canvas }]}>
          <View style={[styles.restoreLine, styles.restoreLineShort, { backgroundColor: palette.surfaceSoft }]} />
          <View style={[styles.restoreLine, { backgroundColor: palette.surfaceSoft }]} />
          <View style={[styles.restoreLine, styles.restoreLineMedium, { backgroundColor: palette.surfaceSoft }]} />
        </View>
      ) : null}
      {showLatest ? (
        <View pointerEvents="box-none" style={styles.latestDock}>
          <Pressable
            accessibilityLabel="回到最新消息"
            accessibilityRole="button"
            onPress={() => scrollToEnd(true)}
            style={({ pressed }) => [
              styles.latestButton,
              { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: radius.pill },
              pressed && styles.pressed,
            ]}
          >
            <ChevronDown color={palette.textMuted} size={21}  strokeWidth={iconography.stroke} />
            {latestUnread ? <View style={styles.latestUnread}><UnreadDot /></View> : null}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ConversationAnchor({ id, children }: PropsWithChildren<{ id: string }>) {
  const registry = useContext(ConversationLayoutContext);
  useEffect(() => () => registry?.unregister(id), [id, registry]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    registry?.register(id, { id, y, height });
  }, [id, registry]);
  return <View onLayout={onLayout}>{children}</View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0 },
  hidden: { opacity: 0 },
  latestDock: { alignItems: 'flex-end', bottom: 12, left: 0, paddingHorizontal: 14, position: 'absolute', right: 0 },
  latestButton: { alignItems: 'center', borderWidth: 1, elevation: 4, height: 40, justifyContent: 'center', width: 40 },
  latestUnread: { position: 'absolute', right: -1, top: -1 },
  restoreLine: { borderRadius: 8, height: 72, opacity: 0.78, width: '78%' },
  restoreLineMedium: { alignSelf: 'flex-end', width: '64%' },
  restoreLineShort: { width: '52%' },
  restoreMask: { bottom: 0, gap: 14, left: 0, padding: 18, position: 'absolute', right: 0, top: 0 },
  pressed: { opacity: 0.7 },
});
