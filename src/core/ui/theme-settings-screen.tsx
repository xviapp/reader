import { Contrast, Monitor, Moon, Sun } from 'lucide-react-native';

import { useAppTheme } from '@/core/design/theme';
import type { ThemeMode } from '@/core/design/tokens';

import { AppScreen, ListRow, StatusLabel, SubpageHeader } from './host-components';

const options = [
  { id: 'system', label: '跟随系统', detail: '使用设备的外观设置', icon: Monitor },
  { id: 'light', label: '浅色', detail: '始终使用明亮背景', icon: Sun },
  { id: 'dark', label: '深色', detail: '始终使用深色背景', icon: Moon },
  { id: 'oled', label: 'OLED', detail: '使用纯黑背景', icon: Contrast },
] as const satisfies readonly { id: ThemeMode; label: string; detail: string; icon: typeof Monitor }[];

export function ThemeSettingsScreen() {
  const theme = useAppTheme();
  return (
    <AppScreen>
      <SubpageHeader title="主题" />
      {options.map((option) => (
        <ListRow
          detail={option.detail}
          icon={option.icon}
          key={option.id}
          onPress={() => void theme.setMode(option.id)}
          title={option.label}
          trailing={theme.mode === option.id ? <StatusLabel label="当前" tone="success" /> : undefined}
        />
      ))}
    </AppScreen>
  );
}

