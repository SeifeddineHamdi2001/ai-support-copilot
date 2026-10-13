import { DraftResponseSchema, type DraftResponse } from '@copilot/shared';
import { ScriptedLlmProvider } from '../../../test/scripted-llm.provider';
import { structuredCall } from '../ai/structured-call';
import {
  draftProblems,
  fallbackDraftResponse,
  groundDraft,
  HOLDING_REPLY,
  quoteInSource,
  stripCitationMarkers,
  type RetrievedSource,
} from './citations';

const REFUND_CHUNK = '11111111-1111-4111-8111-111111111111';
const SLA_CHUNK = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_CHUNK = '99999999-9999-4999-8999-999999999999';

const sources: RetrievedSource[] = [
  {
    label: 'S1',
    rank: 1,
    chunkId: REFUND_CHUNK,
    documentId: 'doc-refund',
    content:
      'A duplicate charge is always refunded in full. Duplicate charges are refunded to the original\npayment method within **5–7 business days**.',
    similarity: 0.62,
  },
  {
    label: 'S2',
    rank: 2,
    chunkId: SLA_CHUNK,
    documentId: 'doc-sla',
    content: 'VIP customers get a first response within 4 hours.',
    similarity: 0.31,
  },
];

const answer = (overrides: Partial<DraftResponse> = {}): DraftResponse => ({
  answerable: true,
  answer: 'Hi,\n\nDuplicate charges are refunded within 5–7 business days [S1].\n\nBest regards',
  citations: [
    {
      chunkId: REFUND_CHUNK,
      quote: 'refunded to the original payment method within 5–7 business days',
    },
  ],
  confidence: 0.8,
  missingInformation: [],
  ...overrides,
});

describe('stripCitationMarkers', () => {
  it('removes markers and the space they leave before punctuation', () => {
    expect(
      stripCitationMarkers('Refunds take 5 days [S1]. Annual plans are prorated [S2][S3].'),
    ).toBe('Refunds take 5 days. Annual plans are prorated.');
  });

  it('keeps line breaks and text without markers', () => {
    expect(stripCitationMarkers('Hi Ana,\n\nYes [S1] we can.\nThanks')).toBe(
      'Hi Ana,\n\nYes we can.\nThanks',
    );
  });
});

describe('quoteInSource', () => {
  it('ignores case, line breaks and Markdown emphasis', () => {
    expect(
      quoteInSource(
        'Refunded to the original payment method within 5–7 business days',
        sources[0].content,
      ),
    ).toBe(true);
    expect(quoteInSource('refunded within 3 days', sources[0].content)).toBe(false);
    expect(quoteInSource('   ', sources[0].content)).toBe(false);
  });
});

describe('draftProblems', () => {
  it('accepts a cited, grounded answer', () => {
    expect(draftProblems(answer(), sources)).toEqual([]);
  });

  it('rejects a citation of a chunk that was not retrieved', () => {
    const problems = draftProblems(
      answer({ citations: [{ chunkId: UNKNOWN_CHUNK, quote: 'made up' }] }),
      sources,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${UNKNOWN_CHUNK} is not the chunk_id of any provided source`),
        expect.stringContaining('[S1] is used but citations has no entry'),
      ]),
    );
  });

  it('rejects a quote that is not in the cited source', () => {
    const problems = draftProblems(
      answer({ citations: [{ chunkId: REFUND_CHUNK, quote: 'refunds take 30 days' }] }),
      sources,
    );
    expect(problems).toEqual(['citations.0.quote: must be copied word for word from S1']);
  });

  it('requires citations and [S#] markers when answerable', () => {
    expect(draftProblems(answer({ citations: [], answer: 'No markers here.' }), sources)).toEqual([
      'citations: an answerable draft must cite at least one source',
      'answer: add [S#] markers after the sentences that use a source',
    ]);
  });

  it('rejects markers for sources that do not exist and duplicate citations', () => {
    const problems = draftProblems(
      answer({
        answer: 'Refunds [S1]. Something [S7].',
        citations: [
          { chunkId: REFUND_CHUNK, quote: 'always refunded in full' },
          { chunkId: REFUND_CHUNK, quote: 'always refunded in full' },
        ],
      }),
      sources,
    );
    expect(problems).toEqual([
      'citations.1.chunkId: duplicate citation of S1',
      'answer: [S7] does not match any provided source',
    ]);
  });

  it('accepts a non-answerable draft without citations', () => {
    expect(
      draftProblems(answer({ answerable: false, citations: [], answer: 'Not covered.' }), sources),
    ).toEqual([]);
  });
});

describe('groundDraft', () => {
  it('keeps allow-listed citations with their rank, similarity and document', () => {
    const grounded = groundDraft(answer(), sources);
    expect(grounded).toMatchObject({
      answerable: true,
      holdingReason: null,
      citations: [
        {
          chunkId: REFUND_CHUNK,
          documentId: 'doc-refund',
          rank: 1,
          score: 0.62,
          quote: 'refunded to the original payment method within 5–7 business days',
        },
      ],
    });
    expect(grounded.content).toContain('[S1]');
  });

  it('drops unknown citations and markers of sources that are no longer cited', () => {
    const grounded = groundDraft(
      answer({
        answer: 'Refunds take 5–7 business days [S1]. VIPs get answers fast [S2].',
        citations: [
          { chunkId: REFUND_CHUNK, quote: 'always refunded in full' },
          { chunkId: UNKNOWN_CHUNK, quote: 'invented' },
        ],
      }),
      sources,
    );
    expect(grounded.citations.map((c) => c.chunkId)).toEqual([REFUND_CHUNK]);
    expect(grounded.content).toBe('Refunds take 5–7 business days [S1]. VIPs get answers fast.');
  });

  it('blanks a quote that cannot be found but keeps the citation', () => {
    const grounded = groundDraft(
      answer({ citations: [{ chunkId: REFUND_CHUNK, quote: 'not in the text' }] }),
      sources,
    );
    expect(grounded.citations).toEqual([expect.objectContaining({ quote: null })]);
  });

  it('downgrades an answerable draft with no valid citation to the holding reply', () => {
    const grounded = groundDraft(
      answer({ citations: [{ chunkId: UNKNOWN_CHUNK, quote: 'invented policy' }] }),
      sources,
    );
    expect(grounded).toEqual({
      answerable: false,
      content: HOLDING_REPLY,
      confidence: 0,
      missingInformation: [],
      citations: [],
      holdingReason: 'NO_VALID_CITATIONS',
    });
  });

  it('always uses the holding reply when the model says the sources do not answer', () => {
    const grounded = groundDraft(
      answer({
        answerable: false,
        answer: 'Sure, we will refund you 100% today!',
        missingInformation: ['Refund amount'],
      }),
      sources,
    );
    expect(grounded).toMatchObject({
      answerable: false,
      content: HOLDING_REPLY,
      citations: [],
      missingInformation: ['Refund amount'],
      holdingReason: 'MODEL_NOT_ANSWERABLE',
    });
  });
});

describe('draft pipeline (structuredCall + citation checks)', () => {
  const run = (llm: ScriptedLlmProvider) =>
    structuredCall({
      llm,
      schema: DraftResponseSchema,
      schemaName: 'DraftResponse',
      system: 'system',
      prompt: 'prompt',
      semanticCheck: (d) => draftProblems(d, sources),
      fallback: fallbackDraftResponse,
      sleep: () => Promise.resolve(),
    });

  it('repairs a draft that cites an unknown chunk', async () => {
    const invented = answer({ citations: [{ chunkId: UNKNOWN_CHUNK, quote: 'invented' }] });
    const llm = new ScriptedLlmProvider({ raw: invented }, { raw: answer() });

    const result = await run(llm);

    expect(result.outcome).toBe('REPAIRED');
    expect(llm.requests[1].prompt).toContain(`${UNKNOWN_CHUNK} is not the chunk_id`);
    expect(groundDraft(result.value, sources).citations).toHaveLength(1);
  });

  it('falls back to the holding reply when the repair still cites unknown chunks', async () => {
    const invented = answer({ citations: [{ chunkId: UNKNOWN_CHUNK, quote: 'invented' }] });
    const llm = new ScriptedLlmProvider({ raw: invented }, { raw: invented });

    const result = await run(llm);

    expect(result.outcome).toBe('FALLBACK');
    expect(DraftResponseSchema.safeParse(result.value).success).toBe(true);
    expect(groundDraft(result.value, sources)).toMatchObject({
      answerable: false,
      content: HOLDING_REPLY,
      citations: [],
    });
  });
});
