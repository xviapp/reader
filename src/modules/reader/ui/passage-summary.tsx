import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import { AiActivityDots } from '@/core/ui/ai-activity';
import { ImagePreview } from '@/core/ui/image-preview';
import type { MediaLibrary, StoredImage } from '@/core/media/media-library';

import { splitPassageSummaryAtLines, type PassageSummarySplit } from './passage-summary-layout';

const THUMBNAIL_MIN_WIDTH = 104;
const THUMBNAIL_MAX_WIDTH = 120;
const THUMBNAIL_ASPECT_RATIO = 112 / 148;
const SUMMARY_LINE_HEIGHT = 26;
const SUMMARY_HEADER_HEIGHT = 36;

export function ReaderPassageSummary({
  imageUri,
  summary,
  title,
  working,
  progressLabel,
  emptyLabel,
  media,
  onImageChanged,
}: {
  imageUri: string;
  summary: string;
  title: string;
  working: boolean;
  progressLabel: string;
  emptyLabel: string;
  media: MediaLibrary;
  onImageChanged?: ((image: StoredImage) => Promise<void> | void) | undefined;
}) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { width: viewportWidth } = useWindowDimensions();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rightWidth, setRightWidth] = useState(0);
  const [measurement, setMeasurement] = useState<{ key: string; split: PassageSummarySplit } | null>(null);
  const stacked = viewportWidth < 420;
  const thumbnailWidth = stacked
    ? Math.min(THUMBNAIL_MAX_WIDTH, Math.max(THUMBNAIL_MIN_WIDTH, viewportWidth - spacing.lg * 2))
    : Math.min(THUMBNAIL_MAX_WIDTH, Math.max(THUMBNAIL_MIN_WIDTH, Math.round((viewportWidth - spacing.lg * 2) * 0.34)));
  const targetThumbnailHeight = Math.round(thumbnailWidth / THUMBNAIL_ASPECT_RATIO);
  const headerHeight = SUMMARY_HEADER_HEIGHT + (working && summary ? 22 : 0);
  const leadLines = Math.max(2, Math.round((targetThumbnailHeight - headerHeight) / SUMMARY_LINE_HEIGHT));
  const thumbnailHeight = headerHeight + leadLines * SUMMARY_LINE_HEIGHT;
  const hasImage = Boolean(imageUri);
  const summaryCanExpand = summary.length > 560;
  const visibleSummary = summaryExpanded || !summaryCanExpand ? summary : `${summary.slice(0, 560).trimEnd()}…`;
  const measurementKey = `${imageUri}\u0000${visibleSummary}\u0000${rightWidth}\u0000${leadLines}`;
  const split = hasImage
    ? measurement?.key === measurementKey ? measurement.split : { lead: '', remainder: '' }
    : { lead: visibleSummary.trim(), remainder: '' };

  const measureStyle = useMemo(() => ({ width: rightWidth }), [rightWidth]);
  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (!hasImage || rightWidth <= 0) return;
    const next = splitPassageSummaryAtLines(visibleSummary, event.nativeEvent.lines.map((line) => line.text), leadLines);
    setMeasurement((current) => current?.key === measurementKey && current.split.lead === next.lead && current.split.remainder === next.remainder
      ? current
      : { key: measurementKey, split: next });
  };
  const copy = () => {
    void Clipboard.setStringAsync(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    });
  };
  const summaryBody = summary ? <Text selectable style={styles.summaryText}>{split.lead}</Text>
    : working ? <View accessibilityLabel={progressLabel} style={styles.progress}><AiActivityDots compact /><Text style={styles.progressText}>{progressLabel}</Text></View>
      : <Text style={styles.emptyText}>{emptyLabel}</Text>;

  return (
    <View style={styles.section}>
      <View style={[styles.topRow, stacked && styles.topRowStacked]}>
        {hasImage ? (
          <Pressable accessibilityLabel="查看摘录图片（查看大图）" accessibilityRole="imagebutton" onPress={() => setPreviewOpen(true)} style={({ pressed }) => [styles.thumbnailButton, { height: stacked ? targetThumbnailHeight : thumbnailHeight, width: thumbnailWidth }, pressed && styles.pressed]}>
            <Image resizeMode="contain" source={{ uri: imageUri }} style={styles.thumbnail} />
            <View pointerEvents="none" style={styles.imageHint}><Text style={styles.imageHintText}>查看大图</Text></View>
          </Pressable>
        ) : null}
        <View onLayout={(event) => setRightWidth(event.nativeEvent.layout.width)} style={[styles.summaryColumn, stacked && styles.summaryColumnStacked]}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>分析摘要</Text>
            {summary ? (
              <Pressable accessibilityLabel={copied ? '摘要已复制' : '复制摘要'} accessibilityRole="button" hitSlop={6} onPress={copy} style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
                {copied ? <Check color={palette.success} size={18}  strokeWidth={iconography.stroke} /> : <Copy color={palette.textMuted} size={18}  strokeWidth={iconography.stroke} />}
              </Pressable>
            ) : null}
          </View>
          {working && summary ? <View accessibilityLabel={progressLabel} style={styles.inlineProgress}><AiActivityDots compact /><Text numberOfLines={1} style={styles.progressText}>{progressLabel}</Text></View> : null}
          {summaryBody}
          {hasImage && summary && rightWidth > 0 ? (
            <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onTextLayout={onTextLayout} style={[styles.measureText, measureStyle]}>{visibleSummary}</Text>
          ) : null}
        </View>
      </View>
      {split.remainder ? <Text selectable style={styles.remainder}>{split.remainder}</Text> : null}
      {summaryCanExpand ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: summaryExpanded }} onPress={() => setSummaryExpanded((value) => !value)} style={({ pressed }) => [styles.summaryToggle, pressed && styles.pressed]}>
        <Text style={styles.summaryToggleText}>{summaryExpanded ? '收起摘要' : '查看完整摘要'}</Text>
      </Pressable> : null}
      <ImagePreview media={media} onApply={onImageChanged} onClose={() => setPreviewOpen(false)} purpose="document" title={title} uri={imageUri} visible={previewOpen && hasImage} />
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    section: { padding: spacing.lg },
    topRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
    topRowStacked: { flexDirection: 'column' },
    thumbnailButton: { backgroundColor: palette.surfaceMuted, borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, overflow: 'hidden' },
    thumbnail: { height: '100%', width: '100%' },
    imageHint: { backgroundColor: 'rgba(0, 0, 0, 0.56)', bottom: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, position: 'absolute' },
    imageHintText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
    summaryColumn: { flex: 1, minWidth: 0, position: 'relative' },
    summaryColumnStacked: { width: '100%' },
    summaryHeader: { alignItems: 'center', flexDirection: 'row', height: SUMMARY_HEADER_HEIGHT },
    summaryTitle: { color: palette.text, flex: 1, fontSize: 16, fontWeight: '700' },
    copyButton: { alignItems: 'center', borderRadius: radius.control, height: 34, justifyContent: 'center', width: 34 },
    summaryText: { color: palette.text, fontSize: 16, lineHeight: SUMMARY_LINE_HEIGHT },
    remainder: { color: palette.text, fontSize: 16, lineHeight: SUMMARY_LINE_HEIGHT },
    progress: { alignItems: 'flex-start', gap: spacing.sm, minHeight: 72, paddingTop: spacing.sm },
    inlineProgress: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
    progressText: { color: palette.textMuted, flexShrink: 1, fontSize: 12, lineHeight: 18 },
    emptyText: { color: palette.textMuted, fontSize: 14, lineHeight: 21, paddingTop: spacing.sm },
    summaryToggle: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center', paddingTop: spacing.xs },
    summaryToggleText: { color: palette.brand, fontSize: 13, fontWeight: '700' },
    measureText: { color: 'transparent', fontSize: 16, left: 0, lineHeight: SUMMARY_LINE_HEIGHT, opacity: 0, position: 'absolute', top: SUMMARY_HEADER_HEIGHT },
    pressed: { opacity: 0.72 },
  });
}
