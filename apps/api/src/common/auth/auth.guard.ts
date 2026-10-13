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
import { PrismaService } from '../prisma/prisma.service';
import type { AppEnv } from '../../config/env.validation';
import { AuthRequest, IS_PUBLIC, ROLES_KEY, verifyAccessToken } from './auth';

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
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const id = verifyAccessToken(token, this.config.get('JWT_SECRET', { infer: true }));
    if (!id) throw new UnauthorizedException('Sign in to continue.');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new UnauthorizedException('This account is inactive.');
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.includes(user.role))
      throw new ForbiddenException('Your role cannot perform this action.');
    await this.assertTicketScope(req);
    return true;
  }

  private async assertTicketScope(req: AuthRequest): Promise<void> {
    if (req.user.role !== 'AGENT') return;
    let ticketId: string | undefined;
    const path = req.path;
    const routeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (path.includes('/tickets/')) ticketId = routeId;
    else if (path.includes('/escalations/')) {
      const rec = routeId
        ? await this.prisma.escalationRecommendation.findUnique({
            where: { id: routeId },
            select: { ticketId: true },
          })
        : null;
      ticketId = rec?.ticketId;
    } else if (path.includes('/drafts/')) {
      const draft = routeId
        ? await this.prisma.aiDraftResponse.findUnique({
            where: { id: routeId },
            select: { ticketId: true },
          })
        : null;
      ticketId = draft?.ticketId;
    }
    if (!ticketId) return;
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { assigneeId: true },
    });
    if (!ticket || ticket.assigneeId !== req.user.id)
      throw new ForbiddenException('You can only access tickets assigned to you.');
  }
}
