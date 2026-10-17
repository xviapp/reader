import { Redirect, useLocalSearchParams } from 'expo-router';

import { readerRouteFromParams, type ReaderDetailRoute } from './navigation';
import { ReaderScreen } from './reader-screen';

export function ReaderRouteScreen({ name }: { name: ReaderDetailRoute['name'] }) {
  const params = useLocalSearchParams();
  const route = readerRouteFromParams(name, params);
  return route ? <ReaderScreen route={route} /> : <Redirect href="/" />;
}
