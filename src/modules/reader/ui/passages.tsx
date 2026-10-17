import {
  Camera,
  FileText,
  Eye,
  EyeOff,
  Languages,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RotateCw,
  Save,
  ScanText,
  Settings,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import type { MediaLibrary, StoredImage } from '@/core/media/media-library';
import type { OcrEngine } from '@/core/ocr/ocr-engine';
import { ActionMenu, type ActionMenuItem } from '@/core/ui/action-menu';
import { ActionSheet } from '@/core/ui/action-sheet';
import { AiActivityDots } from '@/core/ui/ai-activity';
import { FormSheet } from '@/core/ui/app-controls';

import type { ReaderAiCoordinator } from '../application/reader-ai';
import type { ReaderLibraryRepository, ReaderTaskRepository } from '../application/ports';
import type {
  ReaderBook,
  ReaderDiscussion,
  ReaderOcrScript,
  ReaderPassage,
  ReaderPassageOrganizationCandidate,
  ReaderPassageDraft,
  ReaderPreferences,
} from '../domain/model';
import { passageDisplayTitle } from '../domain/rules';
import { ReaderDiscussionRow } from './discussions';
import { searchReaderDiscussions } from './discussion-flow';
import type { ReaderPassageTab } from './navigation';
import {
  ReaderButton,
  ReaderDetailPane,
  ReaderEmpty,
  ReaderError,
  ReaderField,
  ReaderHeader,
  ReaderIconButton,
  ReaderScroll,
  ReaderSearch,
  ReaderSkeletonRows,
} from './reader-ui';
import { ReaderFlatTabs } from './reader-tabs';
import { ReaderPassageSummary } from './passage-summary';
import { useReaderPassageActions } from './passage-actions';
import { useReaderDraftGuard } from './reader-draft-guard';

interface PassageCaptureState extends ReaderPassageDraft {
  step: 'source' | 'review';
}

type PassageCaptureRetry =
  | { kind: 'select'; source: 'camera' | 'library' }
  | { kind: 'recognize'; imageUri: string; script: ReaderOcrScript; fillWhenEmpty: boolean }
  | { kind: 'rotate' }
  | { kind: 'save'; analyze: boolean; continueCapture?: boolean };

type PassageSourceRetry = { kind: 'save' };

export function ReaderPassageCaptureScreen({ book, preferences, media, ocr, repository, ai, aiAvailable, wide, onBack, onSaved, onAnalysisError, onConfigureAi }: {
  book: ReaderBook;
  preferences: ReaderPreferences | null;
  media: MediaLibrary;
  ocr: OcrEngine;
  repository: ReaderLibraryRepository;
  ai: ReaderAiCoordinator | null;
  aiAvailable: boolean;
  wide: boolean;
  onBack: () => void;
  onSaved: (id: string) => void;
  onAnalysisError?: (message: string) => void;
  onConfigureAi?: () => void;
}) {
  const styles = useStyles();
  const [draft, setDraft] = useState<PassageCaptureState>(() => emptyCaptureState(preferences?.ocrScript ?? 'auto'));
  const [dirty, setDirty] = useState(false);
  const { step, imageUri, title, pageLabel, rawSourceText = '', sourceText, ocrBlocks, ocrScript } = draft;
  const updateDraft = (patch: Partial<PassageCaptureState>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const [recognizing, setRecognizing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<PassageCaptureRetry | null>(null);
  const close = () => onBack();
  const recognizeImage = async (uri: string, script: ReaderOcrScript, fillWhenEmpty: boolean) => {
    setRecognizing(true);
    setError(null);
    setRetryAction(null);
    try {
      const result = await ocr.recognize(uri, script);
      setDraft((current) => ({
        ...current,
        rawSourceText: result.fullText,
        sourceText: fillWhenEmpty || !current.sourceText.trim() ? result.fullText : current.sourceText,
        ocrBlocks: result.blocks,
        ocrScript: result.script,
      }));
    } catch (cause) {
      setError(`${messageOf(cause, '本地识别失败')}。你仍可手工录入并保存。`);
      setRetryAction({ kind: 'recognize', imageUri: uri, script, fillWhenEmpty });
    } finally { setRecognizing(false); }
  };
  const selectImage = async (source: 'camera' | 'library') => {
    setError(null);
    setRetryAction(null);
    try {
      const selected = await media.selectImage(source, 'document');
      if (!selected) return;
      if (imageUri) await media.deleteImage(imageUri);
      updateDraft({ imageUri: selected.uri, step: 'review' });
      await recognizeImage(selected.uri, ocrScript, true);
    } catch (cause) {
      setError(messageOf(cause, '无法读取书页图片'));
      setRetryAction({ kind: 'select', source });
    }
  };
  const rotateImage = async () => {
    if (!imageUri || recognizing || rotating || saving) return;
    const currentUri = imageUri;
    const fillWhenEmpty = !sourceText.trim() || sourceText === rawSourceText;
    setRotating(true);
    setError(null);
    setRetryAction(null);
    try {
      const rotated = await media.rotateImage(currentUri, 'document');
      updateDraft({ imageUri: rotated.uri, step: 'review' });
      await media.deleteImage(currentUri).catch(() => undefined);
      await recognizeImage(rotated.uri, ocrScript, fillWhenEmpty);
    } catch (cause) {
      setError(messageOf(cause, '书页图片旋转失败'));
      setRetryAction({ kind: 'rotate' });
    }
    finally { setRotating(false); }
  };
  const save = async (analyze: boolean, continueCapture = false) => {
    setSaving(true);
    setError(null);
    setRetryAction(null);
    try {
      const draft: ReaderPassageDraft = { title, pageLabel, imageUri, rawSourceText, sourceText, ocrScript, ocrBlocks };
      const id = await repository.createPassage(book.id, draft);
      const now = new Date().toISOString();
      const passage: ReaderPassage = {
        id, bookId: book.id, ...draft, summary: '', suggestedQuestions: [], analysisStatus: 'idle',
        rawSourceText: draft.rawSourceText ?? draft.sourceText,
        sourceRevision: 1, organizedSourceRevision: 0,
        analysisError: null, organizationStatus: 'idle', organizationError: null,
        createdAt: now, updatedAt: now, deletedAt: null,
      };
      if (analyze && ai && aiAvailable && sourceText.trim()) {
        void ai.analyzePassage(passage).catch((cause: unknown) => onAnalysisError?.(messageOf(cause, '分析任务未能开始')));
      }
      if (continueCapture) {
        setDraft(emptyCaptureState(ocrScript, nextPageLabel(pageLabel)));
        setDirty(false);
        setRawOpen(false);
      } else onSaved(id);
    } catch (cause) {
      setError(messageOf(cause, '保存摘录失败'));
      setRetryAction({ kind: 'save', analyze, continueCapture });
    }
    finally { setSaving(false); }
  };
  const requestClose = useReaderDraftGuard({
    dirty: dirty && Boolean(imageUri || title.trim() || pageLabel.trim() || sourceText.trim()),
    noun: '摘录',
    onBack: close,
    onSave: () => save(false),
    pending: saving || recognizing || rotating,
  });
  const retry = () => {
    if (retryAction?.kind === 'select') void selectImage(retryAction.source);
    else if (retryAction?.kind === 'recognize') void recognizeImage(retryAction.imageUri, retryAction.script, retryAction.fillWhenEmpty);
    else if (retryAction?.kind === 'rotate') void rotateImage();
    else if (retryAction?.kind === 'save') void save(retryAction.analyze, retryAction.continueCapture);
    else setError(null);
  };
  const setScript = (script: ReaderOcrScript) => {
    updateDraft({ ocrScript: script });
    setError(null);
    setRetryAction(null);
  };
  const ocrMenuItems: readonly ActionMenuItem[] = [
    { key: 'script-auto', label: `识别语言：自动${ocrScript === 'auto' ? '（当前）' : ''}`, icon: Languages, onPress: () => setScript('auto') },
    { key: 'script-chinese', label: `识别语言：中文 + 拉丁${ocrScript === 'chinese' ? '（当前）' : ''}`, icon: Languages, onPress: () => setScript('chinese') },
    { key: 'script-latin', label: `识别语言：拉丁文字${ocrScript === 'latin' ? '（当前）' : ''}`, icon: Languages, onPress: () => setScript('latin') },
    { key: 'recognize', label: '重新识别', icon: ScanText, disabled: !imageUri || recognizing, onPress: () => { if (imageUri) void recognizeImage(imageUri, ocrScript, false); } },
  ];
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader action={step === 'review' ? <ReaderIconButton icon={MoreHorizontal} label="识别设置" onPress={() => setAdvancedOpen((value) => !value)} /> : undefined} onBack={requestClose} subtitle={book.title} title={step === 'source' ? '采集书页' : '核对摘录'} />
      <ActionMenu items={ocrMenuItems} onClose={() => setAdvancedOpen(false)} visible={advancedOpen} />
      {error ? <ReaderError message={error} onRetry={retry} /> : null}
      {step === 'source' ? (
        <ReaderScroll style={styles.captureActions}>
          <CaptureAction icon={Camera} label="拍照" onPress={() => { void selectImage('camera'); }} />
          <CaptureAction icon={Upload} label="从相册选择" onPress={() => { void selectImage('library'); }} />
          <CaptureAction icon={FileText} label="输入文字" onPress={() => updateDraft({ step: 'review' })} />
        </ReaderScroll>
      ) : (
        <>
        <ReaderScroll style={styles.form}>
          {imageUri ? <>
            <Image resizeMode="contain" source={{ uri: imageUri }} style={styles.sourceImage} />
            <View style={styles.actionRow}>
              <ReaderButton disabled={saving || recognizing || rotating} icon={RotateCw} label={rotating ? '正在旋转' : '旋转 90°'} onPress={() => { void rotateImage(); }} secondary />
            </View>
          </> : null}
          {recognizing || rotating ? <View accessibilityLabel={rotating ? '正在旋转并重新识别文字' : '正在识别文字'} style={styles.statusLine}><ScanText size={18}  strokeWidth={iconography.stroke} /><Text style={styles.statusText}>{rotating ? '旋转并重新识别中' : '识别中'}</Text></View> : null}
          <ReaderField label="标题" onChangeText={(value) => updateDraft({ title: value })} placeholder="可选" value={title} />
          <ReaderField label="页码或位置" onChangeText={(value) => updateDraft({ pageLabel: value })} value={pageLabel} />
          {rawSourceText ? <View style={styles.sourceEditorHeader}><Text style={styles.formLabel}>识别原文</Text><ReaderIconButton icon={rawOpen ? EyeOff : Eye} label={rawOpen ? '隐藏识别原文' : '查看识别原文'} onPress={() => setRawOpen((value) => !value)} /></View> : null}
          {rawOpen && rawSourceText ? <View style={styles.rawSource}><Text style={styles.rawSourceLabel}>识别原文（只读）</Text><Text selectable style={styles.rawSourceText}>{rawSourceText}</Text></View> : null}
          <ReaderField editable={!recognizing && !rotating} label="摘录正文" multiline onChangeText={(value) => updateDraft({ sourceText: value })} value={sourceText} />
        </ReaderScroll>
        <View style={styles.captureFooter}>
          <ReaderButton disabled={saving || recognizing || rotating || (!sourceText.trim() && !imageUri)} icon={Save} label={saving ? '正在保存' : '保存'} onPress={() => { void save(false); }} secondary={aiAvailable && Boolean(sourceText.trim())} />
          {aiAvailable ? <ReaderButton disabled={saving || recognizing || rotating || !sourceText.trim()} icon={Sparkles} label="保存并分析" onPress={() => { void save(true); }} />
            : onConfigureAi ? <ReaderButton icon={Sparkles} label="配置 AI" onPress={onConfigureAi} secondary /> : null}
          <ReaderButton disabled={saving || recognizing || rotating || (!sourceText.trim() && !imageUri)} icon={Camera} label="保存后继续采集" onPress={() => { void save(false, true); }} secondary />
        </View>
        </>
      )}
    </ReaderDetailPane>
  );
}

function CaptureAction({ icon: Icon, label, onPress }: { icon: typeof Camera; label: string; onPress: () => void }) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.captureRow, pressed && styles.pressed]}>
      <View style={styles.captureIcon}><Icon color={palette.brand} size={25} /></View>
      <View style={styles.captureCopy}><Text style={styles.captureTitle}>{label}</Text></View>
    </Pressable>
  );
}

function emptyCaptureState(ocrScript: ReaderOcrScript, pageLabel = ''): PassageCaptureState {
  return { step: 'source', imageUri: '', title: '', pageLabel, sourceText: '', rawSourceText: '', ocrBlocks: [], ocrScript };
}

function nextPageLabel(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return '';
  return String(Number(trimmed) + 1);
}

type PassageDiscussionSheet =
  | { kind: 'actions'; question: string }
  | { kind: 'select'; question: string };

interface PassageDiscussionState {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ReaderPassageDetailScreen({ passage, book, media, repository, discussions, discussionState, tab, ai, aiAvailable, wide, onBack, onTabChange, onSource, onNewDiscussion, onOpenDiscussion, onTrashDiscussion, onTrash, onConfigureAi }: {
  passage: ReaderPassage;
  book: ReaderBook;
  media: MediaLibrary;
  repository: ReaderLibraryRepository;
  discussions: readonly ReaderDiscussion[];
  discussionState: PassageDiscussionState;
  tab: ReaderPassageTab;
  ai: ReaderAiCoordinator | null;
  aiAvailable: boolean;
  wide: boolean;
  onBack: () => void;
  onTabChange: (tab: ReaderPassageTab) => void;
  onSource: () => void;
  onNewDiscussion: (question: string) => void;
  onOpenDiscussion: (discussionId: string, question: string | null) => void;
  onTrashDiscussion: (discussionId: string) => void;
  onTrash: () => void;
  onConfigureAi?: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [discussionSheet, setDiscussionSheet] = useState<PassageDiscussionSheet | null>(null);
  const [discussionQuery, setDiscussionQuery] = useState('');
  const [selectQuery, setSelectQuery] = useState('');
  const [contextDiscussion, setContextDiscussion] = useState<ReaderDiscussion | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const tabOffset = useRef(0);
  const tabOffsets = useRef<Record<ReaderPassageTab, number>>({ questions: 0, discussions: 0 });
  const visitedTabs = useRef(new Set<ReaderPassageTab>([tab]));
  const passageActions = useReaderPassageActions({
    passage,
    book,
    ai,
    aiAvailable,
    onSource: () => onSource(),
    onTrash: () => onTrash(),
    onError: setError,
  });
  const applyPassageImage = async (image: StoredImage) => {
    if (image.uri === passage.imageUri) return;
    await repository.updatePassage(passage.id, {
      title: passage.title,
      pageLabel: passage.pageLabel,
      imageUri: image.uri,
      rawSourceText: passage.rawSourceText,
      sourceText: passage.sourceText,
      ocrScript: passage.ocrScript,
      ocrBlocks: passage.ocrBlocks,
    }, passage.sourceRevision);
    if (passage.imageUri) await media.deleteImage(passage.imageUri).catch(() => undefined);
  };
  const visibleDiscussions = useMemo(() => discussions.length > 8
    ? searchReaderDiscussions(discussions, discussionQuery)
    : discussions, [discussionQuery, discussions]);
  const selectableDiscussions = useMemo(() => discussions.length > 8
    ? searchReaderDiscussions(discussions, selectQuery)
    : discussions, [discussions, selectQuery]);
  const openDiscussionActions = (question: string) => {
    if (!discussionState.loading && !discussionState.error && discussions.length === 0) {
      onNewDiscussion(question);
      return;
    }
    setSelectQuery('');
    setDiscussionSheet({ kind: 'actions', question });
  };
  const selectDiscussion = (discussionId: string) => {
    const question = discussionSheet?.kind === 'select' ? discussionSheet.question.trim() : '';
    setDiscussionSheet(null);
    onOpenDiscussion(discussionId, question || null);
  };
  const changeTab = (next: ReaderPassageTab) => {
    if (next === tab) return;
    tabOffsets.current[tab] = scrollOffset.current;
    const target = visitedTabs.current.has(next) ? tabOffsets.current[next] : tabOffset.current;
    visitedTabs.current.add(next);
    onTabChange(next);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y: target })));
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = Math.max(0, event.nativeEvent.contentOffset.y);
    tabOffsets.current[tab] = scrollOffset.current;
  };
  const analysisAction = passageActions.items.find((item) => item.key === 'analysis');
  const analysisError = !passageActions.workActive && (passage.analysisStatus === 'failed' || passage.analysisStatus === 'interrupted')
    ? passage.analysisError || '分析尚未完成'
    : null;
  const contextItems: readonly ActionMenuItem[] = contextDiscussion ? [
    { key: 'open', label: '打开讨论', icon: MessageCircle, onPress: () => onOpenDiscussion(contextDiscussion.id, null) },
    { key: 'trash', label: '移到回收站', icon: Trash2, danger: true, onPress: () => onTrashDiscussion(contextDiscussion.id) },
  ] : [];
  const questionsContent = (
    <>
      {passageActions.workActive ? (
        <View accessibilityLabel={passageActions.progressLabel} style={styles.inlineStatus}>
          <AiActivityDots compact />
          <Text style={styles.inlineStatusText}>{passageActions.progressLabel}</Text>
        </View>
      ) : analysisError ? <ReaderError message={analysisError} onRetry={() => analysisAction?.onPress()} retryLabel="重新分析" /> : null}
      {passage.suggestedQuestions.length ? passage.suggestedQuestions.map((question) => (
        <Pressable accessibilityRole="button" key={question} onPress={() => openDiscussionActions(question)} style={({ pressed }) => [styles.questionRow, pressed && styles.pressed]}>
          <MessageCircle color={palette.brand} size={20}  strokeWidth={iconography.stroke} />
          <Text style={styles.questionText}>{question}</Text>
        </Pressable>
      )) : !passageActions.workActive && !analysisError ? (
        <ReaderEmpty
          action={aiAvailable
            ? <ReaderButton disabled={!passage.sourceText.trim()} icon={Sparkles} label="生成摘要与追问" onPress={() => analysisAction?.onPress()} />
            : onConfigureAi ? <ReaderButton icon={Settings} label="配置 AI" onPress={onConfigureAi} secondary /> : undefined}
          detail={passage.sourceText.trim() ? '分析当前摘录正文，生成摘要和可继续讨论的问题。' : '先补充摘录正文，再开始分析。'}
          icon={Sparkles}
          title="还没有分析结果"
        />
      ) : null}
      <View style={styles.bottomAction}><ReaderButton icon={Plus} label="发起讨论" onPress={() => openDiscussionActions('')} secondary /></View>
    </>
  );
  const discussionsContent = discussionState.loading ? <ReaderSkeletonRows count={3} />
    : discussionState.error ? <ReaderError message={discussionState.error} onRetry={discussionState.onRetry} />
      : (
        <>
          {discussions.length > 8 ? <ReaderSearch onChangeText={setDiscussionQuery} placeholder="搜索已有讨论" value={discussionQuery} /> : null}
          {visibleDiscussions.length ? visibleDiscussions.map((discussion) => (
            <ReaderDiscussionRow
              book={null}
              discussion={discussion}
              key={discussion.id}
              onLongPress={() => setContextDiscussion(discussion)}
              onPress={() => onOpenDiscussion(discussion.id, null)}
            />
          )) : discussions.length ? (
            <ReaderEmpty detail="调整搜索内容后再试。" icon={MessageCircle} title="没有匹配的讨论" />
          ) : (
            <ReaderEmpty
              action={<ReaderButton icon={Plus} label="新建讨论" onPress={() => onNewDiscussion('')} />}
              detail="围绕这条摘录提出第一个问题。"
              icon={MessageCircle}
              title="还没有讨论"
            />
          )}
        </>
      );
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader
        action={<View style={styles.headerActions}>
          {tab === 'discussions' ? <ReaderIconButton active icon={Plus} label="新建讨论" onPress={() => onNewDiscussion('')} /> : null}
          <ReaderIconButton icon={MoreHorizontal} label="摘录操作" onPress={() => setMenuOpen((value) => !value)} />
        </View>}
        onBack={onBack}
        subtitle={book.title}
        title={passageDisplayTitle(passage.title, passage.pageLabel, passage.sourceText)}
      />
      <ActionMenu
        items={passageActions.items}
        onClose={() => setMenuOpen(false)}
        visible={menuOpen}
      />
      {error ? <ReaderError message={error} onRetry={() => passageActions.items.find((item) => item.key === 'analysis')?.onPress()} /> : null}
      <ScrollView
        contentContainerStyle={styles.passageDetailContent}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        ref={scrollRef}
        scrollEventThrottle={32}
        stickyHeaderIndices={[1]}
      >
        <View>
          <ReaderPassageSummary
            emptyLabel={passage.analysisStatus === 'failed' || passage.analysisStatus === 'interrupted' ? '分析尚未完成' : '尚无分析摘要'}
            imageUri={passage.imageUri}
            media={media}
            onImageChanged={applyPassageImage}
            progressLabel={passageActions.progressLabel}
            summary={passage.summary}
            title={passageDisplayTitle(passage.title, passage.pageLabel, passage.sourceText)}
            working={passageActions.workActive}
          />
        </View>
        <View onLayout={(event) => { tabOffset.current = event.nativeEvent.layout.y; }} style={styles.stickyTabs}>
          <ReaderFlatTabs
            active={tab}
            items={[
              { value: 'questions', label: '值得追问', count: passage.suggestedQuestions.length },
              {
                value: 'discussions',
                label: '已有讨论',
                count: discussionState.loading || discussionState.error ? null : discussions.length,
                busy: discussionState.loading,
                unread: discussions.some((discussion) => discussion.unread),
              },
            ]}
            onChange={changeTab}
          />
        </View>
        <View style={styles.tabContent}>{tab === 'questions' ? questionsContent : discussionsContent}</View>
      </ScrollView>
      <FormSheet
        onClose={() => setDiscussionSheet(null)}
        title="继续追问"
        visible={discussionSheet?.kind === 'actions'}
      >
        <View style={styles.discussionActions}>
          <ReaderButton icon={Plus} label="新建讨论" onPress={() => {
            const question = discussionSheet?.kind === 'actions' ? discussionSheet.question : '';
            setDiscussionSheet(null);
            onNewDiscussion(question);
          }} />
          <ReaderButton icon={MessageCircle} label="追加到已有讨论" onPress={() => {
            if (discussionSheet?.kind === 'actions') setDiscussionSheet({ kind: 'select', question: discussionSheet.question });
          }} disabled={discussionState.loading || Boolean(discussionState.error) || discussions.length === 0} secondary />
        </View>
        {discussionState.loading ? <View style={styles.inlineStatus}><AiActivityDots compact /><Text style={styles.inlineStatusText}>正在读取已有讨论</Text></View> : null}
        {discussionState.error ? <ReaderError message={discussionState.error} onRetry={discussionState.onRetry} /> : null}
      </FormSheet>
      <FormSheet
        onClose={() => setDiscussionSheet(null)}
        title="选择讨论"
        visible={discussionSheet?.kind === 'select'}
      >
        {discussionState.loading ? <ReaderSkeletonRows count={3} />
          : discussionState.error ? <ReaderError message={discussionState.error} onRetry={discussionState.onRetry} />
            : <>
              {discussions.length > 8 ? <ReaderSearch onChangeText={setSelectQuery} placeholder="搜索已有讨论" value={selectQuery} /> : null}
              {selectableDiscussions.length ? selectableDiscussions.map((discussion) => (
                <ReaderDiscussionRow book={null} discussion={discussion} key={discussion.id} onPress={() => selectDiscussion(discussion.id)} />
              )) : <Text style={styles.discussionEmpty}>没有匹配的讨论。</Text>}
            </>}
      </FormSheet>
      <ActionSheet
        items={contextItems}
        onClose={() => setContextDiscussion(null)}
        title={contextDiscussion?.title ?? '讨论操作'}
        visible={contextDiscussion !== null}
      />
    </ReaderDetailPane>
  );
}

export function ReaderPassageSourceScreen({ passage, repository, ai, aiAvailable = false, wide, onBack, onConfigureAi }: {
  passage: ReaderPassage;
  media?: MediaLibrary;
  repository: ReaderLibraryRepository & ReaderTaskRepository;
  ai?: ReaderAiCoordinator | null;
  aiAvailable?: boolean;
  wide: boolean;
  onBack: () => void;
  onConfigureAi?: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useStyles();
  const source = useMemo<ReaderPassageDraft>(() => ({
    title: passage.title,
    pageLabel: passage.pageLabel,
    imageUri: passage.imageUri,
    rawSourceText: passage.rawSourceText,
    sourceText: passage.sourceText,
    ocrScript: passage.ocrScript,
    ocrBlocks: passage.ocrBlocks,
  }), [passage]);
  const [draft, setDraftValue] = useState<ReaderPassageDraft>(source);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const syncedSourceRevision = useRef(passage.sourceRevision);
  useEffect(() => {
    if (passage.sourceRevision === syncedSourceRevision.current || dirty || pending) return;
    syncedSourceRevision.current = passage.sourceRevision;
    setDraftValue((current) => ({
        ...current,
        title: passage.title,
        pageLabel: passage.pageLabel,
        imageUri: passage.imageUri,
        rawSourceText: passage.rawSourceText,
        sourceText: passage.sourceText,
        ocrScript: passage.ocrScript,
        ocrBlocks: passage.ocrBlocks,
      }));
  }, [dirty, passage.imageUri, passage.ocrBlocks, passage.ocrScript, passage.pageLabel, passage.rawSourceText, passage.sourceRevision, passage.sourceText, passage.title, pending]);
  useEffect(() => {
    if (passage.imageUri && draft.imageUri !== passage.imageUri) {
      const timer = setTimeout(() => setDraftValue((current) => ({ ...current, imageUri: passage.imageUri })), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [draft.imageUri, passage.imageUri]);
  const setDraft = (next: ReaderPassageDraft | ((current: ReaderPassageDraft) => ReaderPassageDraft)) => {
    setDirty(true);
    setDraftValue((current) => typeof next === 'function' ? next(current) : next);
  };
  const [rawOpen, setRawOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<PassageSourceRetry | null>(null);
  const [candidate, setCandidate] = useState<ReaderPassageOrganizationCandidate | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidatePending, setCandidatePending] = useState(false);
  useEffect(() => repository.watchOrganizationCandidate(
    passage.id,
    (item) => {
      setCandidate(item);
      setCandidateError(null);
    },
    (cause) => setCandidateError(messageOf(cause, 'AI 整理候选读取失败')),
  ), [passage.id, repository]);
  const close = () => onBack();
  const save = async () => {
    setPending(true); setError(null); setRetryAction(null);
    try {
      const rawChanged = passage.rawSourceText !== (draft.rawSourceText ?? draft.sourceText);
      const sourceChanged = passage.sourceText !== draft.sourceText;
      const wasAnalyzing = passage.analysisStatus === 'running';
      if ((rawChanged || sourceChanged) && wasAnalyzing) await ai?.stopPassage(passage.id);
      const finalDraft: ReaderPassageDraft = {
        ...draft,
        imageUri: passage.imageUri,
      };
      await repository.updatePassage(passage.id, finalDraft, passage.sourceRevision);
      setDirty(false);
      onBack();
    } catch (cause) {
      setError(messageOf(cause, '保存原文失败'));
      setRetryAction({ kind: 'save' });
    }
    finally { setPending(false); }
  };
  const retry = () => {
    if (retryAction?.kind === 'save') void save();
    else setError(null);
  };
  const organizeActive = passage.organizationStatus === 'queued' || passage.organizationStatus === 'running';
  const organize = () => {
    if (!ai || !aiAvailable || organizeActive || candidate || dirty || !draft.sourceText.trim() || pending || candidatePending) return;
    setCandidateError(null);
    setCandidatePending(true);
    void ai.organizePassage(passage)
      .catch((cause: unknown) => setCandidateError(messageOf(cause, '提交整理任务失败')))
      .finally(() => setCandidatePending(false));
  };
  const applyCandidate = (reanalyze: boolean) => {
    if (!candidate || dirty || pending || candidatePending) {
      if (dirty) setCandidateError('请先保存当前手工修改，再应用 AI 候选。');
      return;
    }
    setCandidatePending(true);
    setCandidateError(null);
    void repository.applyPassageOrganizationCandidate(passage.id, candidate.id, passage.sourceRevision)
      .then(async (applied) => {
        if (!applied) throw new Error('摘录已发生变化，请重新整理');
        if (reanalyze && ai && aiAvailable) {
          const latest = await repository.getPassage(passage.id);
          if (latest) await ai.analyzePassage(latest);
        }
      })
      .catch((cause: unknown) => setCandidateError(messageOf(cause, '应用 AI 候选失败')))
      .finally(() => setCandidatePending(false));
  };
  const discardCandidate = () => {
    if (!candidate || candidatePending) return;
    Alert.alert('放弃整理候选？', '候选文本不会写入摘录正文，之后仍可重新整理。', [
      { text: '保留候选', style: 'cancel' },
      {
        text: '放弃候选',
        style: 'destructive',
        onPress: () => {
          setCandidatePending(true);
          setCandidateError(null);
          void repository.discardPassageOrganizationCandidate(passage.id, candidate.id)
            .catch((cause: unknown) => setCandidateError(messageOf(cause, '放弃候选失败')))
            .finally(() => setCandidatePending(false));
        },
      },
    ]);
  };
  const requestClose = useReaderDraftGuard({
    dirty,
    noun: '原文修改',
    onBack: close,
    onSave: save,
    pending,
  });
  return (
    <ReaderDetailPane wide={wide}>
      <ReaderHeader action={<ReaderIconButton active disabled={pending} icon={Save} label="保存" onPress={() => { void save(); }} />} onBack={requestClose} title="编辑原文" />
      {error ? <ReaderError message={error} onRetry={retry} /> : null}
      {candidateError ? <ReaderError message={candidateError} onRetry={() => setCandidateError(null)} /> : null}
      <ReaderScroll style={styles.form}>
        <ReaderField label="标题" onChangeText={(title) => setDraft((value) => ({ ...value, title }))} value={draft.title} />
        <ReaderField label="页码或位置" onChangeText={(pageLabel) => setDraft((value) => ({ ...value, pageLabel }))} value={draft.pageLabel} />
        {draft.rawSourceText ? (
          <>
            <View style={styles.sourceEditorHeader}>
              <Text style={styles.formLabel}>识别原文</Text>
              <ReaderIconButton
                icon={rawOpen ? EyeOff : Eye}
                label={rawOpen ? '隐藏识别原文' : '查看识别原文'}
                onPress={() => setRawOpen((value) => !value)}
              />
            </View>
            {rawOpen ? (
              <View style={styles.rawSource}>
                <Text style={styles.rawSourceLabel}>识别原文（只读）</Text>
                <Text selectable style={styles.rawSourceText}>{draft.rawSourceText}</Text>
              </View>
            ) : null}
          </>
        ) : null}
        <View style={styles.sourceAiHeader}>
          <View style={styles.sourceAiCopy}>
            <Text style={styles.formLabel}>摘录正文</Text>
            <Text style={styles.sourceAiHint}>AI 整理只生成候选，确认后才会改写正文。</Text>
          </View>
          {aiAvailable
            ? <ReaderButton disabled={Boolean(!ai || organizeActive || candidate || dirty || !draft.sourceText.trim() || pending || candidatePending)} icon={Sparkles} label={organizeActive || candidatePending ? '整理中' : dirty ? '先保存后整理' : '整理识别文字'} onPress={organize} secondary />
            : onConfigureAi ? <ReaderButton icon={Settings} label="配置 AI" onPress={onConfigureAi} secondary /> : null}
        </View>
        <ReaderField label="正文内容" multiline onChangeText={(sourceText) => setDraft((value) => ({ ...value, sourceText }))} value={draft.sourceText} />
        {candidate ? (
          <View style={styles.organizationCandidate}>
            <View style={styles.candidateHeading}>
              <View style={styles.candidateHeadingCopy}>
                <Text style={styles.candidateEyebrow}>AI 整理候选 · 未应用</Text>
                <Text style={styles.candidateTitle}>先对照，再决定是否替换当前正文</Text>
              </View>
              <Sparkles color={palette.brand} size={18}  strokeWidth={iconography.stroke} />
            </View>
            <View style={styles.candidatePanel}>
              <Text style={styles.candidatePanelLabel}>当前正文</Text>
              <Text selectable style={styles.candidateOld}>{passage.sourceText || '（当前正文为空）'}</Text>
            </View>
            <View style={[styles.candidatePanel, styles.candidatePanelNew]}>
              <Text style={styles.candidatePanelLabel}>AI 候选</Text>
              <Text selectable style={styles.candidateNew}>{candidate.sourceText}</Text>
            </View>
            {dirty ? <Text style={styles.candidateWarning}>当前还有未保存的手工修改，请先保存后再应用候选。</Text> : null}
            <View style={styles.candidateActions}>
              <ReaderButton disabled={dirty || pending || candidatePending} icon={Save} label="应用修改" onPress={() => applyCandidate(false)} />
              <ReaderButton disabled={dirty || pending || candidatePending || !aiAvailable || !ai} icon={Sparkles} label="应用并重新分析" onPress={() => applyCandidate(true)} secondary />
              <ReaderButton disabled={pending || candidatePending} icon={Trash2} label="放弃候选" onPress={discardCandidate} secondary />
            </View>
          </View>
        ) : null}
      </ReaderScroll>
    </ReaderDetailPane>
  );
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function useStyles() { return useThemedStyles(createStyles); }

function createStyles(palette: Palette) {
  return StyleSheet.create({
    headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
    captureActions: { gap: spacing.md, padding: spacing.lg },
    captureRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.lg, minHeight: 88, paddingVertical: spacing.md },
    captureIcon: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.control, height: 52, justifyContent: 'center', width: 52 },
    captureCopy: { flex: 1, minWidth: 0 },
    captureTitle: { color: palette.text, fontSize: 16, fontWeight: '700' },
    form: { gap: spacing.lg, padding: spacing.lg },
    sourceImage: { backgroundColor: palette.surfaceMuted, borderRadius: radius.control, height: 220, width: '100%' },
    statusLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    statusText: { color: palette.textMuted, fontSize: 13 },
    formLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    captureFooter: { backgroundColor: palette.canvas, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
    sourceEditorHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    sourceAiHeader: { alignItems: 'flex-end', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
    sourceAiCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    sourceAiHint: { color: palette.textSubtle, fontSize: 12, lineHeight: 18 },
    rawSource: { backgroundColor: palette.surfaceSoft, borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.lg, padding: spacing.md },
    rawSourceLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    rawSourceText: { color: palette.textMuted, fontSize: 14, lineHeight: 23 },
    organizationCandidate: { backgroundColor: palette.surfaceSoft, borderColor: palette.brand, borderRadius: radius.control, borderWidth: 1, gap: spacing.md, padding: spacing.md },
    candidateHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
    candidateHeadingCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
    candidateEyebrow: { color: palette.brand, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
    candidateTitle: { color: palette.text, fontSize: 14, fontWeight: '700', lineHeight: 20 },
    candidatePanel: { backgroundColor: palette.canvas, borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
    candidatePanelNew: { backgroundColor: palette.primarySoft, borderColor: palette.brand },
    candidatePanelLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    candidateOld: { color: palette.textMuted, fontSize: 14, lineHeight: 22 },
    candidateNew: { color: palette.text, fontSize: 14, lineHeight: 22 },
    candidateWarning: { color: palette.danger, fontSize: 12, lineHeight: 18 },
    candidateActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    passageDetailContent: { flexGrow: 1, paddingBottom: spacing.xxl },
    stickyTabs: { backgroundColor: palette.canvas, elevation: 2, zIndex: 2 },
    tabContent: { flexGrow: 1, minHeight: 320 },
    tabStatus: { alignItems: 'center', gap: spacing.md, justifyContent: 'center', minHeight: 220, padding: spacing.xxl },
    tabStatusText: { color: palette.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    inlineStatus: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    inlineStatusText: { color: palette.textMuted, flex: 1, fontSize: 13, lineHeight: 19 },
    questionRow: { alignItems: 'flex-start', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.lg },
    questionText: { color: palette.text, flex: 1, fontSize: 15, lineHeight: 22 },
    discussionEmpty: { color: palette.textMuted, fontSize: 14, lineHeight: 21, padding: spacing.lg },
    discussionActions: { gap: spacing.md },
    bottomAction: { padding: spacing.lg },
    pressed: { opacity: 0.66 },
  });
}
