import 'fastify';
import type { Deps } from './deps.js';
import type { Services } from './services/index.js';
import type { AuthState, ReqCtx } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
    services: Services;
  }

  interface FastifyRequest {
    /** The signed-in user, or null. Resolved for every /api request. */
    auth: AuthState | null;
    /** IP (hashed) and user agent for services. */
    ctx: ReqCtx;
  }

  interface FastifyContextConfig {
    /** CSRF mode for mutating methods. 'strict' (default): allowed Origin + JSON body. */
    csrf?: 'strict' | false;
    multipart?: boolean;
  }
}
