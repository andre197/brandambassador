import { zodFieldErrors } from '@ba/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/** Maps every error to `{ error: { code, message_key, fields? } }`. Never leaks stack traces. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | ZodError | Error, request, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) request.log.error({ err }, 'app error');
      return reply.status(err.status).send(err.toBody());
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(new AppError('validation_failed', { fields: zodFieldErrors(err) }).toBody());
    }
    const fe = err as FastifyError;
    const status = fe.statusCode ?? 500;
    if (status === 429) return reply.status(429).send(new AppError('rate_limited').toBody());
    if (status === 415 || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.status(415).send(new AppError('unsupported_media_type').toBody());
    }
    if (status === 413 || fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(new AppError('payload_too_large').toBody());
    }
    if (status >= 400 && status < 500) {
      // Malformed JSON, empty JSON body, bad params etc.
      return reply.status(400).send(new AppError('validation_failed').toBody());
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send(new AppError('internal').toBody());
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send(new AppError('not_found').toBody());
  });
}
