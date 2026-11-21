// Side-effect module: import first in every entrypoint. Loads the repo-root `.env` in
// development. Values already present in the environment win. Production uses real env vars.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.js';

const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
