import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppEnv } from '../../config/env.validation';
import { signAccessToken } from '../../common/auth/auth';

const scrypt = promisify(scryptCb);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (
      !user?.isActive ||
      !user.passwordHash ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    const profile = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: true,
    };
    return {
      accessToken: signAccessToken(profile, this.config.get('JWT_SECRET', { infer: true })),
      expiresIn: 28800,
      user: profile,
    };
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = Buffer.from(cryptoRandom(), 'hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;
  if (!/^[0-9a-fA-F]{32}$/.test(saltHex) || !/^[0-9a-fA-F]{128}$/.test(keyHex)) return false;
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length === 0) return false;
  const actual = (await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cryptoRandom(): string {
  return randomBytes(16).toString('hex');
}
