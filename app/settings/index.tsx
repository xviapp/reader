import { router } from 'expo-router';
import {
  ArchiveRestore,
  BookOpen,
  Info,
  Languages,
  Palette,
  Server,
  Sparkles,
  Trash2,
  UserRoundCog,
  Wifi,
} from 'lucide-react-native';

import { AppScreen, ListRow, SubpageHeader } from '@/core/ui/host-components';

export default function SettingsScreen() {
  return (
    <AppScreen>
      <SubpageHeader title="设置" />
      <ListRow icon={BookOpen} title="专注阅读" onPress={() => router.push('/settings/reading')} />
      <ListRow icon={Languages} title="本地文字识别" onPress={() => router.push('/settings/recognition')} />
      <ListRow icon={Server} title="AI 服务" onPress={() => router.push('/settings/ai')} />
      <ListRow icon={Wifi} title="局域网阅读" onPress={() => router.push('/settings/lan')} />
      <ListRow icon={UserRoundCog} title="阅读角色" onPress={() => router.push('/settings/roles')} />
      <ListRow icon={Sparkles} title="Prompt 模板" onPress={() => router.push('/settings/prompts')} />
      <ListRow icon={ArchiveRestore} title="备份与恢复" onPress={() => router.push('/settings/backup')} />
      <ListRow icon={Trash2} title="回收站" onPress={() => router.push('/settings/trash')} />
      <ListRow icon={Palette} title="主题" onPress={() => router.push('/settings/theme')} />
      <ListRow icon={Info} title="关于阅读" onPress={() => router.push('/settings/about')} />
    </AppScreen>
  );
}
