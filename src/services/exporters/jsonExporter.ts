import type {
  ExportAdapterContext,
  ExportedReleaseAsset,
} from "../exporter";

export function exportJsonFile(
  context: ExportAdapterContext,
): ExportedReleaseAsset {
  const rows = context.entries.map((entry) => ({
    id: entry.id,
    index: entry.index,
    ...(context.options.include_key ? { key: entry.key } : {}),
    speaker: entry.speaker,
    ...(context.options.include_source ? { source: entry.source } : {}),
    target: entry.target,
    status: entry.status,
  }));

  return {
    fileName: `${context.baseName}.json`,
    content: `${JSON.stringify(
      {
        file_id: context.projectFile.id,
        file_name: context.projectFile.name,
        entries: rows,
      },
      null,
      2,
    )}\n`,
  };
}
