import dns from 'node:dns';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { validationExceptionFactory } from './common/errors/validation';
import type { AppEnv } from './config/env.validation';

/** Shared app configuration so main.ts and integration tests boot the exact same app. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<AppEnv, true>);

  // Explicit cap: fits the largest DTO (a 100,000-character KB article); bigger bodies get 413.
  app.useBodyParser('json', { limit: '1mb' });
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  const rawCors = config.get('CORS_ORIGIN', { infer: true });
  const configuredOrigins = rawCors
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isDev = config.get('NODE_ENV', { infer: true }) === 'development';

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (configuredOrigins.includes(origin)) return callback(null, true);
      if (isDev) {
        try {
          const url = new URL(origin);
          if (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            /^192\.168\.\d+\.\d+$/.test(url.hostname) ||
            /^10\.\d+\.\d+\.\d+$/.test(url.hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(url.hostname)
          ) {
            return callback(null, true);
          }
        } catch {
          // Ignore invalid origin URLs
        }
      }
      return callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('AI Customer Support Copilot API')
    .setDescription(
      'Tickets, LLM classification, grounded drafts (RAG) and escalation recommendations.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
