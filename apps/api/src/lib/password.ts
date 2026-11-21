import { hash, parseOptions, verify } from '@node-rs/argon2';

/** argon2id parameters (OWASP baseline: 19 MiB, t=2, p=1). The library defaults to argon2id. */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker/different parameters and should be upgraded. */
export function needsRehash(hashed: string): boolean {
  try {
    const o = parseOptions(hashed);
    return o.memoryCost !== OPTIONS.memoryCost || o.timeCost !== OPTIONS.timeCost || o.parallelism !== OPTIONS.parallelism;
  } catch {
    return true;
  }
}

let dummy: Promise<string> | null = null;

/** Verifies against a throwaway hash so unknown emails take as long as wrong passwords. */
export async function burnVerifyTime(password: string): Promise<void> {
  dummy ??= hash('dummy-password-for-timing', OPTIONS);
  await verifyPassword(await dummy, password);
}
