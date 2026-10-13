import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError, type FieldError } from './app-errors';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  errorCode: string;
  errors?: FieldError[];
  instance?: string;
}

const TYPE_BASE = 'https://errors.copilot.local/';

/** Default errorCode for framework HttpExceptions that carry no code of their own. */
const CODE_BY_STATUS: Partial<Record<number, string>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export function problem(
  status: number,
  errorCode: string,
  title: string,
  detail: string,
  errors?: FieldError[],
): ProblemDetails {
  return {
    type: TYPE_BASE + errorCode.toLowerCase().replace(/_/g, '-'),
    title,
    status,
    detail,
    errorCode,
    ...(errors?.length ? { errors } : {}),
  };
}

function isBodyParserError(e: unknown, type: string): boolean {
  return typeof e === 'object' && e !== null && (e as { type?: unknown }).type === type;
}

/**
 * Maps every error to one RFC 9457 Problem Details shape (`application/problem+json`).
 * Expected errors keep their message; anything unexpected becomes a generic 500 and is logged with its
 * stack, so SQL, stack traces and secrets never reach the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const body = this.toProblem(exception);
    if (body.status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${body.status} ${body.errorCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res
      .status(body.status)
      .type('application/problem+json')
      .json({ ...body, instance: req.originalUrl.split('?')[0] });
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof AppError) {
      return problem(
        exception.status,
        exception.errorCode,
        exception.title,
        exception.detail,
        exception.errors,
      );
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrisma(exception);
      if (mapped) return mapped;
    }

    if (exception instanceof ThrottlerException) {
      return problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many requests',
        'Too many AI requests from this client. Wait for the time in the Retry-After header and retry.',
      );
    }

    // body-parser rejects an oversized body before Nest sees it, with a plain error carrying the status.
    if (isBodyParserError(exception, 'entity.too.large')) {
      return problem(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'PAYLOAD_TOO_LARGE',
        'Payload too large',
        'The request body exceeds the 1 MB limit.',
      );
    }

    // Includes malformed JSON bodies: Nest turns body-parser's SyntaxError into a 400 BadRequestException.
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return problem(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      'Internal server error',
      'An unexpected error occurred. It has been logged.',
    );
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): ProblemDetails | undefined {
    switch (e.code) {
      case 'P2025':
        return problem(404, 'NOT_FOUND', 'Not found', 'The requested record does not exist.');
      case 'P2002': {
        const target = e.meta?.target;
        const fields = Array.isArray(target) ? target.map(String) : target ? [String(target)] : [];
        return problem(
          409,
          'UNIQUE_VIOLATION',
          'Already exists',
          fields.length
            ? `A record with this ${fields.join(', ')} already exists.`
            : 'A record with these values already exists.',
          fields.map((field) => ({ field, message: 'must be unique' })),
        );
      }
      case 'P2003':
        return problem(
          422,
          'INVALID_REFERENCE',
          'Invalid reference',
          'The request references a record that does not exist or is still in use.',
        );
      default:
        return undefined;
    }
  }

  private fromHttpException(e: HttpException): ProblemDetails {
    const status = e.getStatus();
    const response = e.getResponse();

    // Already a Problem Details body (e.g. the health check's 503): pass it through.
    if (typeof response === 'object' && response !== null && 'errorCode' in response) {
      return response as ProblemDetails;
    }

    const message =
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as { message: unknown }).message
        : e.message;
    const detail = Array.isArray(message) ? message.join('; ') : String(message);
    const title =
      typeof response === 'object' && response !== null && 'error' in response
        ? String((response as { error: unknown }).error)
        : e.name;
    return problem(status, CODE_BY_STATUS[status] ?? `HTTP_${status}`, title, detail);
  }
}
