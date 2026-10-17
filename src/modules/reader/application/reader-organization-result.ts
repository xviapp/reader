export function parseOrganizedText(value: string): string {
  const strippedThink = value.replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
  if (!strippedThink) throw new Error('AI 没有返回可用的整理文本');

  let clean = strippedThink;
  const fenceMatch = clean.match(/^```(?:json|text|markdown)?\s*\n?([\s\S]*?)\n?```$/iu);
  if (fenceMatch && fenceMatch[1]) {
    clean = fenceMatch[1].trim();
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(clean);
  } catch {
    const jsonMatch = clean.match(/\{[\s\S]*\}/u);
    if (jsonMatch) {
      try {
        candidate = JSON.parse(jsonMatch[0]);
      } catch {
        const propMatch = jsonMatch[0].match(
          /"(?:text|content|organized_text|organizedText|cleaned_text|result)"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"[a-zA-Z0-9_-]+"\s*:|\}\s*$)/u,
        ) ?? jsonMatch[0].match(
          /"(?:text|content|organized_text|organizedText|cleaned_text|result)"\s*:\s*"([\s\S]*)"\s*\}?\s*$/u,
        );
        if (propMatch && propMatch[1]) {
          const unescaped = unescapeJsonString(propMatch[1]).trim();
          if (unescaped) return unescaped;
        }
      }
    }
  }

  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const record = candidate as Record<string, unknown>;
    const textProp = record.text ?? record.content ?? record.organized_text
      ?? record.organizedText ?? record.cleaned_text ?? record.result;
    if (typeof textProp === 'string' && textProp.trim()) {
      return textProp.trim();
    }
    const stringValues = Object.values(record).filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
    if (stringValues.length === 1 && stringValues[0]) {
      return stringValues[0].trim();
    }
  } else if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  const plain = clean
    .replace(/^```(?:json|text|markdown)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  if (plain && !plain.startsWith('{') && !plain.startsWith('[')) {
    const preamblePattern = /^(?:(?:好的|没问题)[，,！! \t]*\n+|[ \t]*(?:好的[，,！! ]*)?(?:以下是|为您|已为您|这是|整理结果)[^\n]*(?:[：:]|如下)[：:]?[ \t]*\n+)/u;
    let withoutPrefix = plain;
    while (preamblePattern.test(withoutPrefix)) {
      withoutPrefix = withoutPrefix.replace(preamblePattern, '').trimStart();
    }
    if (withoutPrefix.trim()) {
      return withoutPrefix.trim();
    }
    return plain;
  }

  throw new Error('AI 没有返回可用的整理文本');
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, '\\')
    .replace(/\\\//gu, '/')
    .replace(/\\b/gu, '\b')
    .replace(/\\f/gu, '\f')
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t')
    .replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
