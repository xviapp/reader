export const APP_CONFIG = {
  databaseName: 'reader-local.db',
  themeStorageKey: 'reader.appearance.theme-mode.v1',
  ai: {
    settingsKey: 'reader.ai.services.v2',
    responseStateKey: 'reader.ai.responses.state.v1',
    nativeExecutionModule: 'ReaderAiExecution',
  },
  readingProgressPrefix: 'reader.reading-progress.v1.',
  mediaDirectory: 'reader-media',
} as const;
