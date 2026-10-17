import type { ReaderBook, ReaderDiscussion, ReaderMessage, ReaderPassageIndex, ReaderPreferences, ReaderPrompt, ReaderRole } from '../domain/model';
import type { ReaderWorkspaceRepository } from './ports';
import { ReaderQuery } from './reader-query';

export type { ReaderWorkspaceRepository } from './ports';

/** Read projections shared by reader screens. Routes and drafts remain owned by their screens. */
export class ReaderWorkspace {
  readonly books: ReaderQuery<readonly ReaderBook[]>;
  readonly passages: ReaderQuery<readonly ReaderPassageIndex[]>;
  readonly discussions: ReaderQuery<readonly ReaderDiscussion[]>;
  readonly prompts: ReaderQuery<readonly ReaderPrompt[]>;
  readonly roles: ReaderQuery<readonly ReaderRole[]>;
  readonly favorites: ReaderQuery<readonly ReaderMessage[]>;
  readonly preferences: ReaderQuery<ReaderPreferences | null>;
  private snapshot = { ready: false, error: null as string | null };
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private generation = 0;

  constructor(private readonly repository: ReaderWorkspaceRepository) {
    this.books = new ReaderQuery<readonly ReaderBook[]>([], (next, error) => repository.watchBooks(true, next, error));
    this.passages = new ReaderQuery<readonly ReaderPassageIndex[]>([], (next, error) => repository.watchPassageIndex(true, next, error));
    this.discussions = new ReaderQuery<readonly ReaderDiscussion[]>([], (next, error) => repository.watchDiscussions(true, next, error));
    this.prompts = new ReaderQuery<readonly ReaderPrompt[]>([], (next, error) => repository.watchPrompts(next, error));
    this.roles = new ReaderQuery<readonly ReaderRole[]>([], (next, error) => repository.watchRoles(next, error));
    this.favorites = new ReaderQuery<readonly ReaderMessage[]>([], (next, error) => repository.watchFavoriteMessages(next, error));
    this.preferences = new ReaderQuery<ReaderPreferences | null>(null, (next, error) => repository.watchPreferences(next, error));
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start = (): Promise<void> => {
    if (this.initialization) return this.initialization;
    const generation = ++this.generation;
    this.update(false, null);
    this.initialization = this.repository.ensureDefaults().then(() => {
      if (generation === this.generation) this.update(true, null);
    }, (cause: unknown) => {
      if (generation === this.generation) this.update(false, cause instanceof Error ? cause.message : 'Reader 初始化失败');
    });
    return this.initialization;
  };

  retry = (): void => {
    if (this.snapshot.error) {
      this.initialization = null;
      void this.start();
    }
    for (const query of this.queries()) query.retry();
  };

  dispose(): void {
    this.generation++;
    this.initialization = null;
    for (const query of this.queries()) query.dispose();
  }

  private queries() {
    return [this.books, this.passages, this.discussions, this.prompts, this.roles, this.favorites, this.preferences];
  }

  private update(ready: boolean, error: string | null): void {
    this.snapshot = { ready, error };
    for (const listener of this.listeners) listener();
  }
}
