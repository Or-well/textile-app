import type {
  ExportAdapterContext,
  ExportedReleaseAsset,
} from "../exporter";

function buildEntryBlock(
  context: ExportAdapterContext,
  entryIndex: number,
): string {
  const entry = context.entries[entryIndex];
  const lines: string[] = [];

  if (context.options.include_key) {
    lines.push(`[${entry.key || entry.id}]`);
  }

  if (entry.speaker) {
    lines.push(`说话人：${entry.speaker}`);
  }

  if (context.options.include_source) {
    lines.push(`原文：${entry.source}`);
  }

  lines.push(`译文：${entry.target}`);

  return lines.join("\n");
}

export function exportTxtFile(
  context: ExportAdapterContext,
): ExportedReleaseAsset {
  const content = context.entries
    .map((_, index) => buildEntryBlock(context, index))
    .join("\n\n");

  return {
    fileName: `${context.baseName}.txt`,
    content: content ? `${content}\n` : "",
  };
}
