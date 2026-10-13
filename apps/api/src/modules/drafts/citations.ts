import type { DraftResponse } from '@copilot/shared';

/** A retrieved chunk offered to the model as `[S{rank}]`. */
export interface RetrievedSource {
  label: string;
  /** 1-based position in the retrieval result; equals the number in the label. */
  rank: number;
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
}

export interface GroundedCitation {
  chunkId: string;
  documentId: string;
  rank: number;
  score: number;
  /** null when the model's quote could not be found in the chunk. */
  quote: string | null;
}

export interface GroundedDraft {
  answerable: boolean;
  content: string;
  confidence: number;
  missingInformation: string[];
  citations: GroundedCitation[];
  /** Why the draft is the holding reply, if it is. */
  holdingReason: HoldingReason | null;
}

export type HoldingReason =
  | 'NO_SOURCES_ABOVE_FLOOR'
  | 'MODEL_NOT_ANSWERABLE'
  | 'NO_VALID_CITATIONS'
  | 'MODEL_OUTPUT_UNUSABLE'
  | 'PROVIDER_UNAVAILABLE';

/**
 * Sent when the knowledge base cannot ground an answer. It makes no factual claim, so it is safe to send
 * as is; the agent writes the real answer.
 */
export const HOLDING_REPLY = [
  'Hi,',
  '',
  'Thank you for contacting Acme Cloud support. I want to make sure you get an accurate answer, so I am ' +
    'checking your request with the team and will follow up shortly.',
  '',
  'If you can, please reply with any details that could help, such as the account email, the exact ' +
    'error message, or screenshots.',
  '',
  'Best regards,',
  'Acme Cloud Support',
].join('\n');

const MARKER = /\[S(\d+)\]/g;

/** Case, whitespace and Markdown emphasis are ignored when checking that a quote is verbatim. */
export function normalizeForQuote(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteInSource(quote: string, content: string): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(content).includes(q);
}

/**
 * Grounding rules the schema cannot express. Any problem triggers the pipeline's repair call, with these
 * messages, and then the fallback.
 */
export function draftProblems(draft: DraftResponse, sources: RetrievedSource[]): string[] {
  const problems: string[] = [];
  const byChunk = new Map(sources.map((s) => [s.chunkId, s]));
  const cited = new Set<string>();

  draft.citations.forEach((c, i) => {
    const source = byChunk.get(c.chunkId);
    if (!source) {
      problems.push(
        `citations.${i}.chunkId: ${c.chunkId} is not the chunk_id of any provided source`,
      );
      return;
    }
    if (cited.has(c.chunkId))
      problems.push(`citations.${i}.chunkId: duplicate citation of ${source.label}`);
    cited.add(c.chunkId);
    if (!quoteInSource(c.quote, source.content)) {
      problems.push(`citations.${i}.quote: must be copied word for word from ${source.label}`);
    }
  });

  if (draft.answerable) {
    if (draft.citations.length === 0) {
      problems.push('citations: an answerable draft must cite at least one source');
    }
    const markers = [...draft.answer.matchAll(MARKER)].map((m) => Number(m[1]));
    if (markers.length === 0) {
      problems.push('answer: add [S#] markers after the sentences that use a source');
    }
    for (const n of new Set(markers)) {
      const source = sources.find((s) => s.rank === n);
      if (!source) problems.push(`answer: [S${n}] does not match any provided source`);
      else if (!cited.has(source.chunkId)) {
        problems.push(`answer: [S${n}] is used but citations has no entry for its chunk_id`);
      }
    }
  }
  return problems;
}

/**
 * Final gate after validation (defence in depth, also applied to repaired output): only citations of
 * retrieved chunks survive, unverifiable quotes are blanked, markers of uncited sources are removed, and
 * an "answerable" draft with no surviving citation becomes the holding reply. A non-answerable draft is
 * always the holding reply, so the model's own wording never makes unsupported claims.
 */
export function groundDraft(draft: DraftResponse, sources: RetrievedSource[]): GroundedDraft {
  if (!draft.answerable) return holdingDraft('MODEL_NOT_ANSWERABLE', draft.missingInformation);

  const byChunk = new Map(sources.map((s) => [s.chunkId, s]));
  const seen = new Set<string>();
  const citations: GroundedCitation[] = [];
  for (const c of draft.citations) {
    const source = byChunk.get(c.chunkId);
    if (!source || seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    citations.push({
      chunkId: source.chunkId,
      documentId: source.documentId,
      rank: source.rank,
      score: source.similarity,
      quote: quoteInSource(c.quote, source.content) ? c.quote.trim() : null,
    });
  }
  if (citations.length === 0) return holdingDraft('NO_VALID_CITATIONS', draft.missingInformation);

  const citedRanks = new Set(citations.map((c) => c.rank));
  const content = draft.answer
    .replace(MARKER, (marker, n: string) => (citedRanks.has(Number(n)) ? marker : ''))
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();

  return {
    answerable: true,
    content,
    confidence: draft.confidence,
    missingInformation: draft.missingInformation,
    citations: citations.sort((a, b) => a.rank - b.rank),
    holdingReason: null,
  };
}

export function holdingDraft(
  reason: HoldingReason,
  missingInformation: string[] = [],
): GroundedDraft {
  return {
    answerable: false,
    content: HOLDING_REPLY,
    confidence: 0,
    missingInformation,
    citations: [],
    holdingReason: reason,
  };
}

/** Schema-valid stand-in for structuredCall when the model output stays unusable. */
export function fallbackDraftResponse(): DraftResponse {
  return {
    answerable: false,
    answer: HOLDING_REPLY,
    citations: [],
    confidence: 0,
    missingInformation: [],
  };
}
