/**
 * Input hygiene for free text that reaches the database, the UI and LLM prompts.
 * - Line endings become `\n`.
 * - Control characters are removed, except tab and newline.
 * - Invisible format characters that can hide text from a human reviewer are removed: bidi overrides and
 *   isolates ("Trojan Source"), zero-width space and the byte-order mark. Zero-width joiners stay, since
 *   emoji sequences need them.
 * - HTML comments and tags are removed (line-breaking ones become newlines) unless `html` is allowed (Markdown KB articles may contain HTML).
 *   Text such as `a < b` is kept: only `<` followed by a letter or `/` and closed by `>` is a tag.
 * The result is trimmed. The UI renders everything as plain text anyway; this keeps stored data clean.
 */
export function cleanText(value: string, options: { html?: boolean } = {}): string {
  let text = value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  if (!options.html) {
    text = text
      .replace(/<!--[\s\S]*?(-->|$)/g, '')
      // Line-breaking tags keep words apart: `a<br>b` is two lines, not `ab`.
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^<>]*>/gi, '\n')
      .replace(/<\/?[a-zA-Z][^<>]*>/g, '');
  }
  return text.trim();
}
