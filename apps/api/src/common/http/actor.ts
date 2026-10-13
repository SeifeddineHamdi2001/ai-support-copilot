import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ActorType } from '@prisma/client';
import type { AuthRequest } from '../auth/auth';

/** Who performed a change, as written to TicketEvent / TicketAssignment. */
export interface Actor {
  type: ActorType;
  id: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', id: null };
export const AI_ACTOR: Actor = { type: 'AI', id: null };

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
  if (!user?.id) return SYSTEM_ACTOR;
  return { type: 'USER', id: user.id };
});

/** Requests are authenticated globally; this alias remains for call sites with optional audit actors. */
export const OptionalActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
  if (!user?.id) return SYSTEM_ACTOR;
  return { type: 'USER', id: user.id };
});
