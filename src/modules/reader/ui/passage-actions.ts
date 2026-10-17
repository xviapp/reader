import { FileText, Share2, Square, Trash2, WandSparkles } from 'lucide-react-native';
import { useState } from 'react';

import type { ActionMenuItem } from '@/core/ui/action-menu';

import type { ReaderAiCoordinator } from '../application/reader-ai';
import type { ReaderBook, ReaderPassage } from '../domain/model';
import { readerPassageShare } from '../application/reader-share';
import { shareReaderImage, shareReaderText } from '../application/reader-share-native';
import { useReaderShare } from './use-reader-share';

export function useReaderPassageActions({
  passage,
  book,
  ai,
  aiAvailable,
  onSource,
  onTrash,
  onError,
}: {
  passage: ReaderPassage | null;
  book: ReaderBook;
  ai: ReaderAiCoordinator | null;
  aiAvailable: boolean;
  onSource: (passageId: string) => void;
  onTrash: (passageId: string) => void;
  onError: (message: string | null) => void;
}) {
  const [operationPending, setOperationPending] = useState(false);
  const sharing = useReaderShare(onError);
  const organizationActive = passage?.organizationStatus === 'queued' || passage?.organizationStatus === 'running';
  const analysisActive = passage?.analysisStatus === 'running';
  const workActive = operationPending || organizationActive || analysisActive;

  const analyze = () => {
    if (!passage || !ai || workActive) return;
    setOperationPending(true);
    onError(null);
    void ai.analyzePassage(passage)
      .catch((cause: unknown) => onError(messageOf(cause, '分析失败')))
      .finally(() => setOperationPending(false));
  };
  const stop = () => {
    if (!passage || !ai || (!organizationActive && !analysisActive)) return;
    setOperationPending(true);
    onError(null);
    void ai.stopPassage(passage.id)
      .catch((cause: unknown) => onError(messageOf(cause, '停止任务失败')))
      .finally(() => setOperationPending(false));
  };
  const items: readonly ActionMenuItem[] = passage ? [
    { key: 'source', label: '查看和编辑原文', icon: FileText, onPress: () => onSource(passage.id) },
    { key: 'share-source', label: '分享摘录', icon: Share2, disabled: sharing.pending || !passage.sourceText.trim(), onPress: () => sharing.run(() => shareReaderText(readerPassageShare(book, passage, 'source'))) },
    ...(passage.rawSourceText.trim() ? [{ key: 'share-ocr', label: '分享 OCR 原文', icon: Share2, disabled: sharing.pending, onPress: () => sharing.run(() => shareReaderText(readerPassageShare(book, passage, 'ocr'))) }] : []),
    ...(passage.summary.trim() && passage.analysisStatus === 'completed' ? [{ key: 'share-summary', label: '分享 AI 摘要', icon: Share2, disabled: sharing.pending, onPress: () => sharing.run(() => shareReaderText(readerPassageShare(book, passage, 'summary'))) }] : []),
    ...(passage.imageUri ? [{ key: 'share-image', label: '分享原图', icon: Share2, disabled: sharing.pending, onPress: () => sharing.run(() => shareReaderImage(book, passage)) }] : []),
    { key: 'analysis', label: passage.summary ? '重新分析' : '分析摘录', icon: WandSparkles, disabled: workActive || !aiAvailable || !passage.sourceText.trim(), onPress: analyze },
    ...(organizationActive || analysisActive
      ? [{ key: 'stop', label: '停止摘录 AI 任务', icon: Square, danger: true, onPress: stop }]
      : []),
    { key: 'trash', label: '移到回收站', icon: Trash2, danger: true, onPress: () => onTrash(passage.id) },
  ] : [];
  const progressLabel = organizationActive
    ? passage?.organizationError?.trim() || '正在整理原文'
    : analysisActive
      ? '正在分析摘录'
      : '正在提交 AI 任务';

  return { items, workActive, organizationActive, analysisActive, progressLabel };
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}
