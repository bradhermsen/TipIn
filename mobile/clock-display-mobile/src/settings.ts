import { sections, Section } from './decoder';

export type Settings = {
  host: string; port: string; home: string; away: string;
  visibility: Record<Section, 'auto' | 'show' | 'hide'>;
};
export const defaults: Settings = {
  host: '', port: '80', home: 'HOME', away: 'AWAY',
  visibility: { period: 'auto', goals: 'auto', shots: 'auto', penalties: 'auto' },
};

export function validateSettings(settings: Settings, token: string): string | null {
  const host = settings.host.trim();
  if (!host || host.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
    || host.includes('..')) return 'Enter an IPv4 address or hostname only (no ws://, path, or spaces).';
  if (/^[\d.]+$/.test(host) && (host.split('.').length !== 4 || host.split('.').some(p => Number(p) > 255 || p.length > 3))) return 'Enter a valid IPv4 address.';
  if (!/^\d{1,5}$/.test(settings.port) || Number(settings.port) < 1 || Number(settings.port) > 65535) return 'Port must be 1–65535.';
  if (!token.trim() || token.length > 512) return 'Enter the gateway security token (maximum 512 characters).';
  if (!settings.home.trim() || !settings.away.trim() || settings.home.length > 20 || settings.away.length > 20) return 'Team labels must contain 1–20 characters.';
  return null;
}

export function parseSettings(raw: string | null): Settings {
  if (!raw) return structuredDefaults();
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Stored settings are invalid.');
  const result = structuredDefaults();
  for (const key of ['host', 'port', 'home', 'away'] as const) {
    if (typeof value[key] !== 'string') throw new Error('Stored settings are invalid.');
    result[key] = value[key];
  }
  for (const key of sections) {
    const mode = value.visibility?.[key];
    if (!['auto', 'show', 'hide'].includes(mode)) throw new Error('Stored visibility is invalid.');
    result.visibility[key] = mode;
  }
  return result;
}
export const structuredDefaults = (): Settings => ({ ...defaults, visibility: { ...defaults.visibility } });
export const gatewayUrl = (settings: Settings) => `ws://${settings.host.trim()}:${Number(settings.port)}/ws`;
