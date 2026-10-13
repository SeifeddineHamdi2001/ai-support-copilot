/**
 * Prepares customer- or document-written text for a prompt. The result goes inside delimiter tags, so it
 * must not be able to close them: HTML tags and control characters are stripped, the length is capped,
 * and any remaining `&`, `<`, `>` are escaped.
 */
export function untrusted(text: string, maxLength: number): string {
  const cleaned = text
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
    // Control characters except tab and newline.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  const capped =
    cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)} [truncated]` : cleaned;
  return capped.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Reverses the escaping of `untrusted()` (used by the mock provider to read the ticket back). */
export function unescapeUntrusted(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Contents of the first `<tag>…</tag>` in a prompt, unescaped. */
export function extractTag(prompt: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(prompt);
  return match ? unescapeUntrusted(match[1].trim()) : undefined;
}

/** Like `untrusted()`, for a value placed inside a double-quoted tag attribute. */
export function untrustedAttr(text: string, maxLength: number): string {
  return untrusted(text.replace(/\s+/g, ' '), maxLength).replace(/"/g, '&quot;');
}
