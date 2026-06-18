import type {
  ExportAdapterContext,
  ExportedReleaseAsset,
} from "../exporter";

function escapeCsvValue(value: string | number): string {
  const text = String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function exportCsvFile(
  context: ExportAdapterContext,
): ExportedReleaseAsset {
  const headers = [
    "id",
    "index",
    ...(context.options.include_key ? ["key"] : []),
    "speaker",
    ...(context.options.include_source ? ["source"] : []),
    "target",
    "status",
  ];
  const rows = context.entries.map((entry) => [
    entry.id,
    entry.index,
    ...(context.options.include_key ? [entry.key] : []),
    entry.speaker,
    ...(context.options.include_source ? [entry.source] : []),
    entry.target,
    entry.status,
  ]);
  const content = [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  return {
    fileName: `${context.baseName}.csv`,
    content: `${content}\n`,
  };
}
