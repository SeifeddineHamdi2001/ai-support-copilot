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

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }).split(',') });
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
    .addGlobalParameters({
      name: 'X-User-Id',
      in: 'header',
      required: false,
      description: 'Acting agent id (seeded user). No auth in scope.',
    })
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
