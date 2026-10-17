import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { APP_CONFIG } from '@/core/app-config';
import { ThemeProvider, useAppTheme } from '@/core/design/theme';
import { ReaderRuntimeProvider } from '@/core/runtime/reader-runtime';
import { KeyboardVisibilityProvider } from '@/core/ui/keyboard-layout';
import { StartupShell } from '@/core/ui/startup-shell';
import { StartupSplashContent } from '@/core/ui/startup-splash-content';
import { ReaderProvider } from '@/modules/reader';
import { ReaderLanProvider } from '@/modules/reader/lan/composition';
import { ReaderNavigationStateProvider } from '@/modules/reader/ui/reader-navigation-state';

export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider storageKey={APP_CONFIG.themeStorageKey}><Application /></ThemeProvider></SafeAreaProvider>;
}
function Application() {
  const theme = useAppTheme();
  return (
    <StartupShell
      ready={theme.ready}
      backgroundColor={theme.palette.canvas}
      splashBackgroundColor="#F9EFE2"
      renderSplashContent={content => <StartupSplashContent {...content} />}
    >
      <ReaderRuntimeProvider>
        <ReaderProvider>
          <ReaderLanProvider>
            <StatusBar style={theme.isDark ? 'light' : 'dark'} />
            <KeyboardVisibilityProvider>
              <ReaderNavigationStateProvider>
                <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: theme.palette.canvas } }} />
              </ReaderNavigationStateProvider>
            </KeyboardVisibilityProvider>
          </ReaderLanProvider>
        </ReaderProvider>
      </ReaderRuntimeProvider>
    </StartupShell>
  );
}
