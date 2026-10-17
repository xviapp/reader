const TABLE_NAME = '[a-z_][a-z0-9_]*';
const READ_TABLE = new RegExp(`\\b(?:FROM|JOIN)\\s+(${TABLE_NAME})`, 'giu');
const MUTATED_TABLE = new RegExp(
  `\\b(?:INSERT(?:\\s+OR\\s+[A-Z]+)?\\s+INTO|REPLACE\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${TABLE_NAME})`,
  'giu',
);

export function readTablesOf(sql: string): ReadonlySet<string> | null {
  return matchedTables(sql, READ_TABLE);
}

export function mutatedTablesOf(sql: string): ReadonlySet<string> | null {
  return matchedTables(sql, MUTATED_TABLE);
}

export function tableScopesIntersect(
  watched: ReadonlySet<string> | null,
  changed: ReadonlySet<string> | null,
): boolean {
  if (!watched || !changed) return true;
  for (const table of changed) {
    if (watched.has(table)) return true;
  }
  return false;
}

function matchedTables(sql: string, pattern: RegExp): ReadonlySet<string> | null {
  const tables = new Set<string>();
  pattern.lastIndex = 0;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
    const table = match[1]?.toLowerCase();
    if (table) tables.add(table);
  }
  return tables.size > 0 ? tables : null;
}

