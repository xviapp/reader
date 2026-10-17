import { Check, Crop, RotateCcw, RotateCw, X, type LucideIcon } from 'lucide-react-native';
import { PureComponent, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/core/design/theme';
import { iconography, radius, spacing, type Palette } from '@/core/design/tokens';
import { useThemedStyles } from '@/core/design/use-themed-styles';
import type { MediaImageCrop, MediaImagePurpose, MediaLibrary, StoredImage } from '@/core/media/media-library';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.4;
const MIN_CROP_SIZE = 56;
const CROP_HANDLE_HIT_SIZE = 36;

interface TransformState {
  scale: number;
  x: number;
  y: number;
}

interface GestureStart extends TransformState {
  pinchDistance: number;
  singleTouch: boolean;
  moved: boolean;
}

interface ZoomableImageProps {
  resetToken: number;
  styles: ReturnType<typeof createStyles>;
  title: string;
  uri: string;
}

interface ImagePreviewProps {
  visible: boolean;
  uri: string;
  title: string;
  onClose: () => void;
  media?: MediaLibrary | undefined;
  purpose?: MediaImagePurpose | undefined;
  onApply?: ((image: StoredImage) => Promise<void> | void) | undefined;
}

type ImagePreviewMode = 'view' | 'crop';

interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ImageDisplayRect extends CropRect {
  width: number;
  height: number;
}

type CropGesture = 'move' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface CropGestureStart {
  kind: CropGesture;
  start: CropRect;
}

export function ImagePreview(props: ImagePreviewProps) {
  if (!props.visible) return null;
  return <ImagePreviewContent key={props.uri} {...props} />;
}

function ImagePreviewContent({ uri, title, onClose, media, purpose = 'document', onApply }: Omit<ImagePreviewProps, 'visible'>) {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const editable = Boolean(media && onApply);
  const [resetToken, setResetToken] = useState(0);
  const [mode, setMode] = useState<ImagePreviewMode>('view');
  const [workingImage, setWorkingImage] = useState<StoredImage | null>(() => ({ uri, width: 0, height: 0 }));
  const [imageReady, setImageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workingImageRef = useRef<StoredImage | null>(null);
  const originalUriRef = useRef(uri);
  const appliedRef = useRef(false);

  useEffect(() => {
    let active = true;
    const originalUri = uri;
    workingImageRef.current = { uri, width: 0, height: 0 };
    Image.getSize(uri, (width, height) => {
      if (!active) return;
      const measured = { uri, width, height };
      workingImageRef.current = measured;
      setWorkingImage((current) => current?.uri === uri ? measured : current);
      setImageReady(width > 0 && height > 0);
    }, () => {
      if (active) setError('无法读取图片尺寸');
    });
    return () => {
      active = false;
      const current = workingImageRef.current;
      if (!appliedRef.current && media && current && current.uri !== originalUri) {
        void media.deleteImage(current.uri).catch(() => undefined);
      }
    };
  }, [media, uri]);

  const reset = () => {
    setMode('view');
    setResetToken((value) => value + 1);
  };

  const discardGeneratedImage = () => {
    const current = workingImageRef.current;
    workingImageRef.current = null;
    setWorkingImage(null);
    if (!appliedRef.current && media && current && current.uri !== originalUriRef.current) {
      void media.deleteImage(current.uri).catch(() => undefined);
    }
  };

  const close = () => {
    if (busy) return;
    discardGeneratedImage();
    reset();
    setError(null);
    onClose();
  };

  const replaceWorkingImage = (next: StoredImage) => {
    const previous = workingImageRef.current;
    workingImageRef.current = next;
    setWorkingImage(next);
    setImageReady(next.width > 0 && next.height > 0);
    setResetToken((value) => value + 1);
    if (media && previous && previous.uri !== originalUriRef.current && previous.uri !== next.uri) {
      void media.deleteImage(previous.uri).catch(() => undefined);
    }
  };

  const apply = async () => {
    if (!editable || !onApply || !workingImage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(workingImage);
      appliedRef.current = true;
      workingImageRef.current = null;
      setMode('view');
      onClose();
    } catch (cause) {
      setError(messageOf(cause, '保存图片修改失败'));
    }
    finally { setBusy(false); }
  };

  const rotate = async () => {
    if (!editable || !media || !workingImage || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rotated = await media.rotateImage(workingImage.uri, purpose);
      replaceWorkingImage(rotated);
    } catch (cause) {
      setError(messageOf(cause, '图片旋转失败'));
    }
    finally { setBusy(false); }
  };

  const beginCrop = () => {
    if (!editable || !workingImage || !imageReady || busy) return;
    setError(null);
    setMode('crop');
  };

  const applyCrop = async (crop: MediaImageCrop) => {
    if (!editable || !media || !workingImage || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cropped = await media.cropImage(workingImage.uri, purpose, crop);
      replaceWorkingImage(cropped);
      setMode('view');
    } catch (cause) {
      setError(messageOf(cause, '图片裁剪失败'));
    }
    finally { setBusy(false); }
  };

  const imageUri = workingImage?.uri ?? uri;
  return (
    <Modal animationType="fade" onRequestClose={close} presentationStyle="overFullScreen" transparent visible>
      <View style={styles.backdrop}>
        <View
          style={[styles.toolbar, { paddingTop: Math.max(insets.top, spacing.sm) }]}
        >
          <Pressable accessibilityLabel="关闭图片" accessibilityRole="button" disabled={busy} onPress={close} style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}>
            <X color={palette.text} size={23}  strokeWidth={iconography.stroke} />
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>{mode === 'crop' ? '裁剪图片' : title}</Text>
          <View style={styles.toolbarActions}>
            {mode === 'view' ? <Pressable accessibilityLabel="复位图片" accessibilityRole="button" onPress={reset} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <RotateCcw color={palette.text} size={21}  strokeWidth={iconography.stroke} />
            </Pressable> : null}
            {editable ? <Pressable accessibilityLabel="完成图片编辑" accessibilityRole="button" disabled={busy} onPress={() => { void apply(); }} style={({ pressed }) => [styles.doneButton, busy && styles.disabled, pressed && styles.pressed]}>
              {busy ? <ActivityIndicator color={palette.brand} size="small" /> : <Check color={palette.brand} size={19}  strokeWidth={iconography.stroke} />}
              <Text style={styles.doneText}>完成</Text>
            </Pressable> : null}
          </View>
        </View>
        {error ? <View accessibilityLiveRegion="polite" style={styles.errorBar}><Text style={styles.errorText}>{error}</Text></View> : null}
        {mode === 'crop' ? (
          workingImage && imageReady ? <CropEditor bottomInset={Math.max(insets.bottom, spacing.sm)} busy={busy} image={workingImage} onCancel={() => setMode('view')} onConfirm={(crop) => { void applyCrop(crop); }} palette={palette} styles={styles} />
            : <View style={styles.loading}><ActivityIndicator color={palette.brand} /><Text style={styles.loadingText}>正在读取图片…</Text></View>
        ) : (
          <ZoomableImage resetToken={resetToken} styles={styles} title={title} uri={imageUri} />
        )}
        {editable && mode === 'view' ? <View style={[styles.editorToolbar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <EditorToolButton disabled={busy} icon={RotateCw} label="旋转" onPress={() => { void rotate(); }} />
          <EditorToolButton disabled={busy || !imageReady} icon={Crop} label="裁剪" onPress={beginCrop} />
        </View> : null}
      </View>
    </Modal>
  );
}

function EditorToolButton({ icon: Icon, label, onPress, disabled }: { icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean }) {
  const { palette } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.editorTool, disabled && styles.disabled, pressed && styles.pressed]}>
    <Icon color={palette.brand} size={21} />
    <Text style={styles.editorToolText}>{label}</Text>
  </Pressable>;
}

interface CropEditorProps {
  image: StoredImage;
  styles: ReturnType<typeof createStyles>;
  palette: Palette;
  bottomInset: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (crop: MediaImageCrop) => void;
}

interface CropEditorState {
  viewport: { width: number; height: number };
  selection: CropRect | null;
}

class CropEditor extends PureComponent<CropEditorProps, CropEditorState> {
  state: CropEditorState = { viewport: { width: 0, height: 0 }, selection: null };
  private gestureStart: CropGestureStart | null = null;
  private readonly responder: PanResponderInstance = PanResponder.create({
    onStartShouldSetPanResponder: (event) => gestureForPoint(pointOf(event), this.activeSelection()) !== null,
    onMoveShouldSetPanResponder: (event) => gestureForPoint(pointOf(event), this.activeSelection()) !== null,
    onPanResponderGrant: (event) => {
      const activeSelection = this.activeSelection();
      const kind = gestureForPoint(pointOf(event), activeSelection);
      this.gestureStart = kind ? { kind, start: activeSelection } : null;
    },
    onPanResponderMove: (_event, gesture) => {
      if (!this.gestureStart) return;
      const display = fitImage(this.props.image, this.state.viewport);
      this.setState({ selection: adjustSelection(this.gestureStart.start, this.gestureStart.kind, gesture.dx, gesture.dy, display) });
    },
    onPanResponderRelease: () => { this.gestureStart = null; },
    onPanResponderTerminate: () => { this.gestureStart = null; },
    onPanResponderTerminationRequest: () => false,
  });

  render() {
    const { image, styles, palette, bottomInset, busy, onCancel, onConfirm } = this.props;
    const display = fitImage(image, this.state.viewport);
    const activeSelection = this.activeSelection();
    const confirm = () => {
      if (busy || display.width <= 0 || display.height <= 0) return;
      onConfirm(toMediaCrop(activeSelection, display, image));
    };
    return (
      <View style={styles.cropEditor}>
        <View onLayout={this.onLayout} style={styles.cropViewport} {...this.responder.panHandlers}>
          {display.width > 0 && display.height > 0 ? <Image resizeMode="stretch" source={{ uri: image.uri }} style={[styles.cropImage, { left: display.left, top: display.top, width: display.width, height: display.height }]} /> : null}
          {display.width > 0 && display.height > 0 ? <>
            <View pointerEvents="none" style={[styles.cropShade, { height: activeSelection.top, left: 0, top: 0, width: '100%' }]} />
            <View pointerEvents="none" style={[styles.cropShade, { bottom: 0, left: 0, top: activeSelection.bottom, width: activeSelection.left }]} />
            <View pointerEvents="none" style={[styles.cropShade, { bottom: 0, right: 0, top: activeSelection.bottom, left: activeSelection.right }]} />
            <View pointerEvents="none" style={[styles.cropShade, { height: activeSelection.bottom - activeSelection.top, left: 0, top: activeSelection.top, width: activeSelection.left }]} />
            <View pointerEvents="none" style={[styles.cropShade, { height: activeSelection.bottom - activeSelection.top, right: 0, top: activeSelection.top, left: activeSelection.right }]} />
            <View pointerEvents="none" style={[styles.cropBox, { height: activeSelection.bottom - activeSelection.top, left: activeSelection.left, top: activeSelection.top, width: activeSelection.right - activeSelection.left }]}>
              <View style={[styles.cropHandle, styles.cropHandleTopLeft]} />
              <View style={[styles.cropHandle, styles.cropHandleTopRight]} />
              <View style={[styles.cropHandle, styles.cropHandleBottomLeft]} />
              <View style={[styles.cropHandle, styles.cropHandleBottomRight]} />
            </View>
            <View pointerEvents="none" style={styles.cropHint}><Text style={styles.cropHintText}>拖动框内移动，拖动四角调整范围</Text></View>
          </> : null}
        </View>
        <View style={[styles.cropActions, { paddingBottom: bottomInset }]}>
          <Pressable accessibilityLabel="取消裁剪" accessibilityRole="button" disabled={busy} onPress={onCancel} style={({ pressed }) => [styles.cropActionSecondary, busy && styles.disabled, pressed && styles.pressed]}>
            <X color={palette.textMuted} size={19}  strokeWidth={iconography.stroke} />
            <Text style={styles.cropActionSecondaryText}>取消</Text>
          </Pressable>
          <Pressable accessibilityLabel="应用裁剪" accessibilityRole="button" disabled={busy} onPress={confirm} style={({ pressed }) => [styles.cropActionPrimary, busy && styles.disabled, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={palette.onPrimary} size="small" /> : <Check color={palette.onPrimary} size={19}  strokeWidth={iconography.stroke} />}
            <Text style={styles.cropActionPrimaryText}>应用裁剪</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  private readonly onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    this.setState((current) => current.viewport.width === width && current.viewport.height === height ? null : { viewport: { width, height } });
  };

  private activeSelection(): CropRect {
    const display = fitImage(this.props.image, this.state.viewport);
    return this.state.selection ?? initialCrop(display);
  }
}

class ZoomableImage extends PureComponent<ZoomableImageProps> {
  private readonly scale = new Animated.Value(MIN_SCALE);
  private readonly translateX = new Animated.Value(0);
  private readonly translateY = new Animated.Value(0);
  private current: TransformState = { scale: MIN_SCALE, x: 0, y: 0 };
  private start: GestureStart = { scale: MIN_SCALE, x: 0, y: 0, pinchDistance: 0, singleTouch: false, moved: false };
  private lastTap = 0;
  private viewport = { width: 0, height: 0 };
  private readonly responder: PanResponderInstance = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches;
      this.start = {
        ...this.current,
        pinchDistance: touches.length >= 2 ? touchDistance(event) : 0,
        singleTouch: touches.length === 1,
        moved: false,
      };
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      this.start.moved = this.start.moved || Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5;
      if (touches.length >= 2 && this.start.pinchDistance > 0) {
        const nextScale = clamp(this.start.scale * (touchDistance(event) / this.start.pinchDistance), MIN_SCALE, MAX_SCALE);
        this.setTransform(boundTransform({ scale: nextScale, x: this.current.x, y: this.current.y }, this.viewport));
        return;
      }
      if (touches.length === 1 && this.start.scale > MIN_SCALE) {
        this.setTransform(boundTransform({
          scale: this.start.scale,
          x: this.start.x + gesture.dx,
          y: this.start.y + gesture.dy,
        }, this.viewport));
      }
    },
    onPanResponderRelease: () => {
      if (this.start.singleTouch && !this.start.moved) {
        const now = Date.now();
        if (now - this.lastTap < 280) {
          this.lastTap = 0;
          this.animateTransform(this.current.scale > MIN_SCALE
            ? { scale: MIN_SCALE, x: 0, y: 0 }
            : { scale: DOUBLE_TAP_SCALE, x: 0, y: 0 });
          return;
        }
        this.lastTap = now;
      }
      this.animateTransform(boundTransform(this.current, this.viewport));
    },
    onPanResponderTerminate: () => this.animateTransform(boundTransform(this.current, this.viewport)),
    onPanResponderTerminationRequest: () => false,
  });

  componentDidUpdate(previous: ZoomableImageProps) {
    if (previous.resetToken !== this.props.resetToken || previous.uri !== this.props.uri) this.reset();
  }

  render() {
    const { styles, title, uri } = this.props;
    return (
      <View
        accessibilityLabel={`查看图片：${title}`}
        accessibilityRole="image"
        onLayout={this.onLayout}
        style={styles.viewport}
        {...this.responder.panHandlers}
      >
        <Animated.View
          style={[styles.imageFrame, { transform: [{ translateX: this.translateX }, { translateY: this.translateY }, { scale: this.scale }] }]}
        >
          <Image resizeMode="contain" source={{ uri }} style={styles.image} />
        </Animated.View>
      </View>
    );
  }

  private readonly onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    this.viewport = { width, height };
    this.setTransform(boundTransform(this.current, this.viewport));
  };

  private setTransform(next: TransformState) {
    this.current = next;
    this.scale.setValue(next.scale);
    this.translateX.setValue(next.x);
    this.translateY.setValue(next.y);
  }

  private animateTransform(next: TransformState) {
    this.current = next;
    Animated.parallel([
      Animated.spring(this.scale, { toValue: next.scale, useNativeDriver: true, speed: 24, bounciness: 0 }),
      Animated.spring(this.translateX, { toValue: next.x, useNativeDriver: true, speed: 24, bounciness: 0 }),
      Animated.spring(this.translateY, { toValue: next.y, useNativeDriver: true, speed: 24, bounciness: 0 }),
    ]).start();
  }

  private reset() {
    this.lastTap = 0;
    this.animateTransform({ scale: MIN_SCALE, x: 0, y: 0 });
  }
}

function fitImage(image: StoredImage, viewport: { width: number; height: number }): ImageDisplayRect {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const left = (viewport.width - width) / 2;
  const top = (viewport.height - height) / 2;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function initialCrop(bounds: ImageDisplayRect): CropRect {
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return bounds;
  const insetX = Math.min(bounds.right - bounds.left, Math.max(0, (bounds.right - bounds.left - MIN_CROP_SIZE) / 2) * 0.16);
  const insetY = Math.min(bounds.bottom - bounds.top, Math.max(0, (bounds.bottom - bounds.top - MIN_CROP_SIZE) / 2) * 0.16);
  return { left: bounds.left + insetX, top: bounds.top + insetY, right: bounds.right - insetX, bottom: bounds.bottom - insetY };
}

function pointOf(event: GestureResponderEvent): { x: number; y: number } {
  return { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
}

function gestureForPoint(point: { x: number; y: number }, rect: CropRect): CropGesture | null {
  if (near(point, rect.left, rect.top)) return 'top-left';
  if (near(point, rect.right, rect.top)) return 'top-right';
  if (near(point, rect.left, rect.bottom)) return 'bottom-left';
  if (near(point, rect.right, rect.bottom)) return 'bottom-right';
  if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return 'move';
  return null;
}

function near(point: { x: number; y: number }, x: number, y: number): boolean {
  return Math.abs(point.x - x) <= CROP_HANDLE_HIT_SIZE / 2 && Math.abs(point.y - y) <= CROP_HANDLE_HIT_SIZE / 2;
}

function adjustSelection(start: CropRect, kind: CropGesture, dx: number, dy: number, bounds: ImageDisplayRect): CropRect {
  const minWidth = Math.min(MIN_CROP_SIZE, bounds.right - bounds.left);
  const minHeight = Math.min(MIN_CROP_SIZE, bounds.bottom - bounds.top);
  if (kind === 'move') {
    const width = start.right - start.left;
    const height = start.bottom - start.top;
    const left = clamp(start.left + dx, bounds.left, bounds.right - width);
    const top = clamp(start.top + dy, bounds.top, bounds.bottom - height);
    return { left, top, right: left + width, bottom: top + height };
  }
  let { left, top, right, bottom } = start;
  if (kind === 'top-left' || kind === 'bottom-left') left = clamp(start.left + dx, bounds.left, start.right - minWidth);
  if (kind === 'top-right' || kind === 'bottom-right') right = clamp(start.right + dx, start.left + minWidth, bounds.right);
  if (kind === 'top-left' || kind === 'top-right') top = clamp(start.top + dy, bounds.top, start.bottom - minHeight);
  if (kind === 'bottom-left' || kind === 'bottom-right') bottom = clamp(start.bottom + dy, start.top + minHeight, bounds.bottom);
  return { left, top, right, bottom };
}

function toMediaCrop(selection: CropRect, display: ImageDisplayRect, image: StoredImage): MediaImageCrop {
  const scaleX = image.width / (display.right - display.left);
  const scaleY = image.height / (display.bottom - display.top);
  const originX = clamp(Math.round((selection.left - display.left) * scaleX), 0, Math.max(0, image.width - 1));
  const originY = clamp(Math.round((selection.top - display.top) * scaleY), 0, Math.max(0, image.height - 1));
  const width = Math.max(1, Math.min(image.width - originX, Math.round((selection.right - selection.left) * scaleX)));
  const height = Math.max(1, Math.min(image.height - originY, Math.round((selection.bottom - selection.top) * scaleY)));
  return { originX, originY, width, height };
}

function touchDistance(event: GestureResponderEvent): number {
  const [first, second] = event.nativeEvent.touches;
  if (!first || !second) return 0;
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}

function boundTransform(value: TransformState, viewport: { width: number; height: number }): TransformState {
  const nextScale = clamp(value.scale, MIN_SCALE, MAX_SCALE);
  if (nextScale <= MIN_SCALE || viewport.width <= 0 || viewport.height <= 0) return { scale: MIN_SCALE, x: 0, y: 0 };
  const maxX = viewport.width * (nextScale - 1) / 2;
  const maxY = viewport.height * (nextScale - 1) / 2;
  return { scale: nextScale, x: clamp(value.x, -maxX, maxX), y: clamp(value.y, -maxY, maxY) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function messageOf(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: { backgroundColor: palette.canvas, flex: 1 },
    toolbar: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 64, paddingBottom: spacing.sm, paddingHorizontal: spacing.md },
    toolbarActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
    iconButton: { alignItems: 'center', borderRadius: radius.control, height: 42, justifyContent: 'center', width: 42 },
    doneButton: { alignItems: 'center', borderRadius: radius.control, flexDirection: 'row', gap: spacing.xs, minHeight: 42, paddingHorizontal: spacing.sm },
    doneText: { color: palette.brand, fontSize: 13, fontWeight: '700' },
    title: { color: palette.text, flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
    viewport: { flex: 1, overflow: 'hidden' },
    imageFrame: { height: '100%', width: '100%' },
    image: { height: '100%', width: '100%' },
    editorToolbar: { alignItems: 'center', backgroundColor: palette.surface, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.md, justifyContent: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    editorTool: { alignItems: 'center', borderRadius: radius.control, gap: spacing.xs, justifyContent: 'center', minHeight: 56, minWidth: 88, paddingHorizontal: spacing.md },
    editorToolText: { color: palette.brand, fontSize: 13, fontWeight: '700' },
    errorBar: { backgroundColor: palette.surfaceRaised, borderBottomColor: palette.border, borderBottomWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    errorText: { color: palette.danger, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    loading: { alignItems: 'center', flex: 1, gap: spacing.sm, justifyContent: 'center' },
    loadingText: { color: palette.textMuted, fontSize: 13 },
    cropEditor: { flex: 1 },
    cropViewport: { backgroundColor: '#050805', flex: 1, overflow: 'hidden' },
    cropImage: { position: 'absolute' },
    cropShade: { backgroundColor: 'rgba(0, 0, 0, 0.58)', position: 'absolute' },
    cropBox: { borderColor: palette.primary, borderWidth: 2, position: 'absolute' },
    cropHandle: { backgroundColor: palette.primary, borderRadius: 4, height: 14, position: 'absolute', width: 14 },
    cropHandleTopLeft: { left: -7, top: -7 },
    cropHandleTopRight: { right: -7, top: -7 },
    cropHandleBottomLeft: { bottom: -7, left: -7 },
    cropHandleBottomRight: { bottom: -7, right: -7 },
    cropHint: { alignItems: 'center', bottom: spacing.lg, left: 0, position: 'absolute', right: 0 },
    cropHintText: { backgroundColor: 'rgba(0, 0, 0, 0.64)', borderRadius: radius.pill, color: '#FFFFFF', fontSize: 12, overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    cropActions: { alignItems: 'center', backgroundColor: palette.surface, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    cropActionSecondary: { alignItems: 'center', borderColor: palette.border, borderRadius: radius.control, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 44, minWidth: 92, paddingHorizontal: spacing.md },
    cropActionSecondaryText: { color: palette.textMuted, fontSize: 14, fontWeight: '700' },
    cropActionPrimary: { alignItems: 'center', backgroundColor: palette.primary, borderRadius: radius.control, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 44, minWidth: 124, paddingHorizontal: spacing.md },
    cropActionPrimaryText: { color: palette.onPrimary, fontSize: 14, fontWeight: '700' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.66 },
  });
}
