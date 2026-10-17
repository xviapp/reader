import { useCallback, useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Animated,
  AppState,
  StyleSheet,
  View,
} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useReducedMotion } from './reduced-motion';

// Android can briefly reveal the React surface while transferring its system
// splash view to an exit animation. Hide it without a native fade; the matching
// React overlay below owns the visible transition instead.
SplashScreen.setOptions({ duration: 0, fade: false });
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const SPLASH_FADE_DURATION_MS = 220;

export type SplashContentContext = {
  /** Match the native background during handoff, then reveal the artwork. */
  phase: 'handoff' | 'loading' | 'exiting';
  onReady: () => void;
  onEntered: () => void;
};

export type StartupShellProps = PropsWithChildren<{
  ready: boolean;
  backgroundColor: string;
  splashBackgroundColor: string;
  /** Signal readiness after artwork loads (or fails), then signal its full reveal. */
  renderSplashContent: (context: SplashContentContext) => ReactNode;
}>;

/** Hands native startup to an opaque React surface, then reveals the ready app. */
export function StartupShell({
  ready,
  backgroundColor,
  children,
  splashBackgroundColor,
  renderSplashContent,
}: StartupShellProps) {
  const [layoutReady, setLayoutReady] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayOpacity] = useState(() => new Animated.Value(1));
  const [handedOff, setHandedOff] = useState(false);
  const [customReady, setCustomReady] = useState(false);
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const reduceMotion = useReducedMotion();
  const handleCustomReady = useCallback(() => setCustomReady(true), []);
  const handleEntered = useCallback(() => setEntranceComplete(true), []);
  const phase: SplashContentContext['phase'] = !handedOff ? 'handoff' : ready && entranceComplete && active ? 'exiting' : 'loading';
  const [contentReady, setContentReady] = useState(false);
  const handleLayout = useCallback(() => setLayoutReady(true), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (handedOff || !layoutReady || !contentReady || !customReady) return;
    SplashScreen.hide();

    // The matching native-size image is ready underneath the system splash.
    // Start its crossfade after Android completes the two-frame handoff.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        setHandedOff(true);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [contentReady, customReady, handedOff, layoutReady]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const animation = Animated.timing(overlayOpacity, {
      duration: reduceMotion ? 0 : SPLASH_FADE_DURATION_MS,
      toValue: 0,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setOverlayVisible(false);
    });
    return () => animation.stop();
  }, [overlayOpacity, phase, reduceMotion]);

  return (
    <View onLayout={handleLayout} style={[styles.root, { backgroundColor }]}>
      <View style={styles.root} accessibilityElementsHidden={overlayVisible}
        importantForAccessibility={overlayVisible ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {overlayVisible ? (
        <Animated.View
          onLayout={() => setContentReady(true)}
          pointerEvents="auto"
          accessibilityViewIsModal
          style={[styles.overlay, { backgroundColor: splashBackgroundColor, opacity: overlayOpacity }]}
        >
          {renderSplashContent({ phase, onReady: handleCustomReady, onEntered: handleEntered })}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
