import { router, useFocusEffect, useNavigation } from 'expo-router';
import { type NavigationProp, usePreventRemove } from 'expo-router/react-navigation';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler } from 'react-native';

import { isPrimaryRoute, isSameReaderPage, readerRouteHref, resolveReaderBackAction, type ReaderPrimaryName, type ReaderRoute, type ReaderRouteParams } from './navigation';
import { createReaderLeaveController, type ReaderLeaveGuard } from './reader-leave-controller';
import { useReaderNavigationState } from './reader-navigation-state';

const ReaderNavigationGuardContext = createContext<((guard: ReaderLeaveGuard | null) => void) | null>(null);

export function ReaderNavigationGuardProvider({ children, register }: PropsWithChildren<{ register: (guard: ReaderLeaveGuard | null) => void }>) {
  return <ReaderNavigationGuardContext.Provider value={register}>{children}</ReaderNavigationGuardContext.Provider>;
}

export function useReaderNavigationGuard(guard: ReaderLeaveGuard) {
  const register = useContext(ReaderNavigationGuardContext);
  const currentGuard = useRef(guard);
  useLayoutEffect(() => { currentGuard.current = guard; }, [guard]);
  useEffect(() => {
    register?.((cancel) => currentGuard.current(cancel));
    return () => register?.(null);
  }, [register]);
}

export function useReaderNavigation(route: ReaderRoute) {
  const navigation = useNavigation<NavigationProp<Record<string, ReaderRouteParams>>>();
  const [, setState] = useReaderNavigationState();
  const [leave] = useState(createReaderLeaveController);
  const preventRemove = useSyncExternalStore(leave.subscribe, leave.getSnapshot, leave.getSnapshot);

  usePreventRemove(preventRemove, ({ data }) => {
    leave.request(() => navigation.dispatch(data.action));
  });
  useEffect(() => { leave.flush(); }, [leave, preventRemove]);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  const goBack = useCallback(() => leave.confirm(back), [back, leave]);
  const primary = isPrimaryRoute(route);
  useFocusEffect(useCallback(() => {
    leave.reset();
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (resolveReaderBackAction(primary, router.canGoBack()) === 'exit-app') return false;
      leave.request(back);
      return true;
    });
    return () => subscription.remove();
  }, [back, leave, primary]));

  const selectPrimary = useCallback((name: ReaderPrimaryName) => {
    leave.request(() => {
      setState((current) => ({ ...current, primary: name }));
      if (!primary) router.dismissTo('/');
    });
  }, [leave, primary, setState]);
  const navigate = (next: ReaderRoute) => {
    if (isPrimaryRoute(next)) selectPrimary(next.name);
    else router.push(readerRouteHref(next));
  };
  const replaceRoute = (next: ReaderRoute) => {
    if (isPrimaryRoute(next)) { selectPrimary(next.name); return; }
    if (!isPrimaryRoute(route) && isSameReaderPage(route, next)) {
      navigation.setParams(readerRouteHref(next).params);
    } else leave.confirm(() => router.replace(readerRouteHref(next)));
  };
  const replaceFromSidebar = (next: ReaderRoute) => {
    if (!isPrimaryRoute(route) && !isPrimaryRoute(next) && isSameReaderPage(route, next)) {
      navigation.setParams(readerRouteHref(next).params);
      return;
    }
    leave.request(() => {
      if (!isPrimaryRoute(next)) router.replace(readerRouteHref(next));
    });
  };

  return { navigate, replaceRoute, replaceFromSidebar, goBack, selectPrimary, registerGuard: leave.register };
}
