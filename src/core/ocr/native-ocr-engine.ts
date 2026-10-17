import { requireNativeModule } from 'expo';

import type { OcrBlock, OcrEngine, OcrResult, OcrScript } from './ocr-engine';

interface NativeOcrModule {
  recognize(uri: string, script: OcrScript): Promise<unknown>;
}

export class NativeOcrEngine implements OcrEngine {
  async recognize(uri: string, script: OcrScript): Promise<OcrResult> {
    const native = requireNativeModule<NativeOcrModule>('ReaderOcr');
    return parseResult(await native.recognize(uri, script));
  }
}

function parseResult(value: unknown): OcrResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OCR 返回了无效结果');
  const record = value as Record<string, unknown>;
  const script = record.script === 'latin' || record.script === 'chinese' ? record.script : 'auto';
  const blocks = Array.isArray(record.blocks) ? record.blocks.map(parseBlock).filter((item): item is OcrBlock => item !== null) : [];
  return { fullText: typeof record.fullText === 'string' ? record.fullText : '', script, blocks };
}

function parseBlock(value: unknown): OcrBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const box = record.box;
  if (typeof record.text !== 'string' || !box || typeof box !== 'object' || Array.isArray(box)) return null;
  const bounds = box as Record<string, unknown>;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((item) => typeof item === 'number')) return null;
  return {
    text: record.text,
    confidence: typeof record.confidence === 'number' ? record.confidence : null,
    box: {
      x: bounds.x as number,
      y: bounds.y as number,
      width: bounds.width as number,
      height: bounds.height as number,
    },
  };
}
