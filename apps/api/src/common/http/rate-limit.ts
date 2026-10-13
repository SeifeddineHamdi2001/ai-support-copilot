import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ProblemDetailsDto } from './problem-details.dto';

/**
 * Per-client rate limit for routes that call a paid or quota-limited AI provider (LLM or embeddings).
 * The limit is `AI_RATE_LIMIT` requests per minute (ThrottlerModule in app.module.ts). Only these routes
 * use the guard; plain CRUD is not throttled.
 */
export const AiRateLimited = () =>
  applyDecorators(
    UseGuards(ThrottlerGuard),
    ApiTooManyRequestsResponse({
      type: ProblemDetailsDto,
      description: 'RATE_LIMITED: too many AI requests; see the Retry-After header',
    }),
  );
