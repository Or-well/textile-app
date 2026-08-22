export function sanitizeFileNamePart(
  value: string,
  fallback: string,
  maxLength = 48,
): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, maxLength);

  return sanitized || fallback;
}
