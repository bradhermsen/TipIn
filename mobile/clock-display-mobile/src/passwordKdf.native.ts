import { pbkdf2 } from 'react-native-quick-crypto';

export function derivePasswordKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, 'sha256', (error, key) => {
      if (error) reject(error);
      else if (!key || key.length !== 32) reject(new Error('Native password derivation returned an invalid result.'));
      else resolve(new Uint8Array(key));
    });
  });
}
