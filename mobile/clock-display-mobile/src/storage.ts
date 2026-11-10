import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { emptyRetry, failedRetry, makeVerifier, Retry, retrySeconds, validVerifier, Verifier, verifyPassword } from './password';
import { parseSettings, Settings } from './settings';

type Vault = { verifier: Verifier | null; token: string; retry: Retry };
const vaultKey = 'tipin.clockdisplay.vault.v1';
const settingsKey = 'tipin.clockdisplay.settings.v1';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export class LocalStore {
  private vault: Vault = { verifier: null, token: '', retry: emptyRetry() };
  private busy = false;
  async load() {
    const [secret, settings] = await Promise.all([SecureStore.getItemAsync(vaultKey, options), AsyncStorage.getItem(settingsKey)]);
    if (secret) {
      const vault = JSON.parse(secret) as Vault;
      if (!validVerifier(vault.verifier!) || typeof vault.token !== 'string'
        || !Number.isInteger(vault.retry?.failures) || vault.retry.failures < 0
        || !Number.isFinite(vault.retry?.retryAt) || vault.retry.retryAt < 0) throw new Error('Secure settings could not be read. Clear App Data to reset this device.');
      this.vault = vault;
    } else if (settings) {
      throw new Error('Secure credentials are missing. Clear App Data to repeat setup.');
    }
    return { settings: parseSettings(settings), token: this.vault.token, setup: !this.vault.verifier };
  }
  private async persist(vault: Vault) {
    await SecureStore.setItemAsync(vaultKey, JSON.stringify(vault), options);
    this.vault = vault;
  }
  waitSeconds() { return retrySeconds(this.vault.retry, Date.now()); }
  async unlock(password: string) {
    if (this.busy) throw new Error('Password verification is already in progress.');
    if (this.waitSeconds()) throw new Error(`Retry in ${this.waitSeconds()} seconds.`);
    if (!this.vault.verifier) throw new Error('Create a local password first.');
    this.busy = true;
    try {
      // Persist a failure BEFORE hashing: process termination cannot bypass the limiter.
      const retry = failedRetry(this.vault.retry, Date.now());
      await this.persist({ ...this.vault, retry });
      const ok = await verifyPassword(password, this.vault.verifier!);
      if (ok) await this.persist({ ...this.vault, retry: emptyRetry() });
      else throw new Error(`Incorrect password. Retry in ${this.waitSeconds()} seconds.`);
    } finally { this.busy = false; }
  }
  async create(password: string) {
    if (this.vault.verifier) throw new Error('A local password already exists.');
    const verifier = await makeVerifier(password, await Crypto.getRandomBytesAsync(16));
    await this.persist({ ...this.vault, verifier });
  }
  async change(current: string, next: string) {
    await this.unlock(current);
    const verifier = await makeVerifier(next, await Crypto.getRandomBytesAsync(16));
    await this.persist({ ...this.vault, verifier });
  }
  async save(settings: Settings, token: string) {
    const previous = this.vault;
    await this.persist({ ...this.vault, token });
    try { await AsyncStorage.setItem(settingsKey, JSON.stringify(settings)); }
    catch (error) { await this.persist(previous); throw error; }
  }
}
