import { createContext, type Dispatch, type PropsWithChildren, type SetStateAction, useContext, useState } from 'react';

import type { ReaderBookStatus } from '../domain/model';
import type { ReaderPrimaryName } from './navigation';

interface ReaderNavigationState {
  primary: ReaderPrimaryName;
  libraryQuery: string;
  libraryStatus: ReaderBookStatus | 'all';
  discussionQuery: string;
  discussionBookFilter: string | null;
}

const ReaderNavigationStateContext = createContext<readonly [ReaderNavigationState, Dispatch<SetStateAction<ReaderNavigationState>>] | null>(null);

/** Shared by the retained home screen and the wide-layout sidebars. */
export function ReaderNavigationStateProvider({ children }: PropsWithChildren) {
  const state = useState<ReaderNavigationState>({
    primary: 'library',
    libraryQuery: '',
    libraryStatus: 'all',
    discussionQuery: '',
    discussionBookFilter: null,
  });
  return <ReaderNavigationStateContext.Provider value={state}>{children}</ReaderNavigationStateContext.Provider>;
}

export function useReaderNavigationState() {
  const state = useContext(ReaderNavigationStateContext);
  if (!state) throw new Error('ReaderNavigationStateProvider is missing');
  return state;
}
