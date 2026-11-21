import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Development: share the monorepo-root .env with the API. Real env vars take precedence.
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const apiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:4300';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@ba/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    // One origin: the browser calls /api/* and Next forwards it to the API. In production the
    // reverse proxy routes /api/* straight to the API.
    return { beforeFiles: [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }], afterFiles: [], fallback: [] };
  },
};

export default withNextIntl(nextConfig);
