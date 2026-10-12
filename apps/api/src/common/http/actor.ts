import { createParamDecorator, ExecutionContext, Injectable, PipeTransform } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorType } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { UnprocessableError, ValidationFailedError } from '../errors/app-errors';

/** Who performed a change, as written to TicketEvent / TicketAssignment. */
export interface Actor {
  type: ActorType;
  id: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', id: null };
/** Changes applied from a model's output (classification); the run itself is linked in event metadata. */
export const AI_ACTOR: Actor = { type: 'AI', id: null };

/** Raw `X-User-Id` header value (first one if repeated). */
const ActorHeader = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const value = ctx.switchToHttp().getRequest<Request>().headers['x-user-id'];
  return Array.isArray(value) ? value[0] : value;
});

/**
 * Resolves the `X-User-Id` header (no auth in scope) to an active agent. A malformed id is a 400 and an
 * unknown or inactive agent a 422, so the audit log never records an actor that does not exist.
 * Decorated so Nest has constructor metadata to inject PrismaService into the subclasses.
 */
@Injectable()
abstract class ActorPipe implements PipeTransform<string | undefined, Promise<Actor>> {
  protected abstract readonly required: boolean;

  constructor(private readonly prisma: PrismaService) {}

  async transform(value: string | undefined): Promise<Actor> {
    if (!value) {
      if (!this.required) return SYSTEM_ACTOR;
      throw new ValidationFailedError(
        [{ field: 'X-User-Id', message: 'header is required for this operation' }],
        'Send the acting agent id in the X-User-Id header.',
      );
    }
    if (!isUUID(value)) {
      throw new ValidationFailedError([{ field: 'X-User-Id', message: 'must be a UUID' }]);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: value },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new UnprocessableError('INVALID_ACTOR', `X-User-Id ${value} is not an active agent.`, [
        { field: 'X-User-Id', message: 'unknown or inactive agent' },
      ]);
    }
    return { type: 'USER', id: user.id };
  }
}

@Injectable()
class RequiredActorPipe extends ActorPipe {
  protected readonly required = true;
}

@Injectable()
class OptionalActorPipe extends ActorPipe {
  protected readonly required = false;
}

/** Acting agent from `X-User-Id`; the request is rejected without it. */
export const CurrentActor = () => ActorHeader(RequiredActorPipe);

/** Acting agent from `X-User-Id` when present, otherwise SYSTEM (e.g. tickets created by an intake channel). */
export const OptionalActor = () => ActorHeader(OptionalActorPipe);
