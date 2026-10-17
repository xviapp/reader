import { useEffect, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType, type LayoutRectangle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from './reduced-motion';
import type { SplashContentContext } from './startup-shell';

type Props = SplashContentContext & {
  image: ImageSourcePropType;
  name: string;
  slogan: string;
};

// Keep aligned with expo-splash-screen imageWidth in each app.json.
const NATIVE_SIZE = 132;
const READABLE_HOLD_MS = 384;

/** One image moves from the native splash bounds into the measured artwork slot. */
export function BrandedStartupSplash({ phase, onReady, onEntered, image, name, slogan }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [root, setRoot] = useState<LayoutRectangle | null>(null);
  const [slot, setSlot] = useState<LayoutRectangle | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const [scaleProgress] = useState(() => new Animated.Value(0));
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const reduceMotion = useReducedMotion();
  const handedOff = phase !== 'handoff';
  const measured = !!root && !!slot && root.width > 0 && root.height > 0 && slot.width > 0 && slot.height > 0;

  useEffect(() => {
    if (imageReady && measured) onReady();
  }, [imageReady, measured, onReady]);

  useEffect(() => {
    if (!handedOff) return;
    // Translation and text stay monotonic; only the icon size has a soft rebound.
    const animation = Animated.parallel([
      Animated.timing(progress, {
        toValue: 1, duration: reduceMotion ? 0 : 800,
        easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
      }),
      reduceMotion
        ? Animated.timing(scaleProgress, { toValue: 1, duration: 0, useNativeDriver: true })
        : Animated.spring(scaleProgress, {
          toValue: 1, stiffness: 180, damping: 18, mass: 1,
          restDisplacementThreshold: 0.003, restSpeedThreshold: 0.03,
          useNativeDriver: true,
        }),
    ]);
    animation.start(({ finished }) => { if (finished) setEntranceComplete(true); });
    return () => animation.stop();
  }, [handedOff, progress, scaleProgress, reduceMotion]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  // Keep the fully settled artwork readable before allowing the shell to exit.
  // A background interruption restarts the hold when the user returns.
  useEffect(() => {
    if (!entranceComplete || !active) return;
    const timer = setTimeout(onEntered, READABLE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [entranceComplete, active, onEntered]);

  const destinationSize = slot ? Math.min(slot.width, slot.height) : NATIVE_SIZE;
  const interpolate = (end: number, start = 0) => progress.interpolate({ inputRange: [0, 1], outputRange: [start, end] });

  return (
    <View style={styles.root} onLayout={event => setRoot(event.nativeEvent.layout)}
      accessible accessibilityLabel={slogan + '，正在加载'}
      accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      <StatusBar style="dark" />
      <View style={[styles.layout, {
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + Math.max(40, height * 0.065),
        paddingLeft: insets.left + 24, paddingRight: insets.right + 24,
      }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.artworkSlot} onLayout={event => setSlot(event.nativeEvent.layout)} />
        <Animated.View style={[styles.caption, { opacity: progress.interpolate({
          inputRange: [0, 0.35, 1], outputRange: [0, 0, 1],
        }) }]}>
          <Text style={styles.name} maxFontSizeMultiplier={1.5}>{name}</Text>
          <Text style={styles.slogan} maxFontSizeMultiplier={2}>{slogan}</Text>
        </Animated.View>
      </View>
      <Animated.Image source={image} resizeMode="contain" fadeDuration={0}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        onLoad={() => setImageReady(true)}
        onError={() => { setImageFailed(true); setImageReady(true); }}
        style={[styles.image, {
          left: ((root?.width ?? 0) - NATIVE_SIZE) / 2,
          top: ((root?.height ?? 0) - NATIVE_SIZE) / 2,
          opacity: measured && !imageFailed ? 1 : 0,
          transform: [
            { translateX: interpolate(root && slot ? slot.x + slot.width / 2 - root.width / 2 : 0) },
            { translateY: interpolate(root && slot ? slot.y + slot.height / 2 - root.height / 2 : 0) },
            { scale: scaleProgress.interpolate({ inputRange: [0, 1], outputRange: [1, destinationSize / NATIVE_SIZE] }) },
          ],
        }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#F9EFE2' },
  layout: { flex: 1 },
  artworkSlot: { flex: 1, width: '100%' },
  image: { position: 'absolute', width: NATIVE_SIZE, height: NATIVE_SIZE },
  caption: { alignItems: 'center', gap: 12, marginTop: 24 },
  name: { color: '#304B60', fontSize: 30, lineHeight: 42, fontWeight: '500', letterSpacing: 6, textAlign: 'center' },
  slogan: { color: '#304B60', fontSize: 16, lineHeight: 26, letterSpacing: 2, textAlign: 'center' },
});
