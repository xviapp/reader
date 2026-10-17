import { useLocalSearchParams } from 'expo-router';

import { ReaderRoleRoute } from '@/modules/reader/ui/settings-routes';

export default function RoleSettingsRoute() {
  const { roleId } = useLocalSearchParams<{ roleId: string | string[] }>();
  return <ReaderRoleRoute roleIdParam={roleId} />;
}
