/** Same grammar as the API's draft markers: [S1], [S2], ... */
const MARKER = /\[S(\d+)\]/g;

/**
 * `cited` is the word a run of markers follows, plus their labels, so the UI can keep the word and
 * its chips on one line (a chip never wraps alone to the next line).
 */
export type DraftSegment =
  { kind: 'text'; text: string } | { kind: 'cited'; word: string; labels: string[] };

/**
 * Splits draft text into plain-text runs and cited words, so markers can render as chips and the
 * rest as text nodes (never HTML). Markers whose label is not in `known` stay as literal text.
 */
export function splitDraft(content: string, known: ReadonlySet<string>): DraftSegment[] {
  const out: DraftSegment[] = [];
  let last = 0;
  for (const m of content.matchAll(MARKER)) {
    const label = `S${m[1]}`;
    if (!known.has(label)) continue;
    const between = content.slice(last, m.index);
    const prev = out[out.length - 1];
    if (!between.trim() && prev?.kind === 'cited') {
      // [S1][S2] or [S1] [S2]: same word.
      prev.labels.push(label);
    } else {
      const [, head, word] = /^([\s\S]*?)(\S*)\s*$/.exec(between)!;
      if (head) out.push({ kind: 'text', text: head });
      out.push({ kind: 'cited', word, labels: [label] });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ kind: 'text', text: content.slice(last) });
  return out;
}
