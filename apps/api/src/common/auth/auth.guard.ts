import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import type { AppEnv } from '../../config/env.validation';
import { ACTING_AGENT_REQUIRED, AuthRequest, IS_PUBLIC, ROLES_KEY, verifyAccessToken } from './auth';
import { UnprocessableError, ValidationFailedError } from '../errors/app-errors';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    let id = verifyAccessToken(token, this.config.get('JWT_SECRET', { infer: true }));

    const actorHeader = req.headers['x-user-id'];
    const xUserId = Array.isArray(actorHeader) ? actorHeader[0] : actorHeader;

    if (!id && xUserId) {
      if (!isUUID(xUserId)) {
        throw new ValidationFailedError([{ field: 'X-User-Id', message: 'must be a UUID' }]);
      }
      id = xUserId;
    }

    if (id) {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
      if (!user?.isActive) {
        if (xUserId && !token) {
          throw new UnprocessableError('INVALID_ACTOR', `X-User-Id ${xUserId} is not an active agent.`, [
            { field: 'X-User-Id', message: 'unknown or inactive agent' },
          ]);
        }
        throw new UnauthorizedException('This account is inactive.');
      }
      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    }

    if (isPublic) return true;

    if (!req.user) {
      const requiresActor = this.reflector.getAllAndOverride<boolean>(ACTING_AGENT_REQUIRED, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (requiresActor) {
        throw new ValidationFailedError(
          [{ field: 'X-User-Id', message: 'header is required for this operation' }],
          'Send the acting agent id in the X-User-Id header.',
        );
      }
      throw new UnauthorizedException('Sign in to continue.');
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user.role))
      throw new ForbiddenException('Your role cannot perform this action.');
    await this.assertTicketScope(req);
    return true;
  }

  private async assertTicketScope(req: AuthRequest): Promise<void> {
    if (req.user?.role !== 'AGENT') return;
    let ticketId: string | undefined;
    const path = req.path;
    const routeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (path.includes('/tickets/')) ticketId = routeId;
    else if (path.includes('/escalations/')) {
      const rec = routeId && isUUID(routeId)
        ? await this.prisma.escalationRecommendation.findUnique({
            where: { id: routeId },
            select: { ticketId: true },
          })
        : null;
      ticketId = rec?.ticketId;
    } else if (path.includes('/drafts/')) {
      const draft = routeId && isUUID(routeId)
        ? await this.prisma.aiDraftResponse.findUnique({
            where: { id: routeId },
            select: { ticketId: true },
          })
        : null;
      ticketId = draft?.ticketId;
    }
    if (!ticketId || !isUUID(ticketId)) return;
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { assigneeId: true },
    });
    if (!ticket) return;
    if (ticket.assigneeId !== req.user.id)
      throw new ForbiddenException('You can only access tickets assigned to you.');
  }
}
