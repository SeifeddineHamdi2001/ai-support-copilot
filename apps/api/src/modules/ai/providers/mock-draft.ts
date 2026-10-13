import type { DraftResponse } from '@copilot/shared';
import { extractTag, unescapeUntrusted } from '../prompts/untrusted';
import { tokenize } from './hash-embedding.provider';

interface PromptSource {
  label: string;
  chunkId: string;
  content: string;
}

interface Candidate {
  sourceIndex: number;
  position: number;
  text: string;
  score: number;
}

/** A sentence must share at least this many distinct words (after stemming) with the ticket. */
const MIN_OVERLAP = 2;
const MAX_SENTENCES = 4;
const MAX_PER_SOURCE = 2;
/** Each lower retrieval rank costs this much overlap, so close calls go to the better source. */
const RANK_PENALTY = 0.5;

/**
 * The mock provider's "model" for draft@v1: an extractive answer. It reads the ticket and the numbered
 * sources back out of the prompt, keeps the source sentences that share the most words with the ticket,
 * and cites their real chunk ids with the sentence as the quote. With no overlapping sentence it answers
 * `answerable: false`. Deterministic, so the demo and tests show grounded, cited drafts without a key.
 */
export function mockDraft(prompt: string): DraftResponse {
  const ticketTokens = new Set(
    tokenize(
      `${extractTag(prompt, 'ticket_subject') ?? ''} ${extractTag(prompt, 'ticket_body') ?? ''}`,
    ),
  );
  const sources = parseSources(prompt);

  const candidates: Candidate[] = sources.flatMap((source, sourceIndex) =>
    sentences(source.content).map((text, position) => ({
      sourceIndex,
      position,
      text,
      score: new Set(tokenize(text).filter((t) => ticketTokens.has(t))).size,
    })),
  );

  const picked: Candidate[] = [];
  const perSource = new Map<number, number>();
  for (const c of [...candidates]
    .filter((c) => c.score >= MIN_OVERLAP)
    .sort(
      (a, b) =>
        rankedScore(b) - rankedScore(a) || a.sourceIndex - b.sourceIndex || a.position - b.position,
    )) {
    if (picked.length >= MAX_SENTENCES) break;
    if ((perSource.get(c.sourceIndex) ?? 0) >= MAX_PER_SOURCE) continue;
    perSource.set(c.sourceIndex, (perSource.get(c.sourceIndex) ?? 0) + 1);
    picked.push(c);
  }

  if (picked.length === 0) {
    return {
      answerable: false,
      answer: 'The provided sources do not answer this question.',
      citations: [],
      confidence: 0.2,
      missingInformation: ['No knowledge base source covers what the customer is asking.'],
    };
  }

  // Present facts in source order, as a reader would expect.
  picked.sort((a, b) => a.sourceIndex - b.sourceIndex || a.position - b.position);
  const lines = picked.map((c) => `- ${c.text} [${sources[c.sourceIndex].label}]`);
  const citations = [...new Set(picked.map((c) => c.sourceIndex))].map((i) => ({
    chunkId: sources[i].chunkId,
    quote: picked.find((c) => c.sourceIndex === i)!.text.slice(0, 300),
  }));
  const best = Math.max(...picked.map((c) => c.score));

  return {
    answerable: true,
    answer: [
      'Hi,',
      '',
      'Thanks for contacting Acme Cloud support. Here is what applies to your request:',
      '',
      ...lines,
      '',
      'If anything is unclear, just reply to this message.',
      '',
      'Best regards,',
      'Acme Cloud Support',
    ]
      .join('\n')
      .slice(0, 2000),
    citations,
    confidence: Math.min(0.9, 0.5 + 0.08 * best),
    missingInformation: [],
  };
}

function rankedScore(c: Candidate): number {
  return c.score - RANK_PENALTY * c.sourceIndex;
}

function parseSources(prompt: string): PromptSource[] {
  const re = /<source id="(S\d+)" chunk_id="([^"]+)"[^>]*>([\s\S]*?)<\/source>/g;
  return [...prompt.matchAll(re)].map((m) => ({
    label: m[1],
    chunkId: m[2],
    content: unescapeUntrusted(m[3].trim()),
  }));
}

/** Prose sentences and list items of a chunk; headings, tables and code are skipped. */
function sentences(content: string): string[] {
  const out: string[] = [];
  for (const block of content.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^\s*(#|\||```|~~~)/.test(l));
    const items = /^\s*([-*+]|\d+[.)])\s+/.test(lines[0] ?? '')
      ? lines.join('\n').split(/\n(?=\s*(?:[-*+]|\d+[.)])\s+)/)
      : [lines.join(' ')];
    for (const item of items) {
      const text = item
        .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      out.push(
        ...text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter((s) => s.length > 20 && !s.endsWith(':')),
      );
    }
  }
  return out;
}
