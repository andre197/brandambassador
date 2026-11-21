import cookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Deps } from './deps.js';
import { registerRequestContext } from './plugins/auth.js';
import { registerErrorHandling } from './plugins/errors.js';
import { registerSecurity } from './plugins/security.js';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import { createServices, type Services } from './services/index.js';

export async function buildApp(deps: Deps, services: Services = createServices(deps)): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.log as FastifyBaseLogger,
    trustProxy: deps.config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    ...(deps.config.isTest ? { disableRequestLogging: true } : {}),
    routerOptions: { ignoreTrailingSlash: true },
  });

  app.decorate('deps', deps);
  app.decorate('services', services);

  registerErrorHandling(app);
  await app.register(cookie);
  await registerSecurity(app, deps);
  registerRequestContext(app, deps, services);

  app.get('/api/v1/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(apiRoutes, { prefix: '/api/v1' });

  return app;
}
