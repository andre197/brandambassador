import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Finds the @ba/api package root by walking up, so paths work from both src/ (tsx) and dist/ (node). */
function findApiRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@ba/api') return dir;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('could not locate the @ba/api package root');
    dir = parent;
  }
}

export const API_ROOT = findApiRoot();
/** Monorepo root (where .env and uploads/ live in development). */
export const REPO_ROOT = path.resolve(API_ROOT, '../..');
export const MIGRATIONS_DIR = path.join(API_ROOT, 'migrations');
