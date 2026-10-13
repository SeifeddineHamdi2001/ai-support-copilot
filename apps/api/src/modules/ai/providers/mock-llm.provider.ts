import { classifyByKeywords } from '../classification/keyword-classifier';
import { CLASSIFY_SCHEMA_NAME } from '../prompts/classify.prompt';
import { DRAFT_SCHEMA_NAME } from '../prompts/draft.prompt';
import { extractTag } from '../prompts/untrusted';
import type { LlmProvider, StructuredRequest, StructuredResponse } from './llm-provider';
import { mockDraft } from './mock-draft';

/**
 * Default provider (`LLM_PROVIDER=mock`): deterministic rules instead of a model, so the app, seed, tests
 * and CI run with no API key. It reads the ticket back out of the same delimited prompt a real model
 * receives, and its output still goes through the full validation pipeline.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-keyword-rules-v1';

  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse> {
    switch (req.schemaName) {
      case CLASSIFY_SCHEMA_NAME: {
        const subject = extractTag(req.prompt, 'ticket_subject') ?? '';
        const body = extractTag(req.prompt, 'ticket_body') ?? '';
        return Promise.resolve({ raw: classifyByKeywords(subject, body) });
      }
      case DRAFT_SCHEMA_NAME:
        return Promise.resolve({ raw: mockDraft(req.prompt) });
      default:
        return Promise.reject(
          new Error(`MockLlmProvider has no rules for schema ${req.schemaName}`),
        );
    }
  }
}
