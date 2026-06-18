import type {
  ExportAdapterContext,
  ExportedReleaseAsset,
} from "../exporter";

export function exportKsFile(
  context: ExportAdapterContext,
): ExportedReleaseAsset {
  const lines = context.entries.map((entry) => {
    const keyPrefix = context.options.include_key ? `; ${entry.key}\n` : "";

    return `${keyPrefix}${entry.target}`;
  });

  return {
    fileName: `${context.baseName}.ks`,
    content: lines.length > 0 ? `${lines.join("\n")}\n` : "",
  };
}
