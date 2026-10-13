import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkEmbeddingText, chunkMarkdown, estimateTokens } from './chunk-markdown';
import { parseFrontMatter } from './front-matter';

const paragraph = (n: number, words = 40) =>
  `Paragraph ${n} ` + Array.from({ length: words }, (_, i) => `word${n}x${i}`).join(' ') + '.';

describe('chunkMarkdown', () => {
  it('records the heading path of each section', () => {
    const md = [
      '# Refund Policy',
      'Intro text about refunds.',
      '## Annual plans',
      'Annual plans are prorated after 14 days.',
      '### Downgrades',
      'Downgrades become account credit.',
      '## Duplicate charges',
      'Refunded within 5–7 business days.',
    ].join('\n\n');

    const chunks = chunkMarkdown(md);

    expect(chunks.map((c) => c.headingPath)).toEqual([
      'Refund Policy',
      'Refund Policy > Annual plans',
      'Refund Policy > Annual plans > Downgrades',
      'Refund Policy > Duplicate charges',
    ]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
    expect(chunks[3].content).toBe('Refunded within 5–7 business days.');
  });

  it('uses the title for text before the first heading and skips empty sections', () => {
    const chunks = chunkMarkdown('Preamble text here.\n\n# Empty\n\n## Filled\n\nSome content.', {
      title: 'Doc',
    });

    expect(chunks.map((c) => [c.headingPath, c.content])).toEqual([
      ['Doc', 'Preamble text here.'],
      ['Empty > Filled', 'Some content.'],
    ]);
  });

  it('keeps chunks under the size limit and overlaps consecutive chunks of a section', () => {
    const md = ['## Long section', ...Array.from({ length: 30 }, (_, i) => paragraph(i, 10))].join(
      '\n\n',
    );

    const chunks = chunkMarkdown(md, { maxTokens: 200, overlapRatio: 0.3 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(200);
      expect(c.tokenCount).toBe(estimateTokens(c.content));
      expect(c.headingPath).toBe('Long section');
    }
    for (let i = 1; i < chunks.length; i++) {
      const lastParagraphOfPrevious = chunks[i - 1].content.split('\n\n').at(-1)!;
      const firstParagraph = chunks[i].content.split('\n\n')[0];
      // The next chunk repeats the tail of the previous one (whole paragraphs).
      expect(chunks[i].content).toContain(lastParagraphOfPrevious);
      expect(chunks[i - 1].content).toContain(firstParagraph);
    }
    // Every paragraph is somewhere in the output.
    const all = chunks.map((c) => c.content).join('\n\n');
    for (let i = 0; i < 30; i++) expect(all).toContain(`Paragraph ${i} `);
  });

  it('does not overlap across sections', () => {
    const chunks = chunkMarkdown(`## A\n\n${paragraph(1)}\n\n## B\n\n${paragraph(2)}`, {
      maxTokens: 200,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).not.toContain('Paragraph 1');
  });

  it('splits an oversized list between items, never inside one', () => {
    const items = Array.from(
      { length: 20 },
      (_, i) => `- Item ${i} ${'detail '.repeat(15)}\n  continued line of item ${i}`,
    );
    const chunks = chunkMarkdown(`## List\n\n${items.join('\n')}`, {
      maxTokens: 150,
      overlapRatio: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.startsWith('- Item')).toBe(true);
      const starts = c.content.match(/- Item (\d+)/g)!.length;
      const ends = c.content.match(/continued line of item \d+/g)!.length;
      expect(ends).toBe(starts);
    }
  });

  it('keeps a fenced code block (with blank lines and #) in one piece', () => {
    const md = '## Code\n\n```bash\n# not a heading\n\ncurl https://api\n```\n\nAfter.';
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('# not a heading\n\ncurl https://api');
    expect(chunks[0].headingPath).toBe('Code');
  });

  it('produces no empty chunks for empty input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('# Only a heading')).toEqual([]);
  });

  it('prepends the heading path to the embedded text', () => {
    expect(chunkEmbeddingText({ headingPath: 'A > B', content: 'text' })).toBe('A > B\n\ntext');
  });
});

describe('seed knowledge base', () => {
  const dir = join(__dirname, '../../../seed/kb');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('has 10 documents with title, slug and category', () => {
    expect(files).toHaveLength(10);
    const slugs = files.map((f) => {
      const { attributes } = parseFrontMatter(readFileSync(join(dir, f), 'utf8'));
      expect(attributes).toEqual(
        expect.objectContaining({
          title: expect.any(String),
          slug: f.replace(/\.md$/, ''),
          category: expect.any(String),
        }),
      );
      return attributes.slug;
    });
    expect(new Set(slugs).size).toBe(10);
  });

  it.each(files)('%s chunks into sections under the size limit', (file) => {
    const { attributes, body } = parseFrontMatter(readFileSync(join(dir, file), 'utf8'));
    const chunks = chunkMarkdown(body, { title: attributes.title });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(500);
      expect(c.content.trim()).not.toBe('');
      expect(c.headingPath.startsWith(attributes.title)).toBe(true);
    }
  });
});

describe('parseFrontMatter', () => {
  it('reads flat key: value pairs and returns the body', () => {
    const { attributes, body } = parseFrontMatter(
      '﻿---\r\ntitle: "Refund Policy"\r\nslug: refund-policy\r\n---\r\n# Body\r\n',
    );
    expect(attributes).toEqual({ title: 'Refund Policy', slug: 'refund-policy' });
    expect(body).toBe('# Body\n');
  });

  it('returns the whole text when there is no front matter', () => {
    expect(parseFrontMatter('# Just markdown')).toEqual({
      attributes: {},
      body: '# Just markdown',
    });
  });
});
