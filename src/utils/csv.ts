export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let current = "";
  let inQuotes = false;
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index];
    const nextChar = normalizedText[index + 1];

    if (char === "\"" && inQuotes && nextChar === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      record.push(current.trim());
      current = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      record.push(current.trim());
      records.push(record);
      record = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    throw new Error("CSV 引号未闭合，无法读取。");
  }

  if (current || record.length > 0 || normalizedText.endsWith(",")) {
    record.push(current.trim());
    records.push(record);
  }

  return records.filter((row) =>
    row.some((cell) => cell.trim()) && !row[0]?.trim().startsWith("#"),
  );
}
