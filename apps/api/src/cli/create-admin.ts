import '../load-env.js';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loginIdSchema, passwordSchema } from '@ba/shared';
import { loadConfig } from '../config.js';
import { closeDeps, createDeps } from '../deps.js';
import { AuthService } from '../services/auth.service.js';

/**
 * Creates an administrator, or sets a new password for an existing one.
 *   npm run create-admin -- --login you@example.com
 * Without --password you are asked for it (this avoids shell quoting problems).
 * An email login also receives the admin notifications.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith('--') ? v : undefined;
}

function fail(message: string): never {
  console.error(`\nCould not create the admin: ${message}\n`);
  process.exit(1);
}

const login = loginIdSchema.safeParse(arg('login') ?? '');
if (!login.success) fail('give a login: npm run create-admin -- --login you@example.com\n(an email, or a username of 3-50 characters: letters, digits, dot, underscore, dash)');

let password = arg('password');
if (!password && stdin.isTTY) {
  const rl = createInterface({ input: stdin, output: stdout });
  password = (await rl.question('Password (at least 10 characters): ')).trim();
  rl.close();
}
if (!password || !passwordSchema.safeParse(password).success) fail(`the password must be 10 to 128 characters long (received ${password?.length ?? 0}).`);

const deps = createDeps(loadConfig());
try {
  const r = await new AuthService(deps).upsertAdmin(login.data, password);
  console.log(`\n${r.created ? 'Admin created' : 'Password changed'}: ${login.data}\nSign in at ${deps.config.SITE_URL}/login\n`);
} catch (err) {
  process.exitCode = 1;
  const e = err as Error & { code?: string };
  if (e.code === '42P01') console.error('\nThe database has no tables yet. Run "npm run migrate" first.\n');
  else if (/ECONNREFUSED|ENOTFOUND|connect/i.test(e.message)) console.error('\nThe database is not reachable. Start it with "npm run db:up".\n');
  else console.error(`\nCould not create the admin: ${e.message}\n`);
} finally {
  await closeDeps(deps);
}
