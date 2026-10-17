import { useLocalSearchParams } from 'expo-router';

import { ReaderPromptRoute } from '@/modules/reader/ui/settings-routes';

export default function PromptSettingsRoute() {
  const { stage } = useLocalSearchParams<{ stage: string | string[] }>();
  return <ReaderPromptRoute stageParam={stage} />;
}
