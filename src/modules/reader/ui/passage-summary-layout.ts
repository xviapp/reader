export interface PassageSummarySplit {
  lead: string;
  remainder: string;
}

export function splitPassageSummaryAtLines(value: string, measuredLines: readonly string[], maximumLeadLines: number): PassageSummarySplit {
  const summary = value.trim();
  if (!summary || measuredLines.length <= maximumLeadLines) return { lead: summary, remainder: '' };
  const selected = measuredLines.slice(0, Math.max(1, maximumLeadLines));
  let cursor = 0;
  for (const rawLine of selected) {
    const line = rawLine.replace(/\n+$/gu, '');
    if (!line) continue;
    const index = summary.indexOf(line, cursor);
    if (index < 0) return fallbackSplit(summary, selected);
    cursor = index + line.length;
  }
  if (cursor <= 0 || cursor >= summary.length) return { lead: summary, remainder: '' };
  return {
    lead: summary.slice(0, cursor).trimEnd(),
    remainder: summary.slice(cursor).trimStart(),
  };
}

function fallbackSplit(summary: string, lines: readonly string[]): PassageSummarySplit {
  const approximateOffset = Math.min(summary.length, lines.reduce((total, line) => total + line.length, 0));
  if (approximateOffset <= 0 || approximateOffset >= summary.length) return { lead: summary, remainder: '' };
  return {
    lead: summary.slice(0, approximateOffset).trimEnd(),
    remainder: summary.slice(approximateOffset).trimStart(),
  };
}
