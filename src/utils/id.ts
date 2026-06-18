export function createId(prefix: string): string {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);

  return `${safePrefix || "id"}_${timePart}_${randomPart}`;
}
