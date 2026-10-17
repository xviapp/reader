import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const KeyboardVisibilityContext = createContext<boolean | null>(null);

function useKeyboardVisibilityState() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return visible;
}

/**
 * Provides keyboard visibility context without wrapping children in a View.
 * Use this around the root Stack navigator to avoid breaking react-native-screens
 * Fragment transitions on Android.
 */
export function KeyboardVisibilityProvider({ children }: PropsWithChildren) {
  const visible = useKeyboardVisibilityState();
  return (
    <KeyboardVisibilityContext.Provider value={visible}>
      {children}
    </KeyboardVisibilityContext.Provider>
  );
}

/**
 * @deprecated Use {@link KeyboardVisibilityProvider} around the root navigator
 * and {@link KeyboardAvoidingSurface} inside individual screens instead.
 * Wrapping a Stack navigator in KeyboardAvoidingView breaks react-native-screens
 * Fragment transitions on Android.
 */
export function KeyboardLayout({ children }: PropsWithChildren) {
  const visible = useKeyboardVisibilityState();

  return (
    <KeyboardVisibilityContext.Provider value={visible}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        {children}
      </KeyboardAvoidingView>
    </KeyboardVisibilityContext.Provider>
  );
}

export function KeyboardAvoidingSurface({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.fill, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}

export function useKeyboardVisible(): boolean {
  const visible = useContext(KeyboardVisibilityContext);
  if (visible === null) throw new Error('useKeyboardVisible must be used inside KeyboardVisibilityProvider');
  return visible;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
