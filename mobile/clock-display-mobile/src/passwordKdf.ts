import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

// Node tests use this implementation; Metro selects passwordKdf.native on Android.
export function derivePasswordKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: 32, asyncTick: 10 });
}
