---
name: nestjs-api-conventions
description: Conventions for the NestJS 11 + Prisma 6 API in this repo — module layout, DTO validation, Problem Details errors, optimistic locking, transactional audit events, and the ticket state machine. Use for any backend module, controller, service, DTO, or error-handling work.
---

# NestJS API conventions (NestJS 11 + Prisma 6)

Reviewers judge "API endpoints and database relationships are properly designed" and "ticket data remains
consistent; errors are handled safely". Every backend change must follow the patterns below.

## Module layout
```
apps/api/src/
  main.ts                       global prefix api/v1, ValidationPipe, ProblemDetailsFilter, Swagger, CORS
  common/
    prisma/prisma.service.ts    extends PrismaClient, onModuleInit $connect, enableShutdownHooks
    errors/problem-details.filter.ts
    errors/app-errors.ts        ConflictError, NotFoundError, InvalidTransitionError, AiUnavailableError
    pagination.dto.ts
  modules/<name>/
    <name>.module.ts  <name>.controller.ts  <name>.service.ts
    dto/*.dto.ts      <name>.service.spec.ts (unit)   test/<name>.int-spec.ts (integration)
```
Controllers are thin: parse input, call one service method, return. Business rules live in services or in
pure functions (state machine, escalation rules) that are unit tested without Nest.

## Validation
- Global `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- DTOs use class-validator + `@ApiProperty` on every field. Enums come from `@prisma/client` or `packages/shared`.
- Limits on every string: `@MaxLength` (subject 200, body 10 000, note 1 000). IDs are `@IsUUID()`.
- Query DTOs for lists: `page` (min 1), `limit` (1–100, default 20), `sort` whitelist, optional filters.
- Path params: `ParseUUIDPipe`.

## Problem Details errors (one shape everywhere)
```json
{ "type": "https://errors.copilot.local/<code>", "title": "Version conflict", "status": 409,
  "detail": "Ticket was modified by someone else. Reload and retry.", "errorCode": "TICKET_VERSION_CONFLICT",
  "errors": [{ "field": "status", "message": "..." }], "instance": "/api/v1/tickets/…" }
```
Global `@Catch()` filter maps:
| Source | Status | errorCode |
|---|---|---|
| ValidationPipe BadRequestException | 400 | VALIDATION_FAILED (+ errors[] per field) |
| Prisma P2025 (record not found) | 404 | NOT_FOUND |
| Prisma P2002 (unique) | 409 | UNIQUE_VIOLATION (field from meta.target) |
| Prisma P2003 (FK) | 422 | INVALID_REFERENCE |
| Version mismatch | 409 | <ENTITY>_VERSION_CONFLICT |
| Invalid status transition | 409 | INVALID_STATUS_TRANSITION (detail lists allowed targets) |
| AI provider failure / timeout | 503 | AI_PROVIDER_UNAVAILABLE |
| Throttled | 429 | RATE_LIMITED |
| Anything else | 500 | INTERNAL_ERROR — log the stack, never return it |

Content-Type `application/problem+json`. Never leak SQL, stack traces, prompts, or API keys in responses.

## Optimistic locking
Every mutating ticket request body contains `version`. Pattern:
```ts
const res = await tx.ticket.updateMany({
  where: { id, version: dto.version },
  data: { ...changes, version: { increment: 1 } },
});
if (res.count === 0) {
  const exists = await tx.ticket.findUnique({ where: { id }, select: { id: true } });
  throw exists ? new ConflictError('TICKET_VERSION_CONFLICT') : new NotFoundError('TICKET');
}
```
Return the updated ticket (with the new version) so the UI can continue.

## Transactions + audit
State change, `TicketEvent`, and any `TicketAssignment` row are written in ONE `prisma.$transaction(async tx => …)`.
Event types: CREATED, STATUS_CHANGED, ASSIGNED, UNASSIGNED, PRIORITY_CHANGED, AI_CLASSIFIED,
DRAFT_GENERATED, DRAFT_APPROVED, DRAFT_REJECTED, ESCALATION_RECOMMENDED, ESCALATION_ACCEPTED,
ESCALATION_DISMISSED. `fromValue`/`toValue` as strings, extra info in `metadata`.
Actor: `X-User-Id` header (seeded agent, validated to exist) → USER; background work → SYSTEM; AI results → AI.

## Ticket state machine (pure function in `tickets/ticket-state-machine.ts`)
```ts
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};
export function assertTransition(from, to) { … throws InvalidTransitionError(from, to, TRANSITIONS[from]) }
```
Side effects: RESOLVED sets `resolvedAt`; OPEN from RESOLVED clears it. Assigning an OPEN ticket does not
change status automatically (keep behaviour explicit). Unit test every allowed and a sample of forbidden pairs.

## Priority rules
`prioritySource`: DEFAULT on create (priority MEDIUM), AI after a valid classification, MANUAL after a
user PATCH. AI never overwrites MANUAL. Record PRIORITY_CHANGED events for both AI and manual changes.

## Swagger
`/api/docs` (UI) and `/api/docs-json`. Tag per module, `@ApiOperation` summary per route, documented error
responses (`@ApiConflictResponse`, `@ApiNotFoundResponse`, `@ApiServiceUnavailableResponse` for AI routes).

## Testing
- Unit: services with Prisma mocked only when logic is pure; prefer extracting pure functions.
- Integration (`*.int-spec.ts`): Testcontainers `pgvector/pgvector:pg16`, run `prisma migrate deploy` in
  global setup, truncate tables between tests, boot the real Nest app with `Test.createTestingModule`,
  call it with Supertest. Cover: 201 create, 400 validation, 404, 409 transition, 409 version, assignment
  history rows, event rows written in the same request.
