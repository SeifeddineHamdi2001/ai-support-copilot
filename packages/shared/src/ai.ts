import { z } from 'zod';
import {
  EscalationSignalSchema,
  SentimentSchema,
  TicketIntentSchema,
  TicketPrioritySchema,
} from './enums';

/** Output contract for ticket classification (classify@v1). Provider-friendly: no root unions or transforms. */
export const TicketClassificationSchema = z.object({
  intent: TicketIntentSchema,
  priority: TicketPrioritySchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(400),
  sentiment: SentimentSchema,
  escalationSignals: z.array(EscalationSignalSchema).max(5),
  language: z.string().length(2),
});
export type TicketClassification = z.infer<typeof TicketClassificationSchema>;

/** Output contract for grounded draft responses (draft@v1). Citations are allow-listed server side. */
export const DraftResponseSchema = z.object({
  answerable: z.boolean(),
  answer: z.string().max(2000),
  citations: z.array(z.object({ chunkId: z.string().uuid(), quote: z.string().max(300) })).max(5),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string().max(200)).max(5),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;
