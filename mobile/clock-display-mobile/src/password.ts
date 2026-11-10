import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { derivePasswordKey } from './passwordKdf';

export type Verifier = { version: 1; iterations: number; salt: string; hash: string };
export type Retry = { failures: number; retryAt: number };
export const iterations = 600000;
export const emptyRetry = (): Retry => ({ failures: 0, retryAt: 0 });

export function passwordError(password: string, confirmation: string) {
  if (password.length < 8 || password.length > 128) return 'Use 8–128 characters for the local password.';
  if (password !== confirmation) return 'The password confirmation does not match.';
  return null;
}
export async function makeVerifier(password: string, salt: Uint8Array): Promise<Verifier> {
  if (salt.length !== 16) throw new Error('Invalid salt.');
  const hash = await derivePasswordKey(password, salt, iterations);
  return { version: 1, iterations, salt: bytesToHex(salt), hash: bytesToHex(hash) };
}
export function validVerifier(value: Verifier) {
  return value?.version === 1 && value.iterations === iterations && /^[a-f0-9]{32}$/.test(value.salt) && /^[a-f0-9]{64}$/.test(value.hash);
}
export async function verifyPassword(password: string, verifier: Verifier): Promise<boolean> {
  if (!validVerifier(verifier) || password.length > 128) return false;
  const actual = await derivePasswordKey(password, hexToBytes(verifier.salt), verifier.iterations);
  const expected = hexToBytes(verifier.hash);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
export function failedRetry(retry: Retry, now: number): Retry {
  const failures = Math.min(30, retry.failures + 1);
  return { failures, retryAt: now + Math.min(300000, 1000 * 2 ** Math.min(failures - 1, 9)) };
}
export const retrySeconds = (retry: Retry, now: number) => Math.max(0, Math.ceil((retry.retryAt - now) / 1000));
