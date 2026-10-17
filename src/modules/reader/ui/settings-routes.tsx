import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { type ReaderRuntimeValue, useReaderRuntime } from '@/core/runtime/reader-runtime';

import type { ReaderPromptStage } from '../domain/model';
import { useReaderRepositoryState } from '../composition';
import { ReaderTrashScreen } from './library';
import { ReaderBackupScreen } from './backup';
import {
  ReaderPromptEditorScreen,
  ReaderPromptsScreen,
  ReaderReadingSettingsScreen,
  ReaderRecognitionSettingsScreen,
  ReaderRoleEditorScreen,
  ReaderRolesScreen,
} from './settings';
import { useReaderPassage, useReaderWorkspace, type ReaderWorkspaceQueryName } from './use-reader-workspace';
import { ReaderDetailPane, ReaderError, ReaderSkeletonRows } from './reader-ui';

const WIDE_READER_WIDTH = 840;
const PROMPTS_QUERIES = ['prompts'] as const satisfies readonly ReaderWorkspaceQueryName[];
const PROMPT_EDITOR_QUERIES = ['books', 'passages', 'prompts', 'roles'] as const satisfies readonly ReaderWorkspaceQueryName[];
const PREFERENCES_QUERIES = ['preferences'] as const satisfies readonly ReaderWorkspaceQueryName[];
const ROLES_QUERIES = ['roles'] as const satisfies readonly ReaderWorkspaceQueryName[];
const TRASH_QUERIES = ['books', 'passages', 'discussions'] as const satisfies readonly ReaderWorkspaceQueryName[];

export function ReaderPromptsRoute() {
  const data = useSettingsWorkspace(PROMPTS_QUERIES);
  return <SettingsDataBoundary {...data} loading={settingsLoadingOf(data)} error={data.reader.dataError ?? data.workspace.queryError}>
    <ReaderPromptsScreen
      onBack={() => router.back()}
      onOpen={(stage) => { router.push({ pathname: '/settings/prompt/[stage]', params: { stage } }); }}
      prompts={data.workspace.prompts}
      wide={data.wide}
    />
  </SettingsDataBoundary>;
}

export function ReaderPromptRoute({ stageParam }: { stageParam: string | string[] | undefined }) {
  const data = useSettingsWorkspace(PROMPT_EDITOR_QUERIES);
  const passageId = data.workspace.passages.find((item) => item.deletedAt === null)?.id ?? null;
  const passage = useReaderPassage(data.repository, passageId);
  const stage = promptStageOf(firstParam(stageParam));
  return <SettingsDataBoundary {...data} loading={settingsLoadingOf(data)} error={data.reader.dataError ?? data.workspace.queryError}>
    {stage ? (() => {
      const prompt = data.workspace.prompts.find((item) => item.stage === stage);
      return prompt ? <ReaderPromptEditorScreen books={data.workspace.books} onBack={() => router.back()} passage={passage.item} prompt={prompt} repository={data.repository!} roles={data.workspace.roles} wide={data.wide} /> : <SettingsRouteError message="Prompt 还没有准备好" onRetry={data.retry} wide={data.wide} />;
    })() : <SettingsRouteError message="Prompt 类型无效" onRetry={data.retry} wide={data.wide} />}
  </SettingsDataBoundary>;
}

export function ReaderRecognitionRoute() {
  const data = useSettingsWorkspace(PREFERENCES_QUERIES);
  return <SettingsDataBoundary {...data} loading={settingsLoadingOf(data)} error={data.reader.dataError ?? data.workspace.queryError}>
    {data.workspace.preferences ? <ReaderRecognitionSettingsScreen onBack={() => router.back()} preferences={data.workspace.preferences} repository={data.repository!} wide={data.wide} /> : <SettingsRouteError message="Reader 设置还没有准备好" onRetry={data.retry} wide={data.wide} />}
  </SettingsDataBoundary>;
}

export function ReaderReadingRoute() {
  const { width } = useWindowDimensions();
  return <ReaderReadingSettingsScreen onBack={() => router.back()} wide={width >= WIDE_READER_WIDTH} />;
}

export function ReaderBackupRoute() {
  const data = useSettingsWorkspace([]);
  return <SettingsDataBoundary {...data} loading={data.reader.dataPhase !== 'ready'} error={data.reader.dataError}>
    {data.repository ? <ReaderBackupScreen onBack={() => router.back()} repository={data.repository} wide={data.wide} /> : <SettingsRouteError message="本地数据服务还没有准备好" onRetry={data.retry} wide={data.wide} />}
  </SettingsDataBoundary>;
}

export function ReaderRolesRoute() {
  const data = useSettingsWorkspace(ROLES_QUERIES);
  return <SettingsDataBoundary {...data} loading={settingsLoadingOf(data)} error={data.reader.dataError ?? data.workspace.queryError}>
    <ReaderRolesScreen
      onBack={() => router.back()}
      onOpen={(roleId) => { router.push({ pathname: '/settings/role/[roleId]', params: { roleId } }); }}
      roles={data.workspace.roles}
      wide={data.wide}
    />
  </SettingsDataBoundary>;
}

export function ReaderRoleRoute({ roleIdParam }: { roleIdParam: string | string[] | undefined }) {
  const data = useSettingsWorkspace(ROLES_QUERIES);
  const roleId = firstParam(roleIdParam);
  return <SettingsDataBoundary {...data} loading={settingsLoadingOf(data)} error={data.reader.dataError ?? data.workspace.queryError}>
    {roleId ? (() => {
      const role = data.workspace.roles.find((item) => item.id === roleId);
      return role ? <ReaderRoleEditorScreen onBack={() => router.back()} repository={data.repository!} role={role} wide={data.wide} /> : <SettingsRouteError message="找不到这个阅读角色" onRetry={data.retry} wide={data.wide} />;
    })() : <SettingsRouteError message="阅读角色无效" onRetry={data.retry} wide={data.wide} />}
  </SettingsDataBoundary>;
}

export function ReaderTrashRoute() {
  const data = useSettingsWorkspace(TRASH_QUERIES);
  const [operationError, setOperationError] = useState<string | null>(null);
  const error = data.reader.dataError ?? data.workspace.queryError;
  const loading = data.reader.dataPhase !== 'ready' || data.workspace.queryLoading;
  if (error) return <SettingsRouteError message={error} onRetry={data.retry} wide={data.wide} />;
  if (loading || !data.repository) return <ReaderDetailPane wide={data.wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
  return <>
    {operationError ? <ReaderError message={operationError} onRetry={() => setOperationError(null)} retryLabel="关闭" /> : null}
    <ReaderTrashScreen
      books={data.workspace.books}
      discussions={data.workspace.discussions}
      media={data.runtime.media}
      onBack={() => router.back()}
      onError={setOperationError}
      passages={data.workspace.passages}
      repository={data.repository}
      wide={data.wide}
    />
  </>;
}

interface SettingsWorkspace {
  reader: ReturnType<typeof useReaderRepositoryState>;
  runtime: ReaderRuntimeValue;
  repository: ReturnType<typeof useReaderRepositoryState>['repository'];
  workspace: ReturnType<typeof useReaderWorkspace>;
  wide: boolean;
  retry: () => void;
}

function useSettingsWorkspace(queries: readonly ReaderWorkspaceQueryName[]): SettingsWorkspace {
  const runtime = useReaderRuntime();
  const reader = useReaderRepositoryState();
  const { width } = useWindowDimensions();
  const workspace = useReaderWorkspace({ queries });
  const retry = () => {
    workspace.retry();
    if (reader.dataPhase === 'error') reader.retryData();
  };
  return { reader, runtime, repository: reader.repository, workspace, wide: width >= WIDE_READER_WIDTH, retry };
}

function settingsLoadingOf(data: SettingsWorkspace): boolean {
  return data.reader.dataPhase !== 'ready' || !data.repository || data.workspace.queryLoading;
}

function SettingsDataBoundary({ children, wide, loading, error, retry }: SettingsWorkspace & { children: ReactNode; loading: boolean; error: string | null }) {
  if (error) return <SettingsRouteError message={error} onRetry={retry} wide={wide} />;
  if (loading) return <ReaderDetailPane wide={wide}><ReaderSkeletonRows count={4} /></ReaderDetailPane>;
  return children;
}

function SettingsRouteError({ message, onRetry, wide }: { message: string; onRetry: () => void; wide: boolean }) {
  return <ReaderDetailPane wide={wide}><ReaderError message={message} onRetry={onRetry} /></ReaderDetailPane>;
}

function promptStageOf(value: string | undefined): ReaderPromptStage | null {
  return value === 'analysis' || value === 'organize' || value === 'discussion' || value === 'follow-up' ? value : null;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
