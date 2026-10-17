export type OcrScript = 'auto' | 'chinese' | 'latin';

export interface OcrBlock {
  text: string;
  confidence: number | null;
  box: { x: number; y: number; width: number; height: number };
}

export interface OcrResult {
  fullText: string;
  script: OcrScript;
  blocks: readonly OcrBlock[];
}

export interface OcrEngine {
  recognize(uri: string, script: OcrScript): Promise<OcrResult>;
}
