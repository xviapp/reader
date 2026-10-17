import { createAiSettingsStore } from '@/core/ai/ai-settings.native';
import { NativeAiExecutionLease } from '@/core/ai/native-ai-execution';
import { createLocalDatabase } from '@/core/data/database.native';
import { APP_CONFIG } from '@/core/app-config';
import { createNativeMediaLibrary } from '@/core/media/native-media-library';
import { NativeOcrEngine } from '@/core/ocr/native-ocr-engine';
import {
  READER_DATABASE_MIGRATION_STATEMENTS,
  READER_DATABASE_SCHEMA,
} from '@/runtime/reader-database-schema';
import { readingSessions } from '@/core/reading/reading-session-store.native';

import { ReaderRuntime } from './runtime';

export function createReaderRuntime(): ReaderRuntime {
  readingSessions();
  return new ReaderRuntime(
    () => createLocalDatabase({
      name: APP_CONFIG.databaseName,
      schemaStatements: READER_DATABASE_SCHEMA,
      migrationStatements: READER_DATABASE_MIGRATION_STATEMENTS,
    }),
    createAiSettingsStore(),
    undefined,
    {
      media: createNativeMediaLibrary({ directoryName: APP_CONFIG.mediaDirectory }),
      ocr: new NativeOcrEngine(),
      executionLease: new NativeAiExecutionLease(APP_CONFIG.ai.nativeExecutionModule),
    },
  );
}
