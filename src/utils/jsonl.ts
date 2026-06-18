export function parseJsonl<T>(text: string): T[] {
  const rows: T[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
      continue;
    }

    try {
      rows.push(JSON.parse(line) as T);
    } catch (error) {
      const lineNumber = index + 1;
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`Invalid JSONL at line ${lineNumber}: ${message}`);
    }
  }

  return rows;
}

export function stringifyJsonl<T>(rows: T[]): string {
  if (rows.length === 0) {
    return "\n";
  }

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}
