export type FocusedReadingMode = 'scroll' | 'paged';
export type FocusedReadingFontFamily = 'system' | 'serif';

export interface FocusedReadingPreferences {
  mode: FocusedReadingMode;
  fontFamily: FocusedReadingFontFamily;
  fontSize: number;
  pageMargin: number;
}

export const DEFAULT_FOCUSED_READING_PREFERENCES: FocusedReadingPreferences = {
  mode: 'scroll',
  fontFamily: 'system',
  fontSize: 18,
  pageMargin: 20,
};

const FOCUSED_READING_GLYPH_WIDTH_RATIO = 0.92;
const FOCUSED_READING_PAGE_RESERVE = 52;

export function normalizeFocusedReadingPreferences(value: unknown): FocusedReadingPreferences {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<FocusedReadingPreferences>
    : {};
  return {
    mode: candidate.mode === 'paged' ? 'paged' : 'scroll',
    fontFamily: candidate.fontFamily === 'serif' ? 'serif' : 'system',
    fontSize: clampInteger(candidate.fontSize, 14, 32, DEFAULT_FOCUSED_READING_PREFERENCES.fontSize),
    pageMargin: clampInteger(candidate.pageMargin, 12, 48, DEFAULT_FOCUSED_READING_PREFERENCES.pageMargin),
  };
}

export interface FocusedReadingPageCapacity {
  capacity: number;
  charsPerLine: number;
  maxLines: number;
  lineHeight: number;
  fontSize: number;
}

export function readingContentRevision(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}-${content.length}`;
}

export function charWidthUnit(char: string): number {
  const code = char.charCodeAt(0);
  if (code <= 0x7f) {
    if (char === ' ' || char === '\t') return 0.35;
    if (/[il1.,':;!|`]/i.test(char)) return 0.35;
    if (/[mwMW@#%&]/u.test(char)) return 0.85;
    return 0.58;
  }
  if (code >= 0xff61 && code <= 0xffdc) return 0.55;
  return 1.0;
}

export function estimateLineWidthUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    units += charWidthUnit(char);
  }
  return units;
}

export function estimateSingleLineCount(lineText: string, charsPerLine: number): number {
  const units = estimateLineWidthUnits(lineText);
  if (units <= 0) return 0;
  return Math.max(1, Math.ceil(units / Math.max(1, charsPerLine)));
}

export function estimateTextVisualLines(text: string, charsPerLine: number): number {
  const lines = text.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      totalLines += 0.4;
      continue;
    }
    if (/^#{1}\s+/u.test(trimmed)) {
      totalLines += estimateSingleLineCount(trimmed.slice(2), Math.floor(charsPerLine * 0.75)) * 1.4 + 0.6;
    } else if (/^#{2}\s+/u.test(trimmed)) {
      totalLines += estimateSingleLineCount(trimmed.slice(3), Math.floor(charsPerLine * 0.82)) * 1.25 + 0.5;
    } else if (/^#{3,6}\s+/u.test(trimmed)) {
      totalLines += estimateSingleLineCount(trimmed.replace(/^#+\s+/u, ''), Math.floor(charsPerLine * 0.9)) * 1.15 + 0.4;
    } else if (/^(?:[-*+]|\d+[.)])\s+/u.test(trimmed)) {
      const content = trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/u, '');
      totalLines += estimateSingleLineCount(content, Math.max(4, charsPerLine - 2)) + 0.25;
    } else if (/^\|.*\|$/u.test(trimmed)) {
      totalLines += 1.3;
    } else {
      totalLines += estimateSingleLineCount(trimmed, charsPerLine);
    }
  }
  return totalLines;
}

interface BlockUnit {
  text: string;
  isLine: boolean;
}

function splitBlockIntoUnits(block: string): BlockUnit[] {
  if (block.includes('\n')) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.map((line) => ({ text: line, isLine: true }));
  }
  if (/^```|^[$]{2}/u.test(block)) {
    return [{ text: block, isLine: false }];
  }
  const sentenceRegex = /[^。！？.!?\n]+(?:[。！？]+[’”"』」）)]*|[.!?]+[’”"』」）)]*(?:\s+|$)|$)/gu;
  const matches = block.match(sentenceRegex);
  if (!matches || matches.length <= 1) {
    const clauseRegex = /[^，、,;；\n]+(?:[，、,;；]+[’”"』」）)]*(?:\s+|$)|$)/gu;
    const clauseMatches = block.match(clauseRegex);
    if (clauseMatches && clauseMatches.length > 1) {
      return clauseMatches.map((item) => ({ text: item, isLine: false }));
    }
    return [{ text: block, isLine: false }];
  }
  return matches.map((item) => ({ text: item, isLine: false }));
}

function takeFittingText(text: string, charsPerLine: number, lineBudget: number): { head: string; tail: string } | null {
  if (lineBudget < 1 || text.length < 2) return null;
  const characters = [...text];
  let fittingLength = 0;
  for (let length = 1; length <= characters.length; length += 1) {
    if (estimateTextVisualLines(characters.slice(0, length).join(''), charsPerLine) > lineBudget) break;
    fittingLength = length;
  }
  if (fittingLength <= 0 || fittingLength >= characters.length) return null;

  const preferredBreakStart = Math.max(1, fittingLength - Math.max(charsPerLine * 2, 12));
  for (let index = fittingLength; index >= preferredBreakStart; index -= 1) {
    if (/[\s。！？.!?，、,;；：:]/u.test(characters[index - 1] ?? '')) {
      fittingLength = index;
      break;
    }
  }
  return {
    head: characters.slice(0, fittingLength).join(''),
    tail: characters.slice(fittingLength).join(''),
  };
}

function isSafeToSplitUnit(text: string): boolean {
  return !/^#{1,6}\s+/u.test(text) && !/^```/u.test(text) && !/^\s*\|.*\|\s*$/u.test(text);
}

export function paginateFocusedContent(
  content: string,
  capacityInput: number | FocusedReadingPageCapacity,
): { content: string; oversized: boolean }[] {
  const normCapacity: FocusedReadingPageCapacity = typeof capacityInput === 'number'
    ? {
        capacity: capacityInput,
        charsPerLine: Math.max(8, Math.floor(Math.sqrt(capacityInput * 1.6))),
        maxLines: Math.max(4, Math.floor(capacityInput / Math.max(8, Math.floor(Math.sqrt(capacityInput * 1.6))))),
        lineHeight: 29,
        fontSize: 18,
      }
    : capacityInput;

  const rawBlocks = content.replace(/\r\n?/gu, '\n').split(/\n{2,}/gu).map((item) => item.trim()).filter(Boolean);
  if (rawBlocks.length === 0) return [{ content: '暂无内容', oversized: false }];

  const pages: { content: string; oversized: boolean }[] = [];
  const maxLines = normCapacity.maxLines;
  const charsPerLine = normCapacity.charsPerLine;

  let currentPageText = '';
  let currentPageLines = 0;

  const pushCurrentPage = () => {
    if (currentPageText) {
      pages.push({ content: currentPageText, oversized: false });
      currentPageText = '';
      currentPageLines = 0;
    }
  };

  for (const block of rawBlocks) {
    if (/^```[\s\S]*```$/u.test(block)) {
      const codeLines = estimateTextVisualLines(block, charsPerLine) + 0.6;
      if (codeLines > maxLines) {
        pushCurrentPage();
        pages.push({ content: block, oversized: true });
      } else if (currentPageLines > 0 && currentPageLines + codeLines > maxLines) {
        pushCurrentPage();
        currentPageText = block;
        currentPageLines = codeLines;
      } else {
        currentPageText = currentPageText ? `${currentPageText}\n\n${block}` : block;
        currentPageLines += codeLines;
      }
      continue;
    }

    if (/^#{1,6}\s+/u.test(block)) {
      const headingLines = estimateTextVisualLines(block, charsPerLine);
      if (currentPageLines > 0 && currentPageLines + headingLines + 2 > maxLines) {
        pushCurrentPage();
      }
    }

    const blockLines = estimateTextVisualLines(block, charsPerLine) + 0.35;

    if (currentPageLines + blockLines <= maxLines) {
      currentPageText = currentPageText ? `${currentPageText}\n\n${block}` : block;
      currentPageLines += blockLines;
      continue;
    }

    const units = splitBlockIntoUnits(block);

    if (units.length <= 1) {
      if (blockLines > maxLines || !isSafeToSplitUnit(block)) {
        if (currentPageLines > 0) pushCurrentPage();
        if (blockLines <= maxLines) {
          currentPageText = block;
          currentPageLines = blockLines;
        } else {
          pages.push({ content: block, oversized: true });
        }
        continue;
      }

      if (currentPageLines > 0 && currentPageLines + blockLines > maxLines) {
        const split = takeFittingText(block, charsPerLine, maxLines - currentPageLines);
        if (split) {
          currentPageText = `${currentPageText}\n\n${split.head}`;
          currentPageLines += estimateTextVisualLines(split.head, charsPerLine) + 0.35;
          pushCurrentPage();
          currentPageText = split.tail;
          currentPageLines = estimateTextVisualLines(split.tail, charsPerLine) + 0.35;
          continue;
        }
        pushCurrentPage();
      }
      currentPageText = currentPageText ? `${currentPageText}\n\n${block}` : block;
      currentPageLines = currentPageText === block ? blockLines : currentPageLines + blockLines;
      continue;
    }

    let needsBlockSeparator = Boolean(currentPageText);
    for (const unit of units) {
      let remainingText = unit.text;
      let continuation = false;
      while (remainingText) {
        const unitLines = estimateTextVisualLines(remainingText, charsPerLine);

        if (currentPageLines > 0 && currentPageLines + unitLines > maxLines) {
          const split = unitLines <= maxLines && isSafeToSplitUnit(remainingText)
            ? takeFittingText(remainingText, charsPerLine, maxLines - currentPageLines)
            : null;
          if (split) {
            const separator = !currentPageText ? '' : needsBlockSeparator && !continuation ? '\n\n' : unit.isLine ? '\n' : '';
            currentPageText = `${currentPageText}${separator}${split.head}`;
            currentPageLines += estimateTextVisualLines(split.head, charsPerLine);
            remainingText = split.tail;
            pushCurrentPage();
            needsBlockSeparator = false;
            continuation = true;
            continue;
          }
          pushCurrentPage();
          needsBlockSeparator = false;
          continuation = true;
        }

        if (unitLines > maxLines) {
          pushCurrentPage();
          pages.push({ content: remainingText, oversized: true });
          remainingText = '';
          needsBlockSeparator = false;
          continuation = true;
          continue;
        }

        const separator = !currentPageText ? '' : needsBlockSeparator && !continuation ? '\n\n' : unit.isLine ? '\n' : '';
        currentPageText = `${currentPageText}${separator}${remainingText}`;
        currentPageLines += unitLines;
        remainingText = '';
        needsBlockSeparator = false;
      }
    }
    currentPageLines += 0.35;
  }

  pushCurrentPage();
  return pages.length ? pages : [{ content: '暂无内容', oversized: false }];
}

export function focusedReadingPageCapacity(
  width: number,
  height: number,
  preferences: FocusedReadingPreferences,
): FocusedReadingPageCapacity {
  const fontSize = preferences.fontSize || 18;
  const lineHeight = Math.round(fontSize * 1.62);
  if (width <= 0 || height <= 0) {
    return {
      capacity: 600,
      charsPerLine: 20,
      maxLines: 18,
      lineHeight,
      fontSize,
    };
  }

  const usableWidth = Math.max(fontSize * 6, width - preferences.pageMargin * 2);
  const charsPerLine = Math.max(6, Math.floor(usableWidth / (fontSize * FOCUSED_READING_GLYPH_WIDTH_RATIO)));

  const usableHeight = Math.max(lineHeight * 3, height - FOCUSED_READING_PAGE_RESERVE);
  const maxLines = Math.max(3, Math.floor(usableHeight / lineHeight));
  const capacity = Math.max(60, charsPerLine * maxLines);

  return {
    capacity,
    charsPerLine,
    maxLines,
    lineHeight,
    fontSize,
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}
