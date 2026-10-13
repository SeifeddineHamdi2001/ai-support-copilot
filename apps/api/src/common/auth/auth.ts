import { createHmac, timingSafeEqual } from 'node:crypto';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user: AuthUser;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const ACTING_AGENT_REQUIRED = 'actingAgentRequired';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const ActingAgentRequired = () => SetMetadata(ACTING_AGENT_REQUIRED, true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthRequest>().user,
);
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
  return { type: 'USER' as const, id: user ? user.id : null };
});

export function signAccessToken(user: AuthUser, secret: string, now = Date.now()): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: user.id,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 8 * 60 * 60,
  });
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const actual = Buffer.from(parts[2], 'base64url');
  const expected = createHmac('sha256', secret).update(data).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string };
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
      sub?: string;
      exp?: number;
    };
    if (
      header.alg !== 'HS256' ||
      typeof claims.sub !== 'string' ||
      !claims.exp ||
      claims.exp <= now / 1000
    )
      return null;
    return claims.sub;
  } catch {
    return null;
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
