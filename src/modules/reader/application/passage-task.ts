export const ORGANIZE_OPERATION = 'passage-organize';
export const ANALYSIS_OPERATION = 'passage-analysis';
export const USER_STOPPED_ORGANIZATION = '用户停止了整理任务';
export const USER_STOPPED_ANALYSIS = '用户停止了分析任务';

export interface PassageTaskPayload {
  passageId: string;
  sourceRevision: number;
  runAnalysisAfter?: boolean;
  useLatestSource?: boolean;
}
