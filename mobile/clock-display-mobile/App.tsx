import React, { useEffect, useRef, useState } from 'react';
import {
  AppState, BackHandler, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View, KeyboardAvoidingView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import NetInfo from '@react-native-community/netinfo';
import { ConnectionState, DisplayConnection, initialState, Socket, testConnection } from './src/connection';
import { isVisible, sections } from './src/decoder';
import { gatewayUrl, Settings, structuredDefaults, validateSettings } from './src/settings';
import { LocalStore } from './src/storage';
import { passwordError } from './src/password';
import { formatLocalDateTime } from './src/localTime';

const factory = (url: string) => new WebSocket(url) as unknown as Socket;
const store = new LocalStore();
const message = (error: unknown) => error instanceof Error ? error.message : 'Operation failed. Please try again.';
type Mode = 'closed' | 'setup' | 'unlock' | 'config';
const age = (ms: number | null) => ms === null ? 'not yet received' : `${Math.floor(ms / 1000)}s ago`;
const informationFontSize = 34;

function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && { opacity: 0.4 }]}>
    <Text style={styles.buttonText}>{title}</Text>
  </Pressable>;
}
function Field({ label, value, onChange, secret = false, numeric = false, max = 253 }: {
  label: string; value: string; onChange: (value: string) => void; secret?: boolean; numeric?: boolean; max?: number;
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={secret}
      autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? 'number-pad' : 'default'}
      maxLength={max} style={styles.input} placeholderTextColor="#7e8d9f" /></View>;
}

function LocalClock({ foreground }: { foreground: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!foreground) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [foreground]);
  return <Text accessibilityLabel="Local date and time" adjustsFontSizeToFit numberOfLines={1} style={styles.localClock}>
    {formatLocalDateTime(now)}
  </Text>;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(structuredDefaults);
  const [token, setToken] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [fatal, setFatal] = useState('');
  const [mode, setMode] = useState<Mode>('closed');
  const modeRef = useRef<Mode>('closed');
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [state, setState] = useState<ConnectionState>(initialState);
  const [draft, setDraft] = useState<Settings>(structuredDefaults);
  const [draftToken, setDraftToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<ConnectionState | null>(null);
  const [testTimedOut, setTestTimedOut] = useState(false);
  const [wait, setWait] = useState(0);
  const connection = useRef<DisplayConnection | null>(null);
  const cancelTest = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const { width, height } = useWindowDimensions();

  const switchMode = (next: Mode) => { modeRef.current = next; setMode(next); };
  const clearSecrets = () => {
    setPassword(''); setConfirm(''); setCurrentPassword(''); setNewPassword(''); setNewConfirm(''); setDraftToken('');
  };
  const close = () => {
    generation.current++;
    cancelTest.current?.(); cancelTest.current = null;
    clearSecrets(); setDraft(structuredDefaults()); setError(''); setNotice('');
    setAdvanced(false); setChangingPassword(false); setTestState(null); setTesting(false); setTestTimedOut(false);
    switchMode('closed');
  };
  useEffect(() => {
    let active = true;
    store.load().then(saved => {
      if (!active) return;
      setSettings(saved.settings); setToken(saved.token); setLoaded(true);
      if (saved.setup && AppState.currentState === 'active') switchMode('setup');
    }).catch(() => { if (active) setFatal('Local storage could not be read safely. Restart the app; if this persists, use Android Settings → Apps → TipIn Clock Display → Storage → Clear data.'); });
    return () => { active = false; cancelTest.current?.(); };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      setForeground(next === 'active');
      if (next !== 'active') close();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (foreground) {
      void activateKeepAwakeAsync('tipin-clock').catch(() => {});
      void NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    } else void deactivateKeepAwake('tipin-clock');
    return () => { void deactivateKeepAwake('tipin-clock'); };
  }, [foreground]);
  useEffect(() => {
    if (!loaded || !foreground || !settings.host || !token) return;
    const client = new DisplayConnection(gatewayUrl(settings), token, factory, setState);
    connection.current = client;
    client.start();
    let online: boolean | null = null;
    const unsubscribe = NetInfo.addEventListener(network => {
      if (network.isConnected === true && online === false) client.reconnect();
      online = network.isConnected;
    });
    return () => { unsubscribe(); client.stop(); connection.current = null; };
  }, [loaded, foreground, settings, token]);
  useEffect(() => {
    if (mode === 'closed') return;
    const id = setInterval(() => setWait(store.waitSeconds()), 250);
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => { clearInterval(id); back.remove(); };
  }, [mode]);

  const open = () => {
    if (!loaded || fatal || busyRef.current || modeRef.current !== 'closed') return;
    clearSecrets(); setError(''); setWait(store.waitSeconds());
    // A canceled first run must still require password creation.
    store.load().then(saved => switchMode(saved.setup ? 'setup' : 'unlock')).catch(() => setFatal('Unable to access secure storage. Restart the app or Clear App Data.'));
  };
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(message(e)); }
    finally { busyRef.current = false; setBusy(false); setWait(store.waitSeconds()); }
  };
  const unlock = () => void run(async () => {
    const epoch = generation.current;
    if (mode === 'setup') {
      const invalid = passwordError(password, confirm);
      if (invalid) throw new Error(invalid);
      await store.create(password);
    } else await store.unlock(password);
    setPassword(''); setConfirm('');
    if (epoch !== generation.current || AppState.currentState !== 'active') return;
    setDraft({ ...settings, visibility: { ...settings.visibility } }); setDraftToken(token);
    switchMode('config');
  });
  const save = () => void run(async () => {
    const invalid = validateSettings(draft, draftToken);
    if (invalid) throw new Error(invalid);
    const next = { ...draft, host: draft.host.trim(), home: draft.home.trim(), away: draft.away.trim() };
    await store.save(next, draftToken);
    setState(initialState()); setSettings(next); setToken(draftToken); close();
  });
  const test = () => {
    const invalid = validateSettings(draft, draftToken);
    if (invalid) { setError(invalid); return; }
    cancelTest.current?.();
    setError(''); setTesting(true); setTestTimedOut(false); setTestState(null);
    let received = false;
    cancelTest.current = testConnection(gatewayUrl(draft), draftToken, factory,
      result => { received ||= result.ageMs !== null || result.auth === 'rejected'; setTestState(result); },
      () => { setTesting(false); setTestTimedOut(!received); });
  };
  const changePassword = () => void run(async () => {
    const invalid = passwordError(newPassword, newConfirm);
    if (invalid) throw new Error(invalid);
    const epoch = generation.current;
    await store.change(currentPassword, newPassword);
    setCurrentPassword(''); setNewPassword(''); setNewConfirm('');
    if (epoch === generation.current) { setChangingPassword(false); setNotice('Local password changed.'); }
  });
  const update = (key: 'host' | 'port' | 'home' | 'away', value: string) => {
    cancelTest.current?.(); setTestState(null); setTestTimedOut(false);
    setDraft(previous => ({ ...previous, [key]: value }));
  };
  const snapshot = state.snapshot;
  const visible = (section: typeof sections[number]) => isVisible(snapshot, section, settings.visibility[section]);
  const stale = state.label !== 'LIVE' && state.label !== 'SOURCE UNKNOWN';
  const clockLength = snapshot?.clock.length ?? 5;
  const textSize = Math.min(height * 0.48, (width - 48) / (clockLength * 0.62));
  const team = (side: 0 | 1) => <View style={[styles.team, side === 1 && { alignItems: 'flex-end' }]}>
    {(visible('goals') || visible('shots') || visible('penalties')) && <Text adjustsFontSizeToFit numberOfLines={1} style={styles.teamLabel}>{side === 0 ? settings.home : settings.away}</Text>}
    <View style={styles.metrics}>
      {visible('goals') && <Text style={styles.metric}>GOALS <Text style={styles.metricValue}>{snapshot?.goals[side] ?? '—'}</Text></Text>}
      {visible('shots') && <Text style={styles.metric}>SHOTS <Text style={styles.metricValue}>{snapshot?.shots[side] ?? '—'}</Text></Text>}
    </View>
    {visible('penalties') && (snapshot?.penalties[side] == null
      ? <Text style={styles.penalty}>PEN —</Text>
      : snapshot.penalties[side]!.map((penalty, index) => <Text style={styles.penalty} key={index}>PEN  #{penalty.player}  {penalty.time}</Text>))}
  </View>;

  return <View style={styles.root}>
    <StatusBar hidden />
    <Pressable accessibilityLabel="Clock display. Long press to configure." onLongPress={open} delayLongPress={700} style={styles.display}>
      <View style={styles.top}>
        <View style={styles.brandGroup}>
          <Image source={require('./assets/TipIn NoBG.png')} accessibilityLabel="TipIn logo" resizeMode="contain" style={styles.brand} />
          <Text accessibilityLabel="TipIn Scoring" numberOfLines={1} style={styles.brandText}>
            <Text style={styles.brandTip}>Tip</Text><Text style={styles.brandIn}>In</Text> Scoring
          </Text>
        </View>
        <View style={styles.statusGroup}>
          {(stale || !foreground) && <Text style={[styles.status, { color: '#ffbd69' }]}>{foreground ? state.label : 'PAUSED · RECONNECTING ON RESUME'}</Text>}
        </View>
      </View>
      <View style={styles.clockRegion}>
        <View style={[styles.clockFace, { width: textSize * clockLength * 0.62 }]}>
          <LocalClock foreground={foreground} />
          <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.clock, { fontSize: textSize, lineHeight: textSize * 1.15, color: stale && snapshot ? '#c1c6ce' : '#f8fafc' }]}>{snapshot?.clock ?? '—:—'}</Text>
        </View>
      </View>
      <View style={styles.strip}>
        {team(0)}
        <View style={styles.period}>{visible('period') && <><Text style={styles.teamLabel}>PERIOD</Text><Text style={styles.periodValue}>{snapshot?.period ?? '—'}</Text></>}</View>
        {team(1)}
      </View>
      <View style={styles.footer}>
        <Text style={styles.hint}>{!settings.host ? 'LONG PRESS TO SET UP THIS DISPLAY' : stale ? `Last displayed update: ${age(state.trustedAgeMs)}` : ''}</Text>
        <Text style={styles.hint}>HOLD TO CONFIGURE</Text>
      </View>
      {!!fatal && <View style={styles.fatal}><Text style={styles.error}>{fatal}</Text></View>}
    </Pressable>
    <Modal visible={mode !== 'closed'} transparent animationType="fade" onRequestClose={close} supportedOrientations={['landscape']}>
      <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}><Text style={styles.title}>{mode === 'setup' ? 'Protect this display' : mode === 'unlock' ? 'Unlock configuration' : 'Display configuration'}</Text><Button title="Close" secondary onPress={close} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>
            {mode !== 'config' ? <>
              <Text style={styles.help}>{mode === 'setup' ? 'Create a device-local password (8–128 characters). This is separate from the gateway token.' : 'Enter this device’s local password. Clock viewing and reconnection stay unlocked.'}</Text>
              <Field label="Local password" value={password} onChange={setPassword} secret max={128} />
              {mode === 'setup' && <Field label="Confirm local password" value={confirm} onChange={setConfirm} secret max={128} />}
              {wait > 0 && <Text style={styles.error}>Retry in {wait} seconds.</Text>}
              <Button title={busy ? 'Verifying securely…' : mode === 'setup' ? 'Create password' : 'Unlock'} onPress={unlock} disabled={busy || wait > 0} />
              <Text style={styles.help}>Forgotten password? Android Settings → Apps → TipIn Clock Display → Storage → Clear data. All local settings will be removed.</Text>
            </> : <>
              <View style={styles.row}><View style={{ flex: 3 }}><Field label="Gateway IP / hostname" value={draft.host} onChange={v => update('host', v)} /></View><View style={{ flex: 1 }}><Field label="Port" value={draft.port} onChange={v => update('port', v)} numeric max={5} /></View></View>
              <Field label="Gateway security token" value={draftToken} onChange={v => { cancelTest.current?.(); setTestState(null); setTestTimedOut(false); setDraftToken(v); }} secret max={512} />
              <View style={styles.testPanel}>
                <Text style={styles.label}>CURRENT CONNECTION DIAGNOSTICS</Text>
                <Text style={styles.help}>Transport: {state.transport} · Authentication: {state.auth}</Text>
                <Text style={styles.help}>Status: {state.label}{state.demo ? ' · DEMO' : ''}</Text>
                <Text style={styles.help}>Last valid snapshot: {age(state.ageMs)} · Source update: {age(state.sourceAgeMs)}</Text>
                <Text style={styles.help}>Gateway cannot verify scoreboard freshness when source is unknown. DEMO means the gateway reports emulator mode.</Text>
              </View>
              <Text style={styles.help}>Auto displays valid values supplied by the gateway, including zeros. Existing gateways do not identify unsupported fields; use Hide for information your scoreboard does not supply.</Text>
              <View style={styles.row}><Button title={testing ? 'Testing…' : 'Test connection'} onPress={test} disabled={testing || busy} secondary /><Button title={advanced ? 'Fewer options' : 'Display options'} onPress={() => setAdvanced(!advanced)} secondary /></View>
              {testState && <View style={styles.testPanel}>
                <Text style={styles.help}>Transport: {testState.transport} · Authentication: {testState.auth}</Text>
                <Text style={styles.help}>Scoreboard source: {testState.source} · Last valid snapshot: {age(testState.ageMs)}</Text>
                <Text style={styles.help}>Source update: {age(testState.sourceAgeMs)}{testState.demo ? ' · DEMO' : ''}</Text>
                <Text style={testState.auth === 'rejected' ? styles.error : styles.help}>{testState.label}</Text>
              </View>}
              {testTimedOut && <Text style={styles.error}>No valid snapshot within 10 seconds. Check local Wi-Fi, host/port, token, gateway firmware and scoreboard input. Internet access is not required.</Text>}
              {advanced && <>
                <View style={styles.row}><View style={{ flex: 1 }}><Field label="Home label" value={draft.home} onChange={v => update('home', v)} max={20} /></View><View style={{ flex: 1 }}><Field label="Away label" value={draft.away} onChange={v => update('away', v)} max={20} /></View></View>
                {sections.map(section => <View key={section} style={styles.optionRow}><Text style={styles.optionLabel}>{section.toUpperCase()}</Text><View style={styles.row}>{(['auto', 'show', 'hide'] as const).map(choice => <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.visibility[section] === choice }} key={choice} onPress={() => setDraft(previous => ({ ...previous, visibility: { ...previous.visibility, [section]: choice } }))} style={[styles.choice, draft.visibility[section] === choice && styles.selected]}><Text style={styles.buttonText}>{choice.toUpperCase()}</Text></Pressable>)}</View></View>)}
                <Text style={styles.help}>Auto requires supported, valid metadata. Show keeps unavailable values as dashes. Older gateways always report source unknown.</Text>
                <Button title={changingPassword ? 'Cancel password change' : 'Change local password'} onPress={() => { setChangingPassword(!changingPassword); setCurrentPassword(''); setNewPassword(''); setNewConfirm(''); }} secondary />
                {changingPassword && <>
                  <Field label="Current local password" value={currentPassword} onChange={setCurrentPassword} secret max={128} />
                  <Field label="New local password" value={newPassword} onChange={setNewPassword} secret max={128} />
                  <Field label="Confirm new local password" value={newConfirm} onChange={setNewConfirm} secret max={128} />
                  <Button title={busy ? 'Updating securely…' : 'Update password now'} onPress={changePassword} disabled={busy || wait > 0} />
                  <Text style={styles.help}>Password changes take effect immediately, independently of Save / Cancel.{wait > 0 ? ` Retry in ${wait}s.` : ''}</Text>
                </>}
              </>}
              <Text style={styles.help}>Trusted local Wi-Fi only: gateway WebSocket traffic is unencrypted. This app never sends scoreboard controls.</Text>
            </>}
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {!!notice && <Text style={styles.success}>{notice}</Text>}
          </ScrollView>
          {mode === 'config' && <View style={styles.actions}><Button title="Cancel" secondary onPress={close} /><Button title={busy ? 'Saving…' : 'Save display settings'} onPress={save} disabled={busy || testing} /></View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  display: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  top: { position: 'absolute', top: 12, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between', zIndex: 1 },
  brand: { width: 64, height: 64 },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText: { color: '#e8edf5', fontSize: 24, fontWeight: '600' },
  brandTip: { color: '#e8edf5', fontStyle: 'italic', fontWeight: '800' },
  brandIn: { color: '#ff7b00', fontStyle: 'italic', fontWeight: '800' },
  statusGroup: { flexDirection: 'row', gap: 12, alignItems: 'center', alignSelf: 'flex-start' },
  status: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  demo: { color: '#000', backgroundColor: '#ffc76c', fontSize: 12, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3 },
  clockRegion: { flex: 70, justifyContent: 'center', alignItems: 'center' },
  clockFace: { alignItems: 'center', paddingTop: 16 },
  localClock: { alignSelf: 'flex-end', maxWidth: '100%', color: '#b8c5d8', fontSize: informationFontSize, fontWeight: '600', fontVariant: ['tabular-nums'], marginBottom: 4, paddingRight: 8 },
  clock: { fontFamily: 'monospace', fontWeight: '700', fontVariant: ['tabular-nums'], includeFontPadding: false, textAlign: 'center' },
  strip: { flex: 30, flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#202936', paddingTop: 8, gap: 12 },
  team: { flex: 1, alignItems: 'flex-start' },
  teamLabel: { color: '#8f9db0', fontSize: informationFontSize, fontWeight: '700' },
  metrics: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  metric: { color: '#8f9db0', fontSize: informationFontSize },
  metricValue: { color: '#f1f5f9', fontSize: informationFontSize, fontWeight: '700', fontVariant: ['tabular-nums'] },
  penalty: { color: '#e5c994', fontSize: informationFontSize, fontFamily: 'monospace', lineHeight: 40 },
  period: { width: '14%', alignItems: 'center' },
  periodValue: { color: '#f1f5f9', fontSize: informationFontSize, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 16 },
  hint: { color: '#778599', fontSize: 10, letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: '#000b', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: '100%', maxWidth: 620, maxHeight: '100%', backgroundColor: '#111a27', borderRadius: 16, borderWidth: 1, borderColor: '#30405a', overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderColor: '#29364a' },
  title: { color: '#f4f7fc', fontSize: 20, fontWeight: '700' },
  modalBody: { padding: 16, gap: 10 },
  field: { gap: 5, marginBottom: 2 },
  label: { color: '#b8c5d8', fontSize: 12, fontWeight: '600' },
  input: { backgroundColor: '#080f1c', borderWidth: 1, borderColor: '#35455f', borderRadius: 7, color: '#fff', paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, minHeight: 44 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  button: { minHeight: 42, borderRadius: 7, backgroundColor: '#246eb5', paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: '#26354b' },
  buttonText: { color: '#f5f8ff', fontSize: 13, fontWeight: '700' },
  help: { color: '#a4b3c9', fontSize: 12, lineHeight: 18 },
  error: { color: '#ffb08f', fontSize: 13, lineHeight: 19 },
  success: { color: '#79e7b5', fontSize: 13 },
  actions: { padding: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 10, borderTopWidth: 1, borderColor: '#29364a' },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionLabel: { color: '#b8c5d8', fontSize: 12, fontWeight: '600' },
  choice: { paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#202c3e', borderRadius: 6, borderWidth: 1, borderColor: '#35455f' },
  selected: { backgroundColor: '#245987', borderColor: '#6cb4f0' },
  testPanel: { padding: 10, borderRadius: 7, backgroundColor: '#080f1c' },
  fatal: { position: 'absolute', bottom: 40, left: 24, right: 24, padding: 16, backgroundColor: '#291b16', borderRadius: 8 },
});
