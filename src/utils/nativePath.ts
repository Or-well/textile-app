export function formatNativePathForDisplay(path: string): string {
  if (!path.startsWith("\\\\?\\")) {
    return path;
  }

  const pathWithoutPrefix = path.slice("\\\\?\\".length);

  if (pathWithoutPrefix.toUpperCase().startsWith("UNC\\")) {
    return `\\\\${pathWithoutPrefix.slice("UNC\\".length)}`;
  }

  return pathWithoutPrefix;
}
