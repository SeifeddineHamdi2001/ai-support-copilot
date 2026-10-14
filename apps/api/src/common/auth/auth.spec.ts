import { hashPassword, verifyPassword } from '../../modules/auth/auth.service';
import { signAccessToken, verifyAccessToken, type AuthUser } from './auth';

describe('Auth & Cryptography (unit)', () => {
  const secret = 'test-jwt-secret-that-is-at-least-32-characters-long!';
  const user: AuthUser = {
    id: '00000000-0000-4000-8000-000000000101',
    email: 'alex.morgan@acme-support.test',
    name: 'Alex Morgan',
    role: 'ADMIN',
  };

  describe('JWT access tokens (signAccessToken & verifyAccessToken)', () => {
    it('signs and verifies a valid token successfully', () => {
      const now = 1_700_000_000_000;
      const token = signAccessToken(user, secret, now);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const verifiedId = verifyAccessToken(token, secret, now);
      expect(verifiedId).toBe(user.id);
    });

    it('rejects a token signed with a different secret', () => {
      const now = 1_700_000_000_000;
      const token = signAccessToken(user, secret, now);
      const invalidSecret = 'completely-different-secret-key-32-chars!';

      expect(verifyAccessToken(token, invalidSecret, now)).toBeNull();
    });

    it('rejects an expired token', () => {
      const now = 1_700_000_000_000;
      const token = signAccessToken(user, secret, now);

      // Token expires in 8 hours (28,800 seconds = 28,800,000 ms)
      const afterExpiry = now + 28_801_000;
      expect(verifyAccessToken(token, secret, afterExpiry)).toBeNull();
    });

    it('rejects a tampered payload or signature', () => {
      const now = 1_700_000_000_000;
      const token = signAccessToken(user, secret, now);
      const [header, payload, signature] = token.split('.');

      // Alter payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: '00000000-0000-4000-8000-999999999999', exp: Math.floor(now / 1000) + 1000 }),
      ).toString('base64url');
      expect(verifyAccessToken(`${header}.${tamperedPayload}.${signature}`, secret, now)).toBeNull();

      // Alter signature
      const tamperedSig = signature.slice(0, -2) + 'aa';
      expect(verifyAccessToken(`${header}.${payload}.${tamperedSig}`, secret, now)).toBeNull();
    });

    it('rejects malformed token strings', () => {
      expect(verifyAccessToken('not-a-jwt', secret)).toBeNull();
      expect(verifyAccessToken('one.two', secret)).toBeNull();
      expect(verifyAccessToken('one.two.three.four', secret)).toBeNull();
      expect(verifyAccessToken('', secret)).toBeNull();
    });

    it('rejects tokens with non-HS256 algorithm or invalid sub claim', () => {
      const now = 1_700_000_000_000;
      const invalidAlgHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const validPayload = Buffer.from(
        JSON.stringify({ sub: user.id, exp: Math.floor(now / 1000) + 3600 }),
      ).toString('base64url');
      expect(verifyAccessToken(`${invalidAlgHeader}.${validPayload}.invalidsig`, secret, now)).toBeNull();

      const invalidSubPayload = Buffer.from(
        JSON.stringify({ sub: 12345, exp: Math.floor(now / 1000) + 3600 }),
      ).toString('base64url');
      const validHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      expect(verifyAccessToken(`${validHeader}.${invalidSubPayload}.invalidsig`, secret, now)).toBeNull();
    });
  });

  describe('Password cryptography (hashPassword & verifyPassword)', () => {
    it('generates an scrypt hash with a 16-byte random salt', async () => {
      const hash1 = await hashPassword('RelayDemo2026!');
      const hash2 = await hashPassword('RelayDemo2026!');

      expect(hash1).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(hash2).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      // Different random salts
      expect(hash1).not.toBe(hash2);
    });

    it('verifies the correct password against its hash', async () => {
      const password = 'StrongPassword123!';
      const hash = await hashPassword(password);

      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it('rejects an incorrect password', async () => {
      const hash = await hashPassword('CorrectPassword123!');

      expect(await verifyPassword('WrongPassword123!', hash)).toBe(false);
      expect(await verifyPassword('', hash)).toBe(false);
    });

    it('returns false for malformed encoded password strings', async () => {
      expect(await verifyPassword('password', 'bcrypt$invalid$format')).toBe(false);
      expect(await verifyPassword('password', 'scrypt$shortsalt$onlytwo')).toBe(false);
      expect(await verifyPassword('password', 'not-valid')).toBe(false);
      expect(await verifyPassword('password', '')).toBe(false);
    });
  });
});
