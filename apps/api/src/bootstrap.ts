import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppEnv } from './config/env.validation';

/** Shared app configuration so main.ts and integration tests boot the exact same app. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppEnv, true>);

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }).split(',') });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
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
