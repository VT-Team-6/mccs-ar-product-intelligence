export function imageUrlProblem(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  if (url.length > 500) return 'Image URL must be 500 characters or fewer.';
  if (/\s/.test(url)) return 'Image URL cannot contain spaces.';
  // Keep existing backend-hosted seed images editable.
  if (url.startsWith('/static/')) return null;
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) return null;
  } catch {
    // The form shows one consistent message for malformed/unsupported URLs.
  }
  return 'Use a direct HTTP or HTTPS image URL.';
}
