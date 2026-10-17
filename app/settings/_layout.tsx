import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/core/design/theme';

export default function SettingsLayout() {
  const { palette } = useAppTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.canvas } }} />
    </SafeAreaView>
  );
}
