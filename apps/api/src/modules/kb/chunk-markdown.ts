export interface ChunkOptions {
  /** Target upper bound per chunk, in estimated tokens. */
  maxTokens?: number;
  /** Share of a chunk repeated at the start of the next chunk of the same section. */
  overlapRatio?: number;
  /** Heading path for text that appears before the first heading. */
  title?: string;
}

export interface MarkdownChunk {
  ordinal: number;
  /** e.g. "Refund Policy > Annual plans". Prepended to the content when embedding. */
  headingPath: string;
  content: string;
  tokenCount: number;
}

export const DEFAULT_MAX_TOKENS = 500;
export const DEFAULT_OVERLAP_RATIO = 0.15;
const HEADING_SEPARATOR = ' > ';

/** Rough token estimate (≈ 4 characters per token for English); good enough for sizing chunks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The text that is embedded and full-text indexed for a chunk. */
export function chunkEmbeddingText(chunk: Pick<MarkdownChunk, 'headingPath' | 'content'>): string {
  return chunk.headingPath ? `${chunk.headingPath}\n\n${chunk.content}` : chunk.content;
}

interface Section {
  headingPath: string;
  blocks: string[];
}

/**
 * Splits Markdown into retrieval chunks:
 * - sections start at `#`, `##` and `###` headings; each chunk records its heading path;
 * - blocks (paragraphs, whole lists, tables, fenced code) are packed up to `maxTokens`; a block is only
 *   split when it is too large on its own (lists at item boundaries, prose at sentence boundaries);
 * - consecutive chunks of the same section overlap by about `overlapRatio` of a chunk, so a fact on a
 *   boundary is still retrievable with its context;
 * - empty sections produce no chunk.
 */
export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): MarkdownChunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = Math.floor(maxTokens * (options.overlapRatio ?? DEFAULT_OVERLAP_RATIO));
  const chunks: MarkdownChunk[] = [];

  for (const section of splitSections(markdown, options.title ?? '')) {
    const blocks = section.blocks.flatMap((b) => splitOversizedBlock(b, maxTokens));
    let current: string[] = [];

    const emit = () => {
      const content = current.join('\n\n').trim();
      if (content) {
        chunks.push({
          ordinal: chunks.length,
          headingPath: section.headingPath,
          content,
          tokenCount: estimateTokens(content),
        });
      }
    };

    for (const block of blocks) {
      const candidate = [...current, block].join('\n\n');
      if (current.length > 0 && estimateTokens(candidate) > maxTokens) {
        emit();
        current = overlapTail(current, overlapTokens);
        // Drop the overlap if it would push the new block over the limit.
        if (estimateTokens([...current, block].join('\n\n')) > maxTokens) current = [];
      }
      current = [...current, block];
    }
    emit();
  }
  return chunks;
}

/** Groups blocks under their heading path. Headings deeper than ### are kept as text. */
function splitSections(markdown: string, title: string): Section[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const path: string[] = [];
  let current: Section = { headingPath: title, blocks: [] };
  let buffer: string[] = [];
  let inFence = false;

  const flushBlock = () => {
    const block = buffer.join('\n').trim();
    if (block) current.blocks.push(block);
    buffer = [];
  };
  const startSection = (level: number, text: string) => {
    flushBlock();
    if (current.blocks.length) sections.push(current);
    path.length = level - 1;
    path[level - 1] = text;
    current = { headingPath: path.filter(Boolean).join(HEADING_SEPARATOR), blocks: [] };
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      startSection(heading[1].length, heading[2].trim());
    } else if (line.trim() === '') {
      flushBlock();
    } else {
      buffer.push(line);
    }
  }
  flushBlock();
  if (current.blocks.length) sections.push(current);
  return sections;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

/** Splits a block that alone exceeds the limit: lists per item, code per line, prose per sentence. */
function splitOversizedBlock(block: string, maxTokens: number): string[] {
  if (estimateTokens(block) <= maxTokens) return [block];

  const lines = block.split('\n');
  let units: string[];
  let joiner: string;
  if (/^\s*(```|~~~)/.test(block)) {
    units = lines;
    joiner = '\n';
  } else if (LIST_ITEM.test(lines[0])) {
    // Each item keeps its continuation lines.
    units = [];
    for (const line of lines) {
      if (LIST_ITEM.test(line) || units.length === 0) units.push(line);
      else units[units.length - 1] += `\n${line}`;
    }
    joiner = '\n';
  } else {
    units = block.split(/(?<=[.!?])\s+/);
    joiner = ' ';
  }

  const parts: string[] = [];
  let current = '';
  for (const unit of units.flatMap((u) => hardSplit(u, maxTokens))) {
    const candidate = current ? `${current}${joiner}${unit}` : unit;
    if (current && estimateTokens(candidate) > maxTokens) {
      parts.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Last resort for a single sentence or line longer than the limit: cut at word boundaries. */
function hardSplit(unit: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  if (unit.length <= maxChars) return [unit];
  const parts: string[] = [];
  let rest = unit;
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(' ', maxChars);
    const at = cut > maxChars / 2 ? cut : maxChars;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Blocks to repeat at the start of the next chunk: whole trailing blocks within the budget, or else the
 * last sentences of the final block.
 */
function overlapTail(blocks: string[], budgetTokens: number): string[] {
  if (budgetTokens <= 0) return [];
  const tail: string[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (estimateTokens([blocks[i], ...tail].join('\n\n')) > budgetTokens) break;
    tail.unshift(blocks[i]);
  }
  if (tail.length) return tail;

  const sentences = blocks[blocks.length - 1].split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (estimateTokens([sentences[i], ...kept].join(' ')) > budgetTokens) break;
    kept.unshift(sentences[i]);
  }
  return kept.length ? [kept.join(' ')] : [];
}
