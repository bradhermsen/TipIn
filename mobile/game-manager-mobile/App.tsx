import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

type AccessRole = "GM" | "SM" | "CA" | "AD";

type Stage =
  | "login"
  | "home"
  | "verifyGame"
  | "rosterVerify"
  | "coachSignature"
  | "officialsVerify"
  | "gameDashboard"
  | "gameSummary"
  | "sendScoresheet";

type LoginResponse = {
  userId: string;
  role: AccessRole;
};

type TeamAssignment = {
  teamId?: string;
  id?: string;
  TeamId?: string;
  Id?: string;
  name?: string;
  Name?: string;
};

type NextGame = {
  teamId: string;
  gameId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  opponentName: string;
  startTime: string;
  homeTeamName?: string;
  homeTeamMascot?: string;
  awayTeamName?: string;
  awayTeamMascot?: string;
  arenaId?: string;
  rinkId?: string;
  arenaName?: string;
  rinkName: string;
  gatewayAvailable?: boolean;
  gameTypeName?: string;
  periodLengthMinutes?: number;
  levelName?: string;
  teamType?: string;
  sectionRegion?: string;
  conferenceDistrict?: string;
  status?: string;
};

type NextGameLookupResult = {
  nextGame: NextGame | null;
  closedMessage?: string;
};

type DebugPayload = Record<string, unknown>;

type SyncState = "up_to_date" | "syncing" | "queued" | "error";

type CompleteGamePayload = {
  notes: string;
  suspensionNotes: Array<{
    eventRef: string;
    notes: string;
  }>;
  shotSummary: {
    homeByPeriod: { p1: number; p2: number; p3: number; ot: number };
    awayByPeriod: { p1: number; p2: number; p3: number; ot: number };
    homeTotal: number;
    awayTotal: number;
  };
  goalieSummaries: Array<Record<string, unknown>>;
  emailDispatch: {
    to: string[];
    subject: string;
  };
};

type LiveShotSummaryPayload = CompleteGamePayload["shotSummary"];

type CompletionResponse = {
  emailRequested?: boolean;
  emailSent?: boolean;
  emailError?: string | null;
};

type PendingFinalizeRequest = {
  gameId: string;
  payload: CompleteGamePayload;
  queuedAtIso: string;
  attempts: number;
  lastError?: string;
};

type RosterPlayer = {
  playerId: string;
  fullName: string;
  jerseyNumber: number | null;
  position: string;
  grade: number | null;
  isGoalie: boolean;
  isActive: boolean;
};

type TeamCoach = {
  roleName: string;
  coachName: string;
  coachEmail?: string | null;
};

type SignatureContext =
  | {
      type: "coach";
      teamId: string;
      teamName: string;
      signerName: string;
    }
  | {
      type: "official";
      officialIndex: number;
      role: string;
      signerName: string;
    };

type OfficialVerification = {
  role: string;
  officialName: string;
  officialId?: string;
  officialEmail?: string | null;
  signatureImageBase64?: string | null;
  signedByName?: string | null;
  signedAtUtc?: string | null;
};

type OfficialOption = {
  officialId: string;
  displayName: string;
  email?: string | null;
  role: string;
};

type AddOfficialForm = {
  firstName: string;
  lastName: string;
  email: string;
  isReferee: boolean;
  isLinesman: boolean;
  isActive: boolean;
  assignmentRole: string;
};

const OFFICIAL_ASSIGNMENT_ROLES = [
  "Referee1",
  "Referee2",
  "Linesman1",
  "Linesman2",
] as const;

type EmailRecipientOption = {
  key: string;
  recipientName: string;
  recipientMeta: string;
  email: string;
};

type GoalStrength =
  | "Even Strength"
  | "Power Play"
  | "Short-Handed"
  | "Empty Net"
  | "Penalty Shot";

type GoalModalState = {
  visible: boolean;
  scoringTeamId: string;
  scoringTeamName: string;
  period: number;
  clockRemaining: string;
  timeInPeriod: string;
  strength: GoalStrength;
  scorerId: string;
  assist1Id: string;
  assist2Id: string;
};

type PenaltyType =
  | "Minor"
  | "Double Minor"
  | "Major"
  | "Misconduct"
  | "Game Misconduct"
  | "Match"
  | "Disqualification"
  | "Bench Minor"
  | "Penalty Shot";

type PenaltySuspensionBehavior =
  | "none"
  | "possible"
  | "automatic"
  | "automatic_review";

type PenaltyGoalExpiration = "none" | "expire" | "reduce_minor";

type PenaltyRule = {
  durationMinutes: number;
  affectsManpower: boolean;
  suspensionBehavior: PenaltySuspensionBehavior;
  requiresRefereeNotes: boolean;
  reviewRequired: boolean;
  goalExpiration: PenaltyGoalExpiration;
};

type PenaltyModalState = {
  visible: boolean;
  penalizedTeamId: string;
  penalizedTeamName: string;
  period: number;
  clockRemaining: string;
  timeInPeriod: string;
  playerId: string;
  infraction: string;
  durationMinutes: number;
  penaltyType: PenaltyType;
};

type PenaltyAdjustModalState = {
  visible: boolean;
  penaltyId: string;
  teamName: string;
  playerName: string;
  infraction: string;
  currentSeconds: number;
  durationMinutes: number;
  deltaSeconds: number;
};

type TimeoutModalState = {
  visible: boolean;
  teamSide: "home" | "away";
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  period: number;
  clockRemaining: string;
  timeInPeriod: string;
};

type PeriodFlowState = "NOT_STARTED" | "IN_PROGRESS" | "INTERMISSION";

type PeriodController = {
  state: PeriodFlowState;
  isOvertime: boolean;
};

type ShotAction = {
  team: "home" | "away";
  period: number;
  delta: 1 | -1;
};

interface ShotsByPeriod {
  1: number;
  2: number;
  3: number;
  OT: number;
}

type ShotLogEntry = {
  id: string;
  shootingTeamId: string;
  shootingTeamName: string;
  goalieTeamId: string;
  goalieTeamName: string;
  goalieId?: string | null;
  goalieName: string;
  period: number;
  delta: 1 | -1;
  createdAtIso: string;
};

type GoalieModalState = {
  visible: boolean;
  teamId: string;
  teamName: string;
  side: "home" | "away";
  selectedGoalieId: string;
};

type EventActionModalState = {
  visible: boolean;
  event: GameFeedEvent;
};

type EventDeleteConfirmModalState = {
  visible: boolean;
  event: GameFeedEvent;
};

type EventEditModalState = {
  visible: boolean;
  event: GameFeedEvent;
  teamId: string;
  period: number;
  timeInPeriod: string;
  playerId: string;
  assist1Id: string;
  assist2Id: string;
  infraction: string;
  durationMinutes: number;
  penaltyType: PenaltyType;
  strength: GoalStrength;
  goalieOldName: string;
  goalieNewName: string;
  goalieChangeKind: "change" | "pulled" | "returned";
};

type ThemedDropdownOption = {
  value: string;
  label: string;
};

type ThemedDropdownState = {
  title: string;
  options: ThemedDropdownOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
};

type ScoreboardGatewaySettings = {
  enabled: boolean;
  host: string;
  port: string;
  tokenSecret: string;
};

type GameFeedEvent = {
  localId: string;
  gameId: string;
  eventType: "Goal" | "Penalty" | "Goalie" | "Timeout" | "Shot";
  teamId: string;
  teamName: string;
  playerId?: string;
  playerName?: string;
  assist1Id?: string;
  assist1Name?: string;
  assist2Id?: string;
  assist2Name?: string;
  infraction?: string;
  durationMinutes?: number;
  penaltyType?: PenaltyType;
  suspensionBehavior?: PenaltySuspensionBehavior;
  requiresRefereeNotes?: boolean;
  reviewRequired?: boolean;
  goalieOldName?: string;
  goalieNewName?: string;
  goalieChangeKind?: "change" | "pulled" | "returned";
  timeoutDurationSeconds?: number;
  coincidental?: boolean;
  period: number;
  timeInPeriod: string;
  strength: GoalStrength;
  createdAtIso: string;
};

type ActivePenalty = {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  infraction: string;
  remainingSeconds: number;
  durationMinutes: number;
  penaltyType: PenaltyType;
  affectsManpower: boolean;
  isCoincidentalMinor?: boolean;
  suspensionBehavior: PenaltySuspensionBehavior;
  requiresRefereeNotes: boolean;
  reviewRequired: boolean;
  startedAtIso: string;
  period: number;
  timeInPeriod: string;
};

type PlayerStatLine = {
  goals: number;
  assists: number;
  shots: number;
  penaltyMinutes: number;
};

type SessionState = {
  userId: string;
  role: AccessRole;
  code: string;
  season: string;
  league: string;
  level: string;
  conference: string;
  section: string;
  gameDate: string;
  gameTime: string;
  venue: string;
  rink: string;
  gameType: string;
  periodLength: string;
  homeTeam: string;
  awayTeam: string;
  period: number;
  clock: string;
  homeScore: number;
  awayScore: number;
  apiBase: string;
};

type ActiveGameSnapshot = {
  userId: string;
  accessCode: string;
  stage: "gameDashboard";
  session: SessionState;
  nextGame: NextGame | null;
  activeRosterTeam: "home" | "away";
  rostersByTeam: Record<string, RosterPlayer[]>;
  coachesByTeam: Record<string, TeamCoach[]>;
  startersByTeam: Record<string, string[]>;
  headCoachSignatures: Record<string, string>;
  officials: OfficialVerification[];
  homeShotsByPeriod: ShotsByPeriod;
  awayShotsByPeriod: ShotsByPeriod;
  shotHistory: ShotLogEntry[];
  eventFeed: GameFeedEvent[];
  playerStatsById: Record<string, PlayerStatLine>;
  teamPenaltyCountById: Record<string, number>;
  activePenalties: ActivePenalty[];
  homeGoaliePulled: boolean;
  awayGoaliePulled: boolean;
  penaltyShotActive: boolean;
  gameStartedAtIso?: string | null;
  timestampIso: string;
};

type ActiveGameResume = {
  stage: "gameDashboard";
  session: SessionState;
  nextGame: NextGame | null;
  gameStartedAtIso?: string | null;
  timestampIso: string;
};

const DEFAULT_PUBLIC_API_BASE = "https://api-dev.tipinscoring.com/api";

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const GOAL_OFFLINE_QUEUE_KEY = "TipIn.goalOfflineQueue";
const SHOT_OFFLINE_QUEUE_KEY = "TipIn.shotOfflineQueue";
const PENALTY_OFFLINE_QUEUE_KEY = "TipIn.penaltyOfflineQueue";
const GOALIE_OFFLINE_QUEUE_KEY = "TipIn.goalieOfflineQueue";
const FINALIZE_OFFLINE_QUEUE_KEY = "TipIn.finalizeOfflineQueue";
const ACTIVE_GAME_SNAPSHOT_KEY = "TipIn.activeGameSnapshot";
const ACTIVE_GAME_RESUME_KEY = "TipIn.activeGameResume";
const ACTIVE_GAME_MARKER_KEY = "TipIn.activeGameMarker";
const SCOREBOARD_GATEWAY_SETTINGS_KEY = "TipIn.scoreboardGatewaySettings";
const DEFAULT_SCOREBOARD_GATEWAY_HOST = "192.168.68.66";
const LEGACY_SCOREBOARD_GATEWAY_HOST = "192.168.68.69";
const DEFAULT_SCOREBOARD_GATEWAY_PORT = "80";
const VERBOSE_TRACE = false;
const STORAGE_FALLBACK_DIR = new FileSystem.Directory(
  FileSystem.Paths.document,
  "TipIn-storage",
);

function storageFallbackFileForKey(key: string) {
  return new FileSystem.File(
    STORAGE_FALLBACK_DIR,
    `${encodeURIComponent(key)}.json`,
  );
}

function isStorageModuleUnavailable(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /native module is null|legacy storage/i.test(message);
}

async function ensureStorageFallbackDir() {
  try {
    if (!STORAGE_FALLBACK_DIR.exists) {
      STORAGE_FALLBACK_DIR.create({ intermediates: true, idempotent: true });
    }
    return true;
  } catch {
    return false;
  }
}

async function storageGetItem(key: string) {
  try {
    return await AsyncStorage.getItem(key);
  } catch (err) {
    if (!isStorageModuleUnavailable(err)) {
      throw err;
    }

    const dirReady = await ensureStorageFallbackDir();
    if (!dirReady) return null;

    try {
      const file = storageFallbackFileForKey(key);
      if (!file.exists) return null;
      return await file.text();
    } catch {
      return null;
    }
  }
}

async function storageSetItem(key: string, value: string) {
  try {
    await AsyncStorage.setItem(key, value);
    return;
  } catch (err) {
    if (!isStorageModuleUnavailable(err)) {
      throw err;
    }
  }

  const dirReady = await ensureStorageFallbackDir();
  if (!dirReady) return;
  const file = storageFallbackFileForKey(key);
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(value);
}

async function storageRemoveItem(key: string) {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    if (!isStorageModuleUnavailable(err)) {
      throw err;
    }
  }

  const dirReady = await ensureStorageFallbackDir();
  if (!dirReady) return;

  try {
    const file = storageFallbackFileForKey(key);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ignore cleanup failures.
  }
}

const QUICK_PICK_INFRACTIONS = [
  "Tripping",
  "Hooking",
  "Slashing",
  "Roughing",
  "Holding",
  "Interference",
  "Cross-Checking",
  "High-Sticking",
  "Body Checking",
  "Checking from Behind",
] as const;

const ALL_HOCKEY_INFRACTIONS = [
  ...QUICK_PICK_INFRACTIONS,
  "Boarding",
  "Charging",
  "Delay of Game",
  "Elbowing",
  "Fighting",
  "Head Contact",
  "Instigator",
  "Kneeing",
  "Misconduct",
  "Too Many Players",
  "Unsportsmanlike Conduct",
  "Abuse of Officials",
  "Attempt to Injure",
  "Butt-Ending",
  "Clearing the Bench",
  "Deliberate Injury",
  "Goalie Interference",
  "Illegal Equipment",
  "Leaving the Bench",
  "Spearing",
  "Throwing the Stick",
  "Holding the Stick",
  "Playing with a Broken Stick",
  "Faceoff Violation",
  "Illegal Hand Pass",
  "Participating in Play While Off the Ice",
  "Failure to Wear Required Equipment",
  "Wearing Non-Certified Equipment",
  "Obscene Gestures",
  "Profanity",
  "Taunting",
  "Verbal Abuse",
  "Continuing an Altercation",
  "Interference by Spectators",
];

const ALL_HOCKEY_INFRACTIONS_SORTED = [...new Set(ALL_HOCKEY_INFRACTIONS)].sort(
  (a, b) => a.localeCompare(b),
);

const PENALTY_TYPE_OPTIONS: Array<{ value: PenaltyType; label: string }> = [
  { value: "Minor", label: "Minor" },
  { value: "Double Minor", label: "Double Minor" },
  { value: "Major", label: "Major" },
  { value: "Misconduct", label: "Misconduct" },
  { value: "Game Misconduct", label: "Game Misconduct" },
  { value: "Match", label: "Match" },
  { value: "Disqualification", label: "Disqualification (DQ)" },
  { value: "Bench Minor", label: "Bench Minor" },
  { value: "Penalty Shot", label: "Penalty Shot" },
];

const PENALTY_RULES: Record<PenaltyType, PenaltyRule> = {
  Minor: {
    durationMinutes: 2,
    affectsManpower: true,
    suspensionBehavior: "none",
    requiresRefereeNotes: false,
    reviewRequired: false,
    goalExpiration: "expire",
  },
  "Double Minor": {
    durationMinutes: 4,
    affectsManpower: true,
    suspensionBehavior: "none",
    requiresRefereeNotes: false,
    reviewRequired: false,
    goalExpiration: "reduce_minor",
  },
  Major: {
    durationMinutes: 5,
    affectsManpower: true,
    suspensionBehavior: "possible",
    requiresRefereeNotes: true,
    reviewRequired: true,
    goalExpiration: "none",
  },
  Misconduct: {
    durationMinutes: 10,
    affectsManpower: false,
    suspensionBehavior: "none",
    requiresRefereeNotes: false,
    reviewRequired: false,
    goalExpiration: "none",
  },
  "Game Misconduct": {
    durationMinutes: 0,
    affectsManpower: false,
    suspensionBehavior: "automatic",
    requiresRefereeNotes: false,
    reviewRequired: false,
    goalExpiration: "none",
  },
  Match: {
    durationMinutes: 5,
    affectsManpower: true,
    suspensionBehavior: "automatic_review",
    requiresRefereeNotes: true,
    reviewRequired: true,
    goalExpiration: "none",
  },
  Disqualification: {
    durationMinutes: 0,
    affectsManpower: false,
    suspensionBehavior: "automatic_review",
    requiresRefereeNotes: true,
    reviewRequired: true,
    goalExpiration: "none",
  },
  "Bench Minor": {
    durationMinutes: 2,
    affectsManpower: true,
    suspensionBehavior: "none",
    requiresRefereeNotes: false,
    reviewRequired: false,
    goalExpiration: "expire",
  },
  "Penalty Shot": {
    durationMinutes: 0,
    affectsManpower: false,
    suspensionBehavior: "none",
    requiresRefereeNotes: false,
    reviewRequired: false,
    goalExpiration: "none",
  },
};

const INFRACTION_RULES: Record<string, PenaltyType[]> = {
  boarding: ["Minor", "Major"],
  charging: ["Minor", "Major"],
  roughing: ["Minor", "Disqualification"],
  slashing: ["Minor", "Major"],
  crosschecking: ["Minor", "Major"],
  highsticking: ["Minor", "Double Minor", "Major"],
  kneeing: ["Minor", "Major"],
  tripping: ["Minor"],
  hooking: ["Minor"],
  holding: ["Minor"],
  interference: ["Minor"],
  goalieinterference: ["Minor"],
  delayofgame: ["Minor"],
  illegalequipment: ["Minor"],
  bodychecking: ["Minor", "Major"],
  headcontact: ["Minor", "Major", "Game Misconduct"],
  spearing: ["Major", "Match"],
  buttending: ["Major", "Match"],
  attempttoinjure: ["Match"],
  deliberateinjury: ["Match"],
  fighting: ["Major", "Game Misconduct"],
  unsportsmanlikeconduct: ["Minor", "Misconduct"],
  abuseofofficials: ["Disqualification"],
  taunting: ["Minor", "Misconduct"],
  toomanyplayers: ["Bench Minor"],
  leavingthebench: ["Match"],
  misconduct: ["Misconduct"],
  penaltyshot: ["Penalty Shot"],
};

const ROLE_LABELS: Record<AccessRole, string> = {
  GM: "Game Manager",
  SM: "Stat Manager",
  CA: "Coach (View Only)",
  AD: "Admin",
};

const TipIn_LOGO = require("./assets/TipIn NoBG.png");

function toOfficialRoleLabel(role: string) {
  const roleMap: Record<string, string> = {
    Referee1: "Referee 1",
    Referee2: "Referee 2",
    Linesman1: "Linesman 1",
    Linesman2: "Linesman 2",
  };

  return roleMap[role] ?? role;
}

function normalizeOfficialAssignmentRole(role: string): string {
  const compact = role.replace(/\s+/g, "");
  return OFFICIAL_ASSIGNMENT_ROLES.includes(
    compact as (typeof OFFICIAL_ASSIGNMENT_ROLES)[number],
  )
    ? compact
    : role.trim();
}

function buildMobileSignatureToken(role: string, officialName: string) {
  const stamp = new Date().toISOString();
  return `mobile-tap-sign:${stamp}:${role}:${officialName || "unassigned"}`;
}

function parseRoleFromAccessCode(code: string): AccessRole | null {
  const normalized = code.trim().toUpperCase();
  return /^GM-[A-Z0-9]{6}$/.test(normalized) ? "GM" : null;
}

function formatAccessCodeInput(value: string): string {
  const sanitized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  if (sanitized.length <= 2) {
    return sanitized;
  }
  return `${sanitized.slice(0, 2)}-${sanitized.slice(2)}`;
}

function canControlGame(role: AccessRole) {
  return role === "GM" || role === "AD";
}

function canEditVerifyGame(role: AccessRole) {
  return role === "GM" || role === "AD";
}

function isVarsityLevelName(levelName?: string | null) {
  return (levelName || "").trim().toLowerCase().includes("varsity");
}

function isGuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseClockToSeconds(mmss: string): number {
  const value = (mmss ?? "").trim();
  if (!value) return 0;

  if (value.includes(":")) {
    const [mRaw, sRaw] = value.split(":");
    const minutes = Number(mRaw ?? 0);
    const seconds = Number(sRaw ?? 0);
    return Math.max(0, Math.floor(minutes * 60 + seconds));
  }

  const tenthsSeconds = Number(value);
  if (Number.isFinite(tenthsSeconds)) {
    return Math.max(0, Math.floor(tenthsSeconds));
  }

  return 0;
}

function parseClockDisplayToMs(clockDisplay: string): number {
  const value = (clockDisplay ?? "").trim();
  if (!value) return 0;

  if (value.includes(":")) {
    const [mRaw, sRaw] = value.split(":");
    const minutes = Number(mRaw ?? 0);
    const seconds = Number(sRaw ?? 0);
    const totalSeconds =
      Number.isFinite(minutes) && Number.isFinite(seconds)
        ? minutes * 60 + seconds
        : 0;
    return Math.max(0, Math.floor(totalSeconds * 1000));
  }

  const secondsTenths = Number(value);
  if (!Number.isFinite(secondsTenths)) return 0;
  return Math.max(0, Math.floor(secondsTenths * 1000));
}

function formatSecondsToClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatScoreboardClockFromMs(remainingTimeMs: number): string {
  const clamped = Math.max(0, Math.floor(remainingTimeMs));

  if (clamped > 60_000) {
    const totalSeconds = Math.ceil(clamped / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  const seconds = Math.floor(clamped / 1000);
  const tenths = Math.floor((clamped % 1000) / 100);
  return `${String(seconds).padStart(2, "0")}.${tenths}`;
}

function clampMs(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

type HockeyGameClockOptions = {
  initialPeriodDurationMs: number;
  tickIntervalMs?: number;
  onExpire?: () => void;
};

function useHockeyGameClock(options: HockeyGameClockOptions) {
  const { initialPeriodDurationMs, tickIntervalMs = 250, onExpire } = options;
  const safeInitialDuration = Math.max(
    1000,
    Math.floor(initialPeriodDurationMs),
  );

  const [periodDurationMs, setPeriodDurationMs] = useState(safeInitialDuration);
  const [pausedRemainingMs, setPausedRemainingMs] =
    useState(safeInitialDuration);
  const [startTimestamp, setStartTimestamp] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const remainingTimeMs = useMemo(() => {
    if (!isRunning || startTimestamp === null) {
      return clampMs(pausedRemainingMs, 0, periodDurationMs);
    }

    const elapsed = now - startTimestamp;
    return Math.max(0, periodDurationMs - elapsed);
  }, [isRunning, startTimestamp, pausedRemainingMs, periodDurationMs, now]);

  useEffect(() => {
    if (!isRunning) return;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, tickIntervalMs);

    return () => clearInterval(timer);
  }, [isRunning, tickIntervalMs]);

  useEffect(() => {
    if (!isRunning || remainingTimeMs > 0) return;

    setIsRunning(false);
    setStartTimestamp(null);
    setPausedRemainingMs(0);
    onExpire?.();
  }, [isRunning, remainingTimeMs, onExpire]);

  function setDuration(nextDurationMs: number) {
    const safeDuration = Math.max(1000, Math.floor(nextDurationMs));
    const nowTs = Date.now();

    const currentRemaining =
      isRunning && startTimestamp !== null
        ? Math.max(0, periodDurationMs - (nowTs - startTimestamp))
        : pausedRemainingMs;

    const clampedRemaining = clampMs(currentRemaining, 0, safeDuration);

    setPeriodDurationMs(safeDuration);
    setPausedRemainingMs(clampedRemaining);

    if (isRunning) {
      setStartTimestamp(nowTs - (safeDuration - clampedRemaining));
      setNow(nowTs);
    }
  }

  function syncPausedRemaining(
    nextRemainingMs: number,
    nextDurationMs?: number,
  ) {
    const safeDuration =
      nextDurationMs == null
        ? periodDurationMs
        : Math.max(1000, Math.floor(nextDurationMs));
    const clamped = clampMs(nextRemainingMs, 0, safeDuration);

    if (nextDurationMs != null) {
      setPeriodDurationMs(safeDuration);
    }

    setPausedRemainingMs(clamped);

    if (isRunning) {
      const nowTs = Date.now();
      setStartTimestamp(nowTs - (safeDuration - clamped));
      setNow(nowTs);
    }
  }

  function pause() {
    if (!isRunning) return;

    const nowTs = Date.now();
    const remaining =
      startTimestamp === null
        ? pausedRemainingMs
        : Math.max(0, periodDurationMs - (nowTs - startTimestamp));

    setPausedRemainingMs(clampMs(remaining, 0, periodDurationMs));
    setStartTimestamp(null);
    setIsRunning(false);
    setNow(nowTs);
  }

  function resume() {
    if (isRunning) return;

    const safeRemaining = clampMs(pausedRemainingMs, 0, periodDurationMs);
    const nowTs = Date.now();

    // Resume by reconstructing elapsed time from the remaining value.
    setStartTimestamp(nowTs - (periodDurationMs - safeRemaining));
    setNow(nowTs);
    setIsRunning(true);
  }

  function stop() {
    setIsRunning(false);
    setStartTimestamp(null);
  }

  function start(nextPeriodDurationMs: number, nextRemainingMs?: number) {
    const safeDuration = Math.max(1000, Math.floor(nextPeriodDurationMs));
    const safeRemaining = clampMs(
      nextRemainingMs == null ? safeDuration : nextRemainingMs,
      0,
      safeDuration,
    );
    const nowTs = Date.now();

    setPeriodDurationMs(safeDuration);
    setPausedRemainingMs(safeRemaining);
    setStartTimestamp(nowTs - (safeDuration - safeRemaining));
    setNow(nowTs);
    setIsRunning(true);
  }

  return {
    isRunning,
    periodDurationMs,
    pausedRemainingMs,
    remainingTimeMs,
    displayTime: formatScoreboardClockFromMs(remainingTimeMs),
    setDuration,
    syncPausedRemaining,
    pause,
    resume,
    stop,
    start,
  };
}

function getPeriodLengthMinutes(periodLengthLabel: string): number {
  const parsed = Number.parseInt(periodLengthLabel, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 17;
}

export function computeElapsedTime(
  periodLengthMinutes: number,
  clockRemaining: string,
): string {
  const periodSeconds = Math.max(0, periodLengthMinutes) * 60;
  const remainingSeconds = parseClockToSeconds(clockRemaining);
  const elapsedSeconds = Math.max(0, periodSeconds - remainingSeconds);
  return formatSecondsToClock(elapsedSeconds);
}

function formatEventTimeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

function extractUserIdFromAccessCode(code: string) {
  const normalized = code.trim();
  const parts = normalized.split("-");
  const candidate = parts[parts.length - 1] ?? normalized;
  return isGuid(candidate) ? candidate : normalized;
}

function getTeamId(team: TeamAssignment): string | null {
  return team.teamId ?? team.id ?? team.TeamId ?? team.Id ?? null;
}

function parseDateCandidate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatStartTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function shouldRefreshFarFutureNextGame(nextGame: NextGame | null | undefined) {
  if (!nextGame?.startTime) return false;

  const start = new Date(nextGame.startTime);
  if (Number.isNaN(start.getTime())) return true;

  const daysAhead = (start.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysAhead > 30;
}

function getGameLoginUnavailableMessage(game: NextGame, teamId: string) {
  const normalizedStatus = (game.status || "SCHEDULED").trim().toUpperCase();
  if (["COMPLETED", "CLOSED", "FINAL"].includes(normalizedStatus)) {
    return "This game has been finalized and can no longer be managed.";
  }

  if (!game.homeTeamId || game.homeTeamId !== teamId) {
    return "This access code is not authorized for the game's home team.";
  }

  if (["IN PROGRESS", "IN_PROGRESS", "ACTIVE"].includes(normalizedStatus)) {
    return null;
  }

  const startTime = new Date(game.startTime).getTime();
  if (!Number.isFinite(startTime)) return "The scheduled game time is invalid.";

  const hoursUntilStart = (startTime - Date.now()) / (60 * 60 * 1000);
  if (hoursUntilStart > 48) {
    return "Access code is valid, but no home game is scheduled within the next 48 hours.";
  }
  if (hoursUntilStart > 4) {
    return `Login opens four hours before the scheduled game time (${formatStartTime(game.startTime)}).`;
  }
  if (hoursUntilStart < -6) {
    return "The login window for this game has closed.";
  }

  return null;
}

function formatPlayerPickerLabel(player: RosterPlayer) {
  const jersey = player.jerseyNumber ?? "-";
  const position = player.isGoalie ? "G" : player.position?.trim() || "-";
  return `#${jersey} - ${player.fullName} (${position})`;
}

function normalizePenaltyType(value?: string | null): PenaltyType {
  switch ((value ?? "").trim().toLowerCase()) {
    case "minor":
      return "Minor";
    case "double minor":
      return "Double Minor";
    case "major":
      return "Major";
    case "misconduct":
      return "Misconduct";
    case "game misconduct":
      return "Game Misconduct";
    case "match":
      return "Match";
    case "disqualification":
    case "ejection dq":
    case "ejection":
    case "game dq":
    case "dq":
      return "Disqualification";
    case "bench minor":
      return "Bench Minor";
    case "penalty shot":
      return "Penalty Shot";
    default:
      return "Minor";
  }
}

function getPenaltyRule(penaltyType: string): PenaltyRule {
  return (
    PENALTY_RULES[normalizePenaltyType(penaltyType)] ?? PENALTY_RULES.Minor
  );
}

function getAllowedPenaltyTypesForInfraction(
  infraction: string,
): PenaltyType[] {
  const key = infraction
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return INFRACTION_RULES[key] ?? ["Minor"];
}

function resolvePenaltyTypeForInfraction(
  infraction: string,
  preferredType?: string | null,
): PenaltyType {
  const allowed = getAllowedPenaltyTypesForInfraction(infraction);
  const normalizedPreferred = normalizePenaltyType(preferredType);
  return allowed.includes(normalizedPreferred)
    ? normalizedPreferred
    : (allowed[0] ?? "Minor");
}

function getPenaltyTypeLabel(penaltyType: string) {
  return (
    PENALTY_TYPE_OPTIONS.find(
      (option) => option.value === normalizePenaltyType(penaltyType),
    )?.label ?? normalizePenaltyType(penaltyType)
  );
}

function getSuspensionReviewLabel(penaltyType: string) {
  const rule = getPenaltyRule(penaltyType);
  if (rule.suspensionBehavior === "possible") return "Possible suspension";
  if (rule.suspensionBehavior === "automatic") return "Automatic suspension";
  if (rule.suspensionBehavior === "automatic_review") {
    return "Automatic suspension + review";
  }
  return "No suspension";
}

function sortRosterPlayersForPicker(players: RosterPlayer[]) {
  return [...players].sort((a, b) => {
    const jerseyA = a.jerseyNumber ?? Number.MAX_SAFE_INTEGER;
    const jerseyB = b.jerseyNumber ?? Number.MAX_SAFE_INTEGER;
    if (jerseyA !== jerseyB) return jerseyA - jerseyB;
    return a.fullName.localeCompare(b.fullName, undefined, {
      sensitivity: "base",
    });
  });
}

function transitionShotTotals(
  homeShotsByPeriod: ShotsByPeriod,
  awayShotsByPeriod: ShotsByPeriod,
  action: ShotAction,
) {
  const periodKey: keyof ShotsByPeriod =
    action.period >= 4
      ? "OT"
      : (Math.max(1, Math.min(3, action.period)) as 1 | 2 | 3);

  const applyDelta = (rows: ShotsByPeriod): ShotsByPeriod => ({
    ...rows,
    [periodKey]: Math.max(0, rows[periodKey] + action.delta),
  });

  if (action.team === "home") {
    return {
      home: applyDelta(homeShotsByPeriod),
      away: awayShotsByPeriod,
    };
  }

  return {
    home: homeShotsByPeriod,
    away: applyDelta(awayShotsByPeriod),
  };
}

function getPeriodLabel(period: number, isOvertime: boolean) {
  if (isOvertime || period >= 4) {
    const overtimeNumber = Math.max(1, period - 3);
    return `OT${overtimeNumber}`;
  }
  if (period === 1) return "1st";
  if (period === 2) return "2nd";
  if (period === 3) return "3rd";
  return `${period}th`;
}

function normalizeGoalieName(name?: string | null) {
  const normalized = (name ?? "").trim();
  if (!normalized) return null;
  if (/^none$/i.test(normalized)) return null;
  if (/^empty net$/i.test(normalized)) return null;
  return normalized;
}

function getAbsoluteElapsedSeconds(
  periodLengthSeconds: number,
  period: number,
  timeInPeriod: string,
) {
  const safePeriodLength = Math.max(1, periodLengthSeconds);
  const safePeriod = Math.max(1, period);
  const elapsedInPeriod = Math.max(
    0,
    Math.min(safePeriodLength, parseClockToSeconds(timeInPeriod)),
  );
  return (safePeriod - 1) * safePeriodLength + elapsedInPeriod;
}

function formatElapsedGameMoment(
  periodLengthSeconds: number,
  elapsedSeconds: number,
) {
  const safePeriodLength = Math.max(1, periodLengthSeconds);
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const period = Math.floor(safeElapsed / safePeriodLength) + 1;
  const withinPeriod = safeElapsed % safePeriodLength;
  const periodLabel = period >= 4 ? "OT" : `Period ${period}`;
  return `${periodLabel} ${formatSecondsToClock(withinPeriod)}`;
}

function formatWallClockFromElapsed(
  gameStartedAtIso: string | null,
  elapsedSeconds: number,
) {
  if (!gameStartedAtIso) return null;
  const startedAt = new Date(gameStartedAtIso);
  if (Number.isNaN(startedAt.getTime())) return null;

  const at = new Date(startedAt.getTime() + Math.max(0, elapsedSeconds) * 1000);
  return at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeShotsByPeriod(value: unknown): ShotsByPeriod {
  if (Array.isArray(value)) {
    return {
      1: Number(value[0] ?? 0),
      2: Number(value[1] ?? 0),
      3: Number(value[2] ?? 0),
      OT: Number(value[3] ?? 0),
    };
  }

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return {
      1: Number(row["1"] ?? row.period1 ?? 0),
      2: Number(row["2"] ?? row.period2 ?? 0),
      3: Number(row["3"] ?? row.period3 ?? 0),
      OT: Number(row.OT ?? row.ot ?? 0),
    };
  }

  return { 1: 0, 2: 0, 3: 0, OT: 0 };
}

function getOpponentName(game: Record<string, unknown>) {
  const candidates = [
    game.opponentName,
    game.OpponentName,
    game.awayTeamName,
    game.AwayTeamName,
    game.homeTeamName,
    game.HomeTeamName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return "TBD";
}

function normalizeNextGame(
  teamId: string,
  game: Record<string, unknown>,
): NextGame | null {
  const startDate =
    parseDateCandidate(game.startTime) ??
    parseDateCandidate(game.StartTime) ??
    parseDateCandidate(game.gameDateTime) ??
    parseDateCandidate(game.GameDateTime) ??
    parseDateCandidate(game.scheduledStart) ??
    parseDateCandidate(game.ScheduledStart);

  if (!startDate) return null;

  const rinkName =
    (typeof game.rinkName === "string" && game.rinkName) ||
    (typeof game.RinkName === "string" && game.RinkName) ||
    (typeof game.arenaName === "string" && game.arenaName) ||
    (typeof game.ArenaName === "string" && game.ArenaName) ||
    "TBD";

  return {
    teamId,
    gameId:
      (typeof game.gameId === "string" && game.gameId) ||
      (typeof game.GameId === "string" && game.GameId) ||
      undefined,
    homeTeamId:
      (typeof game.homeTeamId === "string" && game.homeTeamId) ||
      (typeof game.HomeTeamId === "string" && game.HomeTeamId) ||
      undefined,
    awayTeamId:
      (typeof game.awayTeamId === "string" && game.awayTeamId) ||
      (typeof game.AwayTeamId === "string" && game.AwayTeamId) ||
      undefined,
    opponentName: getOpponentName(game),
    startTime: startDate.toISOString(),
    homeTeamName:
      (typeof game.homeTeamName === "string" && game.homeTeamName) ||
      (typeof game.HomeTeamName === "string" && game.HomeTeamName) ||
      undefined,
    homeTeamMascot:
      (typeof game.homeTeamMascot === "string" && game.homeTeamMascot) ||
      (typeof game.HomeTeamMascot === "string" && game.HomeTeamMascot) ||
      undefined,
    awayTeamName:
      (typeof game.awayTeamName === "string" && game.awayTeamName) ||
      (typeof game.AwayTeamName === "string" && game.AwayTeamName) ||
      undefined,
    awayTeamMascot:
      (typeof game.awayTeamMascot === "string" && game.awayTeamMascot) ||
      (typeof game.AwayTeamMascot === "string" && game.AwayTeamMascot) ||
      undefined,
    arenaId:
      (typeof game.arenaId === "string" && game.arenaId) ||
      (typeof game.ArenaId === "string" && game.ArenaId) ||
      undefined,
    rinkId:
      (typeof game.rinkId === "string" && game.rinkId) ||
      (typeof game.RinkId === "string" && game.RinkId) ||
      undefined,
    arenaName:
      (typeof game.arenaName === "string" && game.arenaName) ||
      (typeof game.ArenaName === "string" && game.ArenaName) ||
      undefined,
    rinkName,
    gatewayAvailable:
      typeof game.gatewayAvailable === "boolean"
        ? game.gatewayAvailable
        : typeof game.GatewayAvailable === "boolean"
          ? game.GatewayAvailable
          : false,
    gameTypeName:
      (typeof game.gameTypeName === "string" && game.gameTypeName) ||
      (typeof game.GameTypeName === "string" && game.GameTypeName) ||
      undefined,
    periodLengthMinutes:
      (typeof game.periodLengthMinutes === "number" &&
        game.periodLengthMinutes) ||
      (typeof game.PeriodLengthMinutes === "number" &&
        game.PeriodLengthMinutes) ||
      undefined,
    levelName:
      (typeof game.levelName === "string" && game.levelName) ||
      (typeof game.LevelName === "string" && game.LevelName) ||
      undefined,
    teamType:
      (typeof game.teamType === "string" && game.teamType) ||
      (typeof game.TeamType === "string" && game.TeamType) ||
      undefined,
    sectionRegion:
      (typeof game.sectionRegionName === "string" && game.sectionRegionName) ||
      (typeof game.SectionRegionName === "string" && game.SectionRegionName) ||
      undefined,
    conferenceDistrict:
      (typeof game.conferenceDistrictName === "string" &&
        game.conferenceDistrictName) ||
      (typeof game.ConferenceDistrictName === "string" &&
        game.ConferenceDistrictName) ||
      undefined,
    status:
      (typeof game.status === "string" && game.status) ||
      (typeof game.Status === "string" && game.Status) ||
      undefined,
  };
}

function buildTeamDisplayName(name?: string, mascot?: string) {
  const safeName = (name || "").trim();
  const safeMascot = (mascot || "").trim();
  if (!safeName) return safeMascot || "Team";
  return safeMascot ? `${safeName} ${safeMascot}` : safeName;
}

function getStarterPositionGroup(player: RosterPlayer) {
  if (player.isGoalie || /^g(oalie)?$/i.test(player.position.trim())) {
    return "Goalies";
  }
  if (
    /^(d|ld|rd|def|defense|defenc|defenseman|defenceman)$/i.test(
      player.position.trim(),
    )
  ) {
    return "Defensemen";
  }
  return "Forwards";
}

function formatVenue(arenaName?: string, rinkName?: string) {
  const arena = (arenaName || "").trim();
  const rink = (rinkName || "").trim();
  if (arena && rink) return `${arena} - ${rink}`;
  if (arena) return arena;
  if (rink) return rink;
  return "Venue TBD";
}

function summarizePayload(payload: unknown): DebugPayload {
  if (Array.isArray(payload)) {
    return {
      kind: "array",
      length: payload.length,
      first: payload[0] ?? null,
    };
  }

  if (payload && typeof payload === "object") {
    return payload as DebugPayload;
  }

  return { value: payload ?? null };
}

export default function App() {
  const [stage, setStage] = useState<Stage>("login");
  const [restoreStatus, setRestoreStatus] = useState("idle");
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState<SessionState | null>(null);
  const [gameHasEnded, setGameHasEnded] = useState(false);
  const [nextGame, setNextGame] = useState<NextGame | null>(null);
  const [isNextGameLoading, setIsNextGameLoading] = useState(false);
  const [isRefreshingNextGame, setIsRefreshingNextGame] = useState(false);
  const [nextGameMessage, setNextGameMessage] = useState(
    "No Scheduled Games Found",
  );
  const [isClosedGameNotice, setIsClosedGameNotice] = useState(false);
  const [debugTrace, setDebugTrace] = useState<string[]>([]);

  const [activeRosterTeam, setActiveRosterTeam] = useState<"home" | "away">(
    "home",
  );
  const [isRosterLoading, setIsRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rostersByTeam, setRostersByTeam] = useState<
    Record<string, RosterPlayer[]>
  >({});
  const [coachesByTeam, setCoachesByTeam] = useState<
    Record<string, TeamCoach[]>
  >({});
  const [startersByTeam, setStartersByTeam] = useState<
    Record<string, string[]>
  >({});
  const [headCoachSignatures, setHeadCoachSignatures] = useState<
    Record<string, string>
  >({});
  const [signatureContext, setSignatureContext] =
    useState<SignatureContext | null>(null);
  const [signatureNameInput, setSignatureNameInput] = useState("");
  const [homeShotsByPeriod, setHomeShotsByPeriod] = useState<ShotsByPeriod>({
    1: 0,
    2: 0,
    3: 0,
    OT: 0,
  });
  const [awayShotsByPeriod, setAwayShotsByPeriod] = useState<ShotsByPeriod>({
    1: 0,
    2: 0,
    3: 0,
    OT: 0,
  });
  const [shotHistory, setShotHistory] = useState<ShotLogEntry[]>([]);
  const [officials, setOfficials] = useState<OfficialVerification[]>([]);
  const [officialOptions, setOfficialOptions] = useState<OfficialOption[]>([]);
  const [showAddOfficialModal, setShowAddOfficialModal] = useState(false);
  const [addOfficialForm, setAddOfficialForm] = useState<AddOfficialForm>({
    firstName: "",
    lastName: "",
    email: "",
    isReferee: true,
    isLinesman: false,
    isActive: true,
    assignmentRole: "",
  });
  const [isSavingOfficial, setIsSavingOfficial] = useState(false);
  const [isOfficialsLoading, setIsOfficialsLoading] = useState(false);
  const [officialsError, setOfficialsError] = useState("");
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [isClockRunning, setIsClockRunning] = useState(false);
  const [goalModal, setGoalModal] = useState<GoalModalState | null>(null);
  const [resumeClockAfterGoalModal, setResumeClockAfterGoalModal] =
    useState(false);
  const [goalModalError, setGoalModalError] = useState("");
  const [eventFeed, setEventFeed] = useState<GameFeedEvent[]>([]);
  const [eventTypeFilters, setEventTypeFilters] = useState({
    Shot: true,
    Goal: true,
    Penalty: true,
  });
  const [playerStatsById, setPlayerStatsById] = useState<
    Record<string, PlayerStatLine>
  >({});
  const [teamPenaltyCountById, setTeamPenaltyCountById] = useState<
    Record<string, number>
  >({});
  const [activePenalties, setActivePenalties] = useState<ActivePenalty[]>([]);
  const [penaltyModal, setPenaltyModal] = useState<PenaltyModalState | null>(
    null,
  );
  const [resumeClockAfterPenaltyModal, setResumeClockAfterPenaltyModal] =
    useState(false);
  const [penaltyModalError, setPenaltyModalError] = useState("");
  const [showClockModal, setShowClockModal] = useState(false);
  const [clockModalMinutes, setClockModalMinutes] = useState(0);
  const [clockModalSeconds, setClockModalSeconds] = useState(0);
  const [timeoutModal, setTimeoutModal] = useState<TimeoutModalState | null>(
    null,
  );
  const [penaltyAdjustModal, setPenaltyAdjustModal] =
    useState<PenaltyAdjustModalState | null>(null);
  const [periodController, setPeriodController] = useState<PeriodController>({
    state: "NOT_STARTED",
    isOvertime: false,
  });
  const [intermissionSeconds, setIntermissionSeconds] = useState(0);
  const [showPeriodOverVerify, setShowPeriodOverVerify] = useState(false);
  const [showResumeVerify, setShowResumeVerify] = useState(false);
  const [showEndOfRegulation, setShowEndOfRegulation] = useState(false);
  const [goalieModal, setGoalieModal] = useState<GoalieModalState | null>(null);
  const [currentGoalieByTeam, setCurrentGoalieByTeam] = useState<
    Record<string, string | null>
  >({});
  const [eventActionModal, setEventActionModal] =
    useState<EventActionModalState | null>(null);
  const [eventDeleteConfirmModal, setEventDeleteConfirmModal] =
    useState<EventDeleteConfirmModalState | null>(null);
  const [eventEditModal, setEventEditModal] =
    useState<EventEditModalState | null>(null);
  const [eventEditModalError, setEventEditModalError] = useState("");
  const [activeDropdown, setActiveDropdown] =
    useState<ThemedDropdownState | null>(null);
  const [showSuspensionNotesModal, setShowSuspensionNotesModal] =
    useState(false);
  const [showScoreboardSettingsModal, setShowScoreboardSettingsModal] =
    useState(false);
  const [scoreboardGatewaySettings, setScoreboardGatewaySettings] =
    useState<ScoreboardGatewaySettings>({
      enabled: false,
      host: DEFAULT_SCOREBOARD_GATEWAY_HOST,
      port: DEFAULT_SCOREBOARD_GATEWAY_PORT,
      tokenSecret: "",
    });
  const [scoreboardSettingsDraft, setScoreboardSettingsDraft] =
    useState<ScoreboardGatewaySettings>({
      enabled: false,
      host: DEFAULT_SCOREBOARD_GATEWAY_HOST,
      port: DEFAULT_SCOREBOARD_GATEWAY_PORT,
      tokenSecret: "",
    });
  const [scoreboardConnectionState, setScoreboardConnectionState] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [scoreboardConnectionMessage, setScoreboardConnectionMessage] =
    useState("Disconnected");
  const [scoreboardReconnectNonce, setScoreboardReconnectNonce] = useState(0);
  const scheduledGatewayAppliedRef = useRef(false);
  const [showScoreboardTokenSecret, setShowScoreboardTokenSecret] =
    useState(false);
  const [rosterPreviewTeam, setRosterPreviewTeam] = useState<
    "home" | "away" | null
  >(null);
  const [showOfficialsPreview, setShowOfficialsPreview] = useState(false);
  const [showStarterInformation, setShowStarterInformation] = useState(false);
  const [suspensionNotesByPenaltyId, setSuspensionNotesByPenaltyId] = useState<
    Record<string, string>
  >({});
  const [suspensionNotesError, setSuspensionNotesError] = useState("");
  const [sendRecipientSelection, setSendRecipientSelection] = useState<
    Record<string, boolean>
  >({});
  const [customEmailInput, setCustomEmailInput] = useState("");
  const [customEmails, setCustomEmails] = useState<string[]>([]);
  const [mediaOutletRecipients, setMediaOutletRecipients] = useState<
    EmailRecipientOption[]
  >([]);
  const [sendScoresheetError, setSendScoresheetError] = useState("");
  const [emailDeliveryStatus, setEmailDeliveryStatus] = useState<
    "idle" | "sent" | "failed" | "queued"
  >("idle");
  const [emailDeliveryMessage, setEmailDeliveryMessage] = useState("");
  const [isFinalizingGame, setIsFinalizingGame] = useState(false);
  const [gameStartedAtIso, setGameStartedAtIso] = useState<string | null>(null);

  const [homeGoaliePulled, setHomeGoaliePulled] = useState(false);
  const [awayGoaliePulled, setAwayGoaliePulled] = useState(false);
  const [penaltyShotActive, setPenaltyShotActive] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("up_to_date");
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const rosterScrollViewRef = useRef<ScrollView | null>(null);
  const rosterScrollOffsetRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const penaltyClockPrevRemainingMsRef = useRef<number | null>(null);
  const penaltyClockCarryMsRef = useRef(0);
  const scoreboardSocketRef = useRef<WebSocket | null>(null);
  const scoreboardReconnectTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const scoreboardReconnectAttemptRef = useRef(0);
  const scoreboardClockSyncActiveRef = useRef(false);
  const gatewayLastClockSecondsRef = useRef<number | null>(null);
  const scoreboardLastMessageAtRef = useRef<number | null>(null);
  const periodControllerStateRef =
    useRef<PeriodController["state"]>("NOT_STARTED");
  const periodExpiryHandledRef = useRef(false);
  const stageRef = useRef<Stage>(stage);
  const sessionPeriodRef = useRef(1);
  const sessionPeriodLengthRef = useRef("17");
  const gameClockControlsRef = useRef({
    setDuration: (_nextDurationMs: number) => {},
    syncPausedRemaining: (
      _nextRemainingMs: number,
      _nextDurationMs?: number,
    ) => {},
    pause: () => {},
    resume: () => {},
  });
  const liveShotSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastLiveShotSyncSignatureRef = useRef("");

  function handleClockExpired() {
    if (
      periodExpiryHandledRef.current ||
      periodControllerStateRef.current !== "IN_PROGRESS"
    ) {
      return;
    }

    periodExpiryHandledRef.current = true;
    setIsClockRunning(false);
    setShowPeriodOverVerify(true);
  }

  const gameClock = useHockeyGameClock({
    initialPeriodDurationMs: 17 * 60 * 1000,
    tickIntervalMs: 100,
    onExpire: handleClockExpired,
  });

  const activeApiBase = DEFAULT_PUBLIC_API_BASE;

  const syncStatusText = useMemo(() => {
    if (syncState === "syncing") {
      return pendingSyncCount > 0
        ? `Syncing (${pendingSyncCount} queued)`
        : "Syncing";
    }

    if (syncState === "error") {
      return pendingSyncCount > 0
        ? `Sync Error (${pendingSyncCount} queued)`
        : "Sync Error";
    }

    if (pendingSyncCount > 0 || syncState === "queued") {
      return `Sync Queued (${pendingSyncCount})`;
    }

    return "Sync Up to Date";
  }, [syncState, pendingSyncCount]);

  const syncStatusStyle = useMemo(() => {
    if (syncState === "syncing") return styles.scoreboardSyncInfo;
    if (syncState === "error") return styles.scoreboardSyncError;
    if (pendingSyncCount > 0 || syncState === "queued") {
      return styles.scoreboardSyncQueued;
    }
    return styles.scoreboardSyncOk;
  }, [syncState, pendingSyncCount]);

  const dashboardMatchupSummary = useMemo(() => {
    if (!session) return "";

    const awayTeam = buildTeamDisplayName(
      nextGame?.awayTeamName || session.awayTeam,
      nextGame?.awayTeamMascot,
    );
    const homeTeam = buildTeamDisplayName(
      nextGame?.homeTeamName || session.homeTeam,
      nextGame?.homeTeamMascot,
    );
    const type = (nextGame?.teamType || "").trim();
    const level = (nextGame?.levelName || session.level || "").trim();

    const awayWithType = type ? `${awayTeam} - ${type}` : awayTeam;
    const homeWithType = type ? `${homeTeam} - ${type}` : homeTeam;

    return level
      ? `${awayWithType} vs. ${homeWithType} | ${level}`
      : `${awayWithType} vs. ${homeWithType}`;
  }, [session, nextGame]);

  const homeTeamId = nextGame?.homeTeamId ?? "";
  const awayTeamId = nextGame?.awayTeamId ?? "";

  const activeTeamId = activeRosterTeam === "home" ? homeTeamId : awayTeamId;
  const activeTeamName =
    activeRosterTeam === "home"
      ? (session?.homeTeam ?? "Home")
      : (session?.awayTeam ?? "Away");
  const activeRoster = (activeTeamId && rostersByTeam[activeTeamId]) || [];
  const activeRosterSorted = sortRosterPlayersForPicker(activeRoster);
  const activeCoaches = (activeTeamId && coachesByTeam[activeTeamId]) || [];
  const isGoalModalOpen = Boolean(goalModal?.visible);
  const isPenaltyModalOpen = Boolean(penaltyModal?.visible);
  const isGoalieModalOpen = Boolean(goalieModal?.visible);
  const isTimeoutModalOpen = Boolean(timeoutModal?.visible);
  const isEventActionModalOpen = Boolean(eventActionModal?.visible);
  const isEventDeleteConfirmModalOpen = Boolean(
    eventDeleteConfirmModal?.visible,
  );
  const isEventEditModalOpen = Boolean(eventEditModal?.visible);
  const isPenaltyAdjustModalOpen = Boolean(penaltyAdjustModal?.visible);
  const isRunningTimeActive =
    session?.period === 3 &&
    Math.abs((session?.homeScore ?? 0) - (session?.awayScore ?? 0)) >= 5;
  const isEventEntryLockedByClock = isClockRunning && !isRunningTimeActive;
  const isRunningTimeEventModalOpen =
    isGoalModalOpen || isPenaltyModalOpen || isTimeoutModalOpen;
  const isAnyModalOpen =
    isGoalModalOpen ||
    isPenaltyModalOpen ||
    isGoalieModalOpen ||
    isTimeoutModalOpen ||
    isEventActionModalOpen ||
    isEventDeleteConfirmModalOpen ||
    isEventEditModalOpen ||
    isPenaltyAdjustModalOpen ||
    showScoreboardSettingsModal ||
    showPeriodOverVerify ||
    showResumeVerify ||
    showEndOfRegulation;
  const goalTeamRoster = goalModal
    ? getRosterForTeam(goalModal.scoringTeamId).filter(
        (player) => player.isActive,
      )
    : [];
  const goalAssistRoster = goalModal
    ? goalTeamRoster.filter((player) => player.playerId !== goalModal.scorerId)
    : [];
  const goalModalSkaterStrength = goalModal
    ? getSkaterStrengthContext(goalModal.scoringTeamId)
    : "Even Strength";
  const shouldLockEvenStrength = goalModalSkaterStrength === "Power Play";
  const eventEditTeamRoster = eventEditModal
    ? getRosterForTeam(eventEditModal.teamId).filter(
        (player) => player.isActive,
      )
    : [];
  const eventEditAssistRoster = eventEditModal
    ? eventEditTeamRoster.filter(
        (player) => player.playerId !== eventEditModal.playerId,
      )
    : [];
  const eventEditSkaterStrength =
    eventEditModal && eventEditModal.event.eventType === "Goal"
      ? getSkaterStrengthContext(eventEditModal.teamId)
      : "Even Strength";
  const shouldLockEventEditEvenStrength =
    eventEditSkaterStrength === "Power Play";
  const penaltyTeamRoster = penaltyModal
    ? getRosterForTeam(penaltyModal.penalizedTeamId).filter(
        (player) => player.isActive,
      )
    : [];

  const safeActivePenalties = Array.isArray(activePenalties)
    ? activePenalties
    : [];
  const safeEventFeed = Array.isArray(eventFeed) ? eventFeed : [];
  const safeHomeShotsByPeriod = normalizeShotsByPeriod(homeShotsByPeriod);
  const safeAwayShotsByPeriod = normalizeShotsByPeriod(awayShotsByPeriod);
  const safeShotHistory = Array.isArray(shotHistory) ? shotHistory : [];
  const safeTeamPenaltyCountById =
    teamPenaltyCountById && typeof teamPenaltyCountById === "object"
      ? teamPenaltyCountById
      : {};

  const homeActivePenalties = safeActivePenalties
    .filter(
      (penalty) =>
        penalty.teamId === homeTeamId &&
        Number.isFinite(penalty.remainingSeconds) &&
        penalty.remainingSeconds > 0,
    )
    .slice(0, 5);
  const awayActivePenalties = safeActivePenalties
    .filter(
      (penalty) =>
        penalty.teamId === awayTeamId &&
        Number.isFinite(penalty.remainingSeconds) &&
        penalty.remainingSeconds > 0,
    )
    .slice(0, 5);

  const homeManpowerPenalties = safeActivePenalties.filter(
    (penalty) =>
      penalty.teamId === homeTeamId &&
      penalty.affectsManpower &&
      penalty.remainingSeconds > 0,
  ).length;
  const awayManpowerPenalties = safeActivePenalties.filter(
    (penalty) =>
      penalty.teamId === awayTeamId &&
      penalty.affectsManpower &&
      penalty.remainingSeconds > 0,
  ).length;

  const homeSkatersOnIce = Math.max(3, 5 - homeManpowerPenalties);
  const awaySkatersOnIce = Math.max(3, 5 - awayManpowerPenalties);

  const powerPlayLabel =
    homeSkatersOnIce === awaySkatersOnIce
      ? "EVEN STRENGTH"
      : homeSkatersOnIce > awaySkatersOnIce
        ? `POWER PLAY - ${session?.homeTeam?.toUpperCase() ?? "HOME"}`
        : `POWER PLAY - ${session?.awayTeam?.toUpperCase() ?? "AWAY"}`;

  const homeOnPowerPlay = awaySkatersOnIce < homeSkatersOnIce;
  const awayOnPowerPlay = homeSkatersOnIce < awaySkatersOnIce;

  useEffect(() => {
    const gameId = nextGame?.gameId;
    if (!gameId || !session) return;
    const homeStarters = startersByTeam[homeTeamId ?? ""] ?? [];
    const awayStarters = startersByTeam[awayTeamId ?? ""] ?? [];
    void syncLiveStatus(
      gameId,
      homeOnPowerPlay,
      awayOnPowerPlay,
      homeSkatersOnIce,
      awaySkatersOnIce,
      homeStarters,
      awayStarters,
    );
  }, [
    nextGame?.gameId,
    session,
    session?.period,
    homeTeamId,
    awayTeamId,
    startersByTeam,
    homeOnPowerPlay,
    awayOnPowerPlay,
    homeSkatersOnIce,
    awaySkatersOnIce,
  ]);

  const scoreboardConnectionBadgeText = useMemo(() => {
    if (!scoreboardGatewaySettings.enabled) {
      return "Manual Clock";
    }
    if (scoreboardConnectionState === "connected") {
      return "Scoreboard Connected";
    }
    if (scoreboardConnectionState === "connecting") {
      return "Connecting...";
    }
    return "Not Connected";
  }, [scoreboardConnectionState, scoreboardGatewaySettings.enabled]);

  const scoreboardConnectionBadgeStyle = useMemo(() => {
    if (!scoreboardGatewaySettings.enabled) {
      return styles.scoreboardConnectionManual;
    }
    if (scoreboardConnectionState === "connected") {
      return styles.scoreboardConnectionConnected;
    }
    if (scoreboardConnectionState === "connecting") {
      return styles.scoreboardConnectionConnecting;
    }
    return styles.scoreboardConnectionDisconnected;
  }, [scoreboardConnectionState, scoreboardGatewaySettings.enabled]);

  const scoreboardConnectionBadgeTextStyle = useMemo(() => {
    if (!scoreboardGatewaySettings.enabled) {
      return styles.scoreboardConnectionBadgeTextManual;
    }
    if (scoreboardConnectionState === "connected") {
      return styles.scoreboardConnectionBadgeTextConnected;
    }
    if (scoreboardConnectionState === "connecting") {
      return styles.scoreboardConnectionBadgeTextConnecting;
    }
    return styles.scoreboardConnectionBadgeTextDisconnected;
  }, [scoreboardConnectionState, scoreboardGatewaySettings.enabled]);

  const isScoreboardClockSyncActive =
    stage === "gameDashboard" &&
    scoreboardGatewaySettings.enabled &&
    scoreboardConnectionState === "connected";
  const clockSourceLabel = isScoreboardClockSyncActive
    ? "Scoreboard Sync"
    : "Manual (Tablet)";

  useEffect(() => {
    scoreboardClockSyncActiveRef.current = isScoreboardClockSyncActive;
  }, [isScoreboardClockSyncActive]);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    sessionPeriodRef.current = session?.period ?? 1;
  }, [session?.period]);

  useEffect(() => {
    sessionPeriodLengthRef.current = session?.periodLength ?? "17";
  }, [session?.periodLength]);

  useEffect(() => {
    periodControllerStateRef.current = periodController.state;
  }, [periodController.state]);

  useEffect(() => {
    if (gameClock.remainingTimeMs > 0) {
      periodExpiryHandledRef.current = false;
    }
  }, [gameClock.remainingTimeMs]);

  useEffect(() => {
    gameClockControlsRef.current = {
      setDuration: gameClock.setDuration,
      syncPausedRemaining: gameClock.syncPausedRemaining,
      pause: gameClock.pause,
      resume: gameClock.resume,
    };
  }, [
    gameClock.setDuration,
    gameClock.syncPausedRemaining,
    gameClock.pause,
    gameClock.resume,
  ]);

  const activePeriodLabel = getPeriodLabel(
    session?.period ?? 1,
    periodController.isOvertime,
  );
  const periodDotFilledCount =
    periodController.isOvertime || (session?.period ?? 1) >= 4
      ? 4
      : Math.max(1, Math.min(3, session?.period ?? 1));
  const periodDotIndicator = `${periodDotFilledCount >= 1 ? "●" : "○"} ${periodDotFilledCount >= 2 ? "●" : "○"} ${periodDotFilledCount >= 3 ? "●" : "○"} ${periodDotFilledCount >= 4 ? "●" : "○"}`;

  const goalsByPeriod = useMemo(() => {
    const home: ShotsByPeriod = { 1: 0, 2: 0, 3: 0, OT: 0 };
    const away: ShotsByPeriod = { 1: 0, 2: 0, 3: 0, OT: 0 };

    for (const event of safeEventFeed) {
      if (!event || event.eventType !== "Goal") continue;
      if (!event.teamId || !Number.isFinite(Number(event.period))) continue;
      const periodKey: keyof ShotsByPeriod =
        event.period >= 4
          ? "OT"
          : (Math.max(1, Math.min(3, event.period)) as 1 | 2 | 3);

      if (event.teamId === homeTeamId) {
        home[periodKey] += 1;
      } else if (event.teamId === awayTeamId) {
        away[periodKey] += 1;
      }
    }

    return { home, away };
  }, [safeEventFeed, homeTeamId, awayTeamId]);

  const goalEvents = useMemo(
    () => safeEventFeed.filter((event) => event?.eventType === "Goal"),
    [safeEventFeed],
  );

  const penaltyEvents = useMemo(
    () => safeEventFeed.filter((event) => event?.eventType === "Penalty"),
    [safeEventFeed],
  );

  const visibleEventFeed = safeEventFeed.filter((event) => {
    if (event.eventType === "Shot") return eventTypeFilters.Shot;
    if (event.eventType === "Goal") return eventTypeFilters.Goal;
    if (event.eventType === "Penalty") return eventTypeFilters.Penalty;
    return true;
  });

  const gameDqPenaltyEvents = useMemo(
    () =>
      penaltyEvents.filter((event) => {
        const rule = getPenaltyRule(event.penaltyType ?? "Minor");
        return rule.requiresRefereeNotes || rule.reviewRequired;
      }),
    [penaltyEvents],
  );

  const dqEmailPenaltyEvents = useMemo(
    () =>
      penaltyEvents.filter(
        (event) =>
          normalizePenaltyType(event.penaltyType ?? "Minor") ===
          "Disqualification",
      ),
    [penaltyEvents],
  );

  const suspensionFlaggedPenaltyEvents = useMemo(
    () =>
      penaltyEvents.filter(
        (event) =>
          getPenaltyRule(event.penaltyType ?? "Minor").suspensionBehavior !==
          "none",
      ),
    [penaltyEvents],
  );

  const startingGoalieByTeam = useMemo(() => {
    const rows: Record<string, string | null> = {};
    const teamIds = [homeTeamId, awayTeamId].filter(Boolean);

    for (const teamId of teamIds) {
      const starters = startersByTeam[teamId] ?? [];
      const roster = rostersByTeam[teamId] ?? [];
      const starterGoalie = roster.find(
        (player) => player.isGoalie && starters.includes(player.playerId),
      );
      rows[teamId] = starterGoalie?.playerId ?? null;
    }

    return rows;
  }, [homeTeamId, awayTeamId, rostersByTeam, startersByTeam]);

  const homeShotsTotal =
    safeHomeShotsByPeriod[1] +
    safeHomeShotsByPeriod[2] +
    safeHomeShotsByPeriod[3] +
    safeHomeShotsByPeriod.OT;
  const awayShotsTotal =
    safeAwayShotsByPeriod[1] +
    safeAwayShotsByPeriod[2] +
    safeAwayShotsByPeriod[3] +
    safeAwayShotsByPeriod.OT;

  const summaryPeriodLengthSeconds = Math.max(
    60,
    getPeriodLengthMinutes(session?.periodLength ?? "17") * 60,
  );

  const shotsByGoalie = useMemo(() => {
    const byGoalie = new Map<
      string,
      {
        goalieTeamId: string;
        goalieTeamName: string;
        goalieName: string;
        totals: ShotsByPeriod;
        stints: Array<{
          enteredAtSeconds: number;
          exitedAtSeconds: number;
          durationSeconds: number;
        }>;
        totalTimeInNetSeconds: number;
      }
    >();

    const gameEndFromClock = session
      ? getAbsoluteElapsedSeconds(
          summaryPeriodLengthSeconds,
          session.period,
          computeElapsedTime(
            getPeriodLengthMinutes(session.periodLength),
            session.clock,
          ),
        )
      : 0;

    let gameEndSeconds = gameEndFromClock;
    for (const event of safeEventFeed) {
      gameEndSeconds = Math.max(
        gameEndSeconds,
        getAbsoluteElapsedSeconds(
          summaryPeriodLengthSeconds,
          event.period,
          event.timeInPeriod,
        ),
      );
    }

    const teamRows = [
      {
        teamId: homeTeamId,
        teamName: session?.homeTeam ?? "Home",
      },
      {
        teamId: awayTeamId,
        teamName: session?.awayTeam ?? "Away",
      },
    ].filter((row) => row.teamId);

    for (const shot of safeShotHistory) {
      const goalieName = normalizeGoalieName(shot?.goalieName);
      if (!shot || !goalieName) continue;

      const key = `${shot.goalieTeamId}:${goalieName}`;
      const current = byGoalie.get(key) ?? {
        goalieTeamId: shot.goalieTeamId,
        goalieTeamName: shot.goalieTeamName,
        goalieName,
        totals: { 1: 0, 2: 0, 3: 0, OT: 0 },
        stints: [],
        totalTimeInNetSeconds: 0,
      };

      const periodKey: keyof ShotsByPeriod =
        shot.period >= 4
          ? "OT"
          : (Math.max(1, Math.min(3, shot.period)) as 1 | 2 | 3);
      current.totals[periodKey] = Math.max(
        0,
        current.totals[periodKey] + shot.delta,
      );
      byGoalie.set(key, current);
    }

    for (const team of teamRows) {
      const goalieEvents = safeEventFeed
        .filter(
          (event) =>
            event.eventType === "Goalie" && event.teamId === team.teamId,
        )
        .map((event) => ({
          kind: event.goalieChangeKind ?? "change",
          oldGoalieName: normalizeGoalieName(event.goalieOldName),
          newGoalieName: normalizeGoalieName(event.goalieNewName),
          atSeconds: getAbsoluteElapsedSeconds(
            summaryPeriodLengthSeconds,
            event.period,
            event.timeInPeriod,
          ),
        }))
        .sort((a, b) => a.atSeconds - b.atSeconds);

      const initialFromEvents = goalieEvents.find(
        (event) => event.oldGoalieName,
      )?.oldGoalieName;
      const fallbackCurrentGoalieId =
        startingGoalieByTeam[team.teamId] ??
        currentGoalieByTeam[team.teamId] ??
        null;
      const fallbackCurrentGoalieName = fallbackCurrentGoalieId
        ? normalizeGoalieName(
            (rostersByTeam[team.teamId] ?? []).find(
              (player) => player.playerId === fallbackCurrentGoalieId,
            )?.fullName ?? null,
          )
        : null;

      let activeGoalieName = initialFromEvents ?? fallbackCurrentGoalieName;
      let enteredAtSeconds = activeGoalieName ? 0 : null;

      const pushStint = (
        goalieName: string | null,
        stintStart: number | null,
        stintEnd: number,
      ) => {
        if (!goalieName || stintStart === null) return;
        const safeEnd = Math.max(stintStart, stintEnd);
        const duration = Math.max(0, safeEnd - stintStart);
        const key = `${team.teamId}:${goalieName}`;
        const current = byGoalie.get(key) ?? {
          goalieTeamId: team.teamId,
          goalieTeamName: team.teamName,
          goalieName,
          totals: { 1: 0, 2: 0, 3: 0, OT: 0 },
          stints: [],
          totalTimeInNetSeconds: 0,
        };

        current.stints.push({
          enteredAtSeconds: stintStart,
          exitedAtSeconds: safeEnd,
          durationSeconds: duration,
        });
        current.totalTimeInNetSeconds += duration;
        byGoalie.set(key, current);
      };

      for (const event of goalieEvents) {
        if (event.kind === "change") {
          pushStint(activeGoalieName, enteredAtSeconds, event.atSeconds);
          activeGoalieName = event.newGoalieName;
          enteredAtSeconds = activeGoalieName ? event.atSeconds : null;
          continue;
        }

        if (event.kind === "pulled") {
          pushStint(activeGoalieName, enteredAtSeconds, event.atSeconds);
          activeGoalieName = null;
          enteredAtSeconds = null;
          continue;
        }

        if (event.kind === "returned") {
          if (!activeGoalieName) {
            activeGoalieName = event.newGoalieName ?? event.oldGoalieName;
            enteredAtSeconds = activeGoalieName ? event.atSeconds : null;
          }
        }
      }

      pushStint(activeGoalieName, enteredAtSeconds, gameEndSeconds);
    }

    return Array.from(byGoalie.values())
      .map((goalie) => ({
        ...goalie,
        totalShotsAgainst:
          goalie.totals[1] +
          goalie.totals[2] +
          goalie.totals[3] +
          goalie.totals.OT,
      }))
      .sort((a, b) => {
        if (b.totalShotsAgainst !== a.totalShotsAgainst) {
          return b.totalShotsAgainst - a.totalShotsAgainst;
        }
        if (b.totalTimeInNetSeconds !== a.totalTimeInNetSeconds) {
          return b.totalTimeInNetSeconds - a.totalTimeInNetSeconds;
        }
        return a.goalieName.localeCompare(b.goalieName);
      });
  }, [
    currentGoalieByTeam,
    homeTeamId,
    awayTeamId,
    rostersByTeam,
    safeEventFeed,
    safeShotHistory,
    session,
    startingGoalieByTeam,
    summaryPeriodLengthSeconds,
  ]);

  const activePlayersByTeam = useMemo(() => {
    const toSortedActivePlayers = (teamId: string) =>
      (rostersByTeam[teamId] ?? [])
        .filter((player) => player.isActive)
        .sort((a, b) => {
          const jerseyA = a.jerseyNumber ?? Number.MAX_SAFE_INTEGER;
          const jerseyB = b.jerseyNumber ?? Number.MAX_SAFE_INTEGER;
          if (jerseyA !== jerseyB) return jerseyA - jerseyB;
          return a.fullName.localeCompare(b.fullName);
        });

    return {
      home: toSortedActivePlayers(homeTeamId),
      away: toSortedActivePlayers(awayTeamId),
    };
  }, [rostersByTeam, homeTeamId, awayTeamId]);

  const rosterPreviewData = useMemo(() => {
    if (!session || !rosterPreviewTeam) return null;

    const isHome = rosterPreviewTeam === "home";
    const teamId = isHome ? homeTeamId : awayTeamId;
    const teamName = isHome ? session.homeTeam : session.awayTeam;
    const basePlayers = isHome
      ? activePlayersByTeam.home
      : activePlayersByTeam.away;
    const starterIds = new Set(startersByTeam[teamId] ?? []);
    const players = [...basePlayers].sort((a, b) => {
      const aIsStarter = starterIds.has(a.playerId);
      const bIsStarter = starterIds.has(b.playerId);
      if (aIsStarter !== bIsStarter) {
        return aIsStarter ? -1 : 1;
      }

      const jerseyA = a.jerseyNumber ?? Number.MAX_SAFE_INTEGER;
      const jerseyB = b.jerseyNumber ?? Number.MAX_SAFE_INTEGER;
      if (jerseyA !== jerseyB) return jerseyA - jerseyB;
      return a.fullName.localeCompare(b.fullName);
    });
    const coaches = (coachesByTeam[teamId] ?? []).filter(
      (coach) => coach.coachName.trim().length > 0,
    );

    return {
      teamName,
      players,
      starterIds,
      coaches,
    };
  }, [
    session,
    rosterPreviewTeam,
    homeTeamId,
    awayTeamId,
    activePlayersByTeam,
    startersByTeam,
    coachesByTeam,
  ]);

  const starterInformationTeams = useMemo(() => {
    if (!session) return [];

    return [
      {
        teamId: awayTeamId,
        teamName: buildTeamDisplayName(
          session.awayTeam,
          nextGame?.awayTeamMascot,
        ),
        side: "Visiting",
      },
      {
        teamId: homeTeamId,
        teamName: buildTeamDisplayName(
          session.homeTeam,
          nextGame?.homeTeamMascot,
        ),
        side: "Home",
      },
    ].map(({ teamId, teamName, side }) => {
      const roster = rostersByTeam[teamId] ?? [];
      const starters = (startersByTeam[teamId] ?? [])
        .map((playerId) =>
          roster.find((player) => player.playerId === playerId),
        )
        .filter((player): player is RosterPlayer => Boolean(player))
        .sort((a, b) => {
          const groupOrder = { Goalies: 0, Defensemen: 1, Forwards: 2 };
          const groupDifference =
            groupOrder[getStarterPositionGroup(a)] -
            groupOrder[getStarterPositionGroup(b)];
          if (groupDifference !== 0) return groupDifference;
          const jerseyDifference =
            (a.jerseyNumber ?? Number.MAX_SAFE_INTEGER) -
            (b.jerseyNumber ?? Number.MAX_SAFE_INTEGER);
          return jerseyDifference || a.fullName.localeCompare(b.fullName);
        });
      const starterGroups = ["Goalies", "Defensemen", "Forwards"]
        .map((label) => ({
          label,
          players: starters.filter(
            (player) => getStarterPositionGroup(player) === label,
          ),
        }))
        .filter((group) => group.players.length > 0);
      const coaches = (coachesByTeam[teamId] ?? []).filter(
        (coach) => coach.coachName.trim().length > 0,
      );

      return { teamId, teamName, side, starters, starterGroups, coaches };
    });
  }, [
    session,
    nextGame,
    homeTeamId,
    awayTeamId,
    rostersByTeam,
    startersByTeam,
    coachesByTeam,
  ]);

  const coachEmailRecipients = useMemo(() => {
    const teamRows = [
      { teamId: homeTeamId, teamName: session?.homeTeam ?? "Home" },
      { teamId: awayTeamId, teamName: session?.awayTeam ?? "Away" },
    ];

    return teamRows.flatMap(({ teamId, teamName }) =>
      (coachesByTeam[teamId] ?? [])
        .filter((coach) => coach.coachEmail)
        .map((coach) => ({
          key: `${teamId}:${coach.roleName}:${coach.coachEmail}`,
          teamId,
          teamName,
          roleName: coach.roleName,
          coachName: coach.coachName,
          coachEmail: coach.coachEmail ?? "",
        })),
    );
  }, [coachesByTeam, homeTeamId, awayTeamId, session]);

  const officialEmailRecipients = useMemo<EmailRecipientOption[]>(() => {
    return officials
      .filter((official) => (official.officialEmail ?? "").trim().length > 0)
      .map((official, index) => {
        const email = (official.officialEmail ?? "").trim();
        return {
          key: `official:${official.officialId ?? official.role ?? index}:${email.toLowerCase()}`,
          recipientName:
            official.officialName || toOfficialRoleLabel(official.role),
          recipientMeta: `${toOfficialRoleLabel(official.role)} • ${email || "No email on file"}`,
          email,
        };
      })
      .filter((recipient) => recipient.email.length > 0);
  }, [officials]);

  const customEmailRecipients = useMemo<EmailRecipientOption[]>(
    () =>
      customEmails.map((email) => ({
        key: `custom:${email.toLowerCase()}`,
        recipientName: email,
        recipientMeta: "Additional recipient",
        email,
      })),
    [customEmails],
  );

  function disconnectScoreboardSocket() {
    const socket = scoreboardSocketRef.current;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // Ignore close failures.
    }
    scoreboardSocketRef.current = null;
  }

  function clearScheduledScoreboardReconnect() {
    if (scoreboardReconnectTimerRef.current == null) return;
    clearTimeout(scoreboardReconnectTimerRef.current);
    scoreboardReconnectTimerRef.current = null;
  }

  function scheduleScoreboardReconnect(reason: string) {
    if (
      !scoreboardGatewaySettings.enabled ||
      stageRef.current !== "gameDashboard"
    ) {
      return;
    }

    if (scoreboardReconnectTimerRef.current != null) {
      return;
    }

    const attempt = scoreboardReconnectAttemptRef.current;
    const delayMs = Math.min(12000, 1500 + attempt * 1500);
    scoreboardReconnectAttemptRef.current = attempt + 1;
    setScoreboardConnectionMessage(
      `${reason}. Retrying in ${Math.ceil(delayMs / 1000)}s`,
    );

    scoreboardReconnectTimerRef.current = setTimeout(() => {
      scoreboardReconnectTimerRef.current = null;
      gatewayLastClockSecondsRef.current = null;
      scoreboardLastMessageAtRef.current = null;
      setScoreboardConnectionState("connecting");
      setScoreboardConnectionMessage("Reconnecting to gateway");
      setScoreboardReconnectNonce((prev) => prev + 1);
    }, delayMs);
  }

  function normalizeScoreboardHost(rawHost: string) {
    const trimmed = rawHost.trim();
    if (!trimmed) return "";
    return trimmed
      .replace(/^wss?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/\s+/g, "");
  }

  function normalizeScoreboardPort(rawPort: string) {
    const digits = rawPort.replace(/[^0-9]/g, "").trim();
    if (!digits) return DEFAULT_SCOREBOARD_GATEWAY_PORT;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      return DEFAULT_SCOREBOARD_GATEWAY_PORT;
    }
    return String(parsed);
  }

  function maskTokenForDisplay(token: string) {
    const trimmed = token.trim();
    if (!trimmed) return "--";
    if (trimmed.length <= 8) return "********";
    return `${trimmed.slice(0, 4)}********${trimmed.slice(-4)}`;
  }

  function buildClockDisplayFromGatewayPayload(
    payload: Record<string, unknown>,
  ) {
    const formatted =
      typeof payload.clockFormatted === "string"
        ? payload.clockFormatted.trim()
        : "";
    if (formatted) return formatted;

    const minuteValue = Number(payload.clockMin);
    const secondValue = Number(payload.clockSec);
    const tenthsValue = Number(payload.clockTenths);

    if (
      Number.isFinite(minuteValue) &&
      Number.isFinite(secondValue) &&
      Number.isFinite(tenthsValue)
    ) {
      const safeMinutes = Math.max(0, Math.floor(minuteValue));
      const safeSeconds = Math.max(0, Math.floor(secondValue));
      const safeTenths = Math.max(0, Math.floor(tenthsValue));
      if (safeMinutes > 0) {
        return `${String(safeMinutes).padStart(2, "0")}:${String(safeSeconds).padStart(2, "0")}`;
      }
      return `${String(safeSeconds).padStart(2, "0")}.${safeTenths}`;
    }

    const fallbackClock =
      typeof payload.clock === "string" ? payload.clock.trim() : "";
    return fallbackClock;
  }

  function applyGatewayClockPayload(payload: Record<string, unknown>) {
    if (stageRef.current !== "gameDashboard") return;

    const nextClock = buildClockDisplayFromGatewayPayload(payload);
    if (!nextClock) return;

    const periodDurationMs =
      getPeriodLengthMinutes(sessionPeriodLengthRef.current) * 60 * 1000;
    const nextRemainingMs = parseClockDisplayToMs(nextClock);
    const nextClockSeconds = parseClockToSeconds(nextClock);
    const payloadPeriod = Number(payload.period);
    const normalizedPayloadPeriod = Number.isFinite(payloadPeriod)
      ? Math.max(1, Math.floor(payloadPeriod))
      : null;
    const payloadClockRunning =
      typeof payload.clockRunning === "boolean" ? payload.clockRunning : null;

    const previousGatewayClockSeconds = gatewayLastClockSecondsRef.current;
    gatewayLastClockSecondsRef.current = nextClockSeconds;

    const didPeriodChange =
      normalizedPayloadPeriod != null &&
      normalizedPayloadPeriod !== sessionPeriodRef.current;

    if (didPeriodChange) {
      // On period transition, remove expired penalties and keep only active carry-over penalties.
      setActivePenalties((prev) =>
        prev.filter((penalty) => penalty.remainingSeconds > 0),
      );
      penaltyClockCarryMsRef.current = 0;
      penaltyClockPrevRemainingMsRef.current = null;
    }

    if (
      !didPeriodChange &&
      payloadClockRunning === false &&
      previousGatewayClockSeconds != null
    ) {
      const deltaSeconds = nextClockSeconds - previousGatewayClockSeconds;
      if (deltaSeconds !== 0) {
        shiftPenaltyTimersForClockAdjustment(deltaSeconds);
      }
    }

    setSession((prev) => {
      if (!prev) return prev;

      const patch: Partial<SessionState> = {};
      if (prev.clock !== nextClock) {
        patch.clock = nextClock;
      }

      if (
        normalizedPayloadPeriod != null &&
        prev.period !== normalizedPayloadPeriod
      ) {
        patch.period = normalizedPayloadPeriod;
      }

      return Object.keys(patch).length > 0 ? { ...prev, ...patch } : prev;
    });

    gameClockControlsRef.current.setDuration(periodDurationMs);
    gameClockControlsRef.current.syncPausedRemaining(
      nextRemainingMs,
      periodDurationMs,
    );

    if (!didPeriodChange && nextRemainingMs === 0) {
      handleClockExpired();
    }

    if (payloadClockRunning === true) {
      gameClockControlsRef.current.resume();
      setIsClockRunning(true);
      setPeriodController((prev) =>
        prev.state === "NOT_STARTED" ? { ...prev, state: "IN_PROGRESS" } : prev,
      );
      return;
    }

    if (payloadClockRunning === false) {
      gameClockControlsRef.current.pause();
      setIsClockRunning(false);
    }
  }

  function openScoreboardSettingsModal() {
    setScoreboardSettingsDraft(scoreboardGatewaySettings);
    setShowScoreboardTokenSecret(false);
    setShowScoreboardSettingsModal(true);
  }

  function requestScoreboardReconnect() {
    if (!scoreboardGatewaySettings.enabled) return;
    clearScheduledScoreboardReconnect();
    scoreboardReconnectAttemptRef.current = 0;
    disconnectScoreboardSocket();
    gatewayLastClockSecondsRef.current = null;
    scoreboardLastMessageAtRef.current = null;
    setScoreboardConnectionState("connecting");
    setScoreboardConnectionMessage("Reconnecting to gateway");
    setScoreboardReconnectNonce((prev) => prev + 1);
  }

  function closeScoreboardSettingsModal() {
    setShowScoreboardSettingsModal(false);
    setShowScoreboardTokenSecret(false);
    setScoreboardSettingsDraft(scoreboardGatewaySettings);
  }

  async function saveScoreboardSettings() {
    const normalizedSettings: ScoreboardGatewaySettings = {
      enabled: scoreboardSettingsDraft.enabled,
      host:
        normalizeScoreboardHost(scoreboardSettingsDraft.host) ||
        DEFAULT_SCOREBOARD_GATEWAY_HOST,
      port: normalizeScoreboardPort(scoreboardSettingsDraft.port),
      tokenSecret: scoreboardSettingsDraft.tokenSecret.trim(),
    };

    setScoreboardGatewaySettings(normalizedSettings);
    setScoreboardSettingsDraft(normalizedSettings);
    setShowScoreboardSettingsModal(false);

    try {
      await storageSetItem(
        SCOREBOARD_GATEWAY_SETTINGS_KEY,
        JSON.stringify(normalizedSettings),
      );
      trace("scoreboard.gateway.settings.saved", {
        enabled: normalizedSettings.enabled,
        host: normalizedSettings.host,
        port: normalizedSettings.port,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("scoreboard.gateway.settings.save.error", { message });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadScoreboardSettings() {
      try {
        const raw = await storageGetItem(SCOREBOARD_GATEWAY_SETTINGS_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as Partial<ScoreboardGatewaySettings>;
        const savedHost = normalizeScoreboardHost(String(parsed.host ?? ""));
        const normalizedSettings: ScoreboardGatewaySettings = {
          enabled: Boolean(parsed.enabled),
          host:
            !savedHost || savedHost === LEGACY_SCOREBOARD_GATEWAY_HOST
              ? DEFAULT_SCOREBOARD_GATEWAY_HOST
              : savedHost,
          port: normalizeScoreboardPort(String(parsed.port ?? "")),
          tokenSecret: String(parsed.tokenSecret ?? "").trim(),
        };
        if (scheduledGatewayAppliedRef.current) return;
        setScoreboardGatewaySettings(normalizedSettings);
        setScoreboardSettingsDraft(normalizedSettings);
      } catch {
        // Ignore malformed saved settings and keep defaults.
      }
    }

    void loadScoreboardSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const shouldConnect =
      stage === "gameDashboard" && scoreboardGatewaySettings.enabled;

    if (!shouldConnect) {
      clearScheduledScoreboardReconnect();
      scoreboardReconnectAttemptRef.current = 0;
      disconnectScoreboardSocket();
      gatewayLastClockSecondsRef.current = null;
      scoreboardLastMessageAtRef.current = null;
      setScoreboardConnectionState("disconnected");
      setScoreboardConnectionMessage(
        scoreboardGatewaySettings.enabled
          ? "Disconnected"
          : "Manual mode (tablet clock)",
      );
      return;
    }

    const host = normalizeScoreboardHost(scoreboardGatewaySettings.host);
    const port = normalizeScoreboardPort(scoreboardGatewaySettings.port);
    if (!host) {
      clearScheduledScoreboardReconnect();
      scoreboardReconnectAttemptRef.current = 0;
      setScoreboardConnectionState("error");
      setScoreboardConnectionMessage("Missing gateway IP address");
      disconnectScoreboardSocket();
      return;
    }

    clearScheduledScoreboardReconnect();
    disconnectScoreboardSocket();
    setScoreboardConnectionState("connecting");
    setScoreboardConnectionMessage("Connecting to gateway");

    const websocketUrl = `ws://${host}:${port}/ws`;
    const socket = new WebSocket(websocketUrl);
    scoreboardSocketRef.current = socket;
    scoreboardLastMessageAtRef.current = null;

    const heartbeatInterval = setInterval(() => {
      if (scoreboardSocketRef.current !== socket) return;
      if (socket.readyState !== WebSocket.OPEN) return;

      const lastMessageAt = scoreboardLastMessageAtRef.current;
      if (lastMessageAt == null) return;

      if (Date.now() - lastMessageAt < 3000) return;

      setScoreboardConnectionState("disconnected");
      setScoreboardConnectionMessage("Gateway connection timed out");
      gatewayLastClockSecondsRef.current = null;
      scoreboardLastMessageAtRef.current = null;
      try {
        socket.close();
      } catch {
        // Ignore close failures.
      }
      scheduleScoreboardReconnect("Gateway timed out");
    }, 1000);

    socket.onopen = () => {
      if (scoreboardSocketRef.current !== socket) return;
      clearScheduledScoreboardReconnect();
      scoreboardReconnectAttemptRef.current = 0;
      setScoreboardConnectionState("connected");
      setScoreboardConnectionMessage(`Connected: ${host}:${port}`);
      scoreboardLastMessageAtRef.current = Date.now();

      const tokenSecret = scoreboardGatewaySettings.tokenSecret.trim();
      if (tokenSecret.length > 0) {
        try {
          socket.send(
            JSON.stringify({ auth: tokenSecret, client: "mobile-gm" }),
          );
        } catch {
          // Ignore auth send failures; socket error handlers update status.
        }
      }
    };

    socket.onmessage = (event) => {
      if (scoreboardSocketRef.current !== socket) return;
      scoreboardLastMessageAtRef.current = Date.now();

      const rawData = typeof event.data === "string" ? event.data.trim() : "";
      let messageType = rawData.toUpperCase();
      let parsedPayload: Record<string, unknown> | null = null;

      try {
        const parsed = JSON.parse(rawData) as { type?: string };
        if (parsed && typeof parsed === "object") {
          parsedPayload = parsed as Record<string, unknown>;
        }
        if (typeof parsed?.type === "string") {
          messageType = parsed.type.toUpperCase();
        }
      } catch {
        // Non-JSON messages are valid; keep raw uppercase text fallback.
      }

      if (messageType === "AUTH_REQUIRED") {
        const tokenSecret = scoreboardGatewaySettings.tokenSecret.trim();
        if (!tokenSecret) {
          setScoreboardConnectionState("error");
          setScoreboardConnectionMessage("Gateway requires token secret");
          return;
        }

        try {
          socket.send(
            JSON.stringify({ auth: tokenSecret, client: "mobile-gm" }),
          );
          setScoreboardConnectionMessage("Authenticating with gateway");
        } catch {
          setScoreboardConnectionState("error");
          setScoreboardConnectionMessage("Failed to send auth token");
        }
        return;
      }

      if (messageType === "AUTH_OK" || messageType === "AUTH_SUCCESS") {
        setScoreboardConnectionState("connected");
        setScoreboardConnectionMessage(`Connected: ${host}:${port}`);
        clearScheduledScoreboardReconnect();
        scoreboardReconnectAttemptRef.current = 0;
        return;
      }

      if (messageType === "AUTH_FAILED" || messageType === "AUTH_ERROR") {
        setScoreboardConnectionState("error");
        setScoreboardConnectionMessage("Gateway auth failed");
        scheduleScoreboardReconnect("Gateway auth failed");
        try {
          socket.close();
        } catch {
          // Ignore close failures.
        }
        return;
      }

      if (parsedPayload && scoreboardClockSyncActiveRef.current) {
        applyGatewayClockPayload(parsedPayload);
      }
    };

    socket.onerror = () => {
      if (scoreboardSocketRef.current !== socket) return;
      setScoreboardConnectionState("error");
      setScoreboardConnectionMessage(`Connection failed: ${host}:${port}`);
      scheduleScoreboardReconnect("Connection failed");
    };

    socket.onclose = () => {
      if (scoreboardSocketRef.current !== socket) return;
      scoreboardSocketRef.current = null;
      gatewayLastClockSecondsRef.current = null;
      scoreboardLastMessageAtRef.current = null;
      setScoreboardConnectionState("disconnected");
      setScoreboardConnectionMessage("Disconnected");
      scheduleScoreboardReconnect("Disconnected from gateway");
    };

    return () => {
      clearInterval(heartbeatInterval);
      if (scoreboardSocketRef.current === socket) {
        scoreboardSocketRef.current = null;
      }
      scoreboardLastMessageAtRef.current = null;
      try {
        socket.close();
      } catch {
        // Ignore close failures.
      }
    };
  }, [
    stage,
    scoreboardGatewaySettings.enabled,
    scoreboardGatewaySettings.host,
    scoreboardGatewaySettings.port,
    scoreboardGatewaySettings.tokenSecret,
    scoreboardReconnectNonce,
  ]);

  useEffect(() => {
    if (!session || stage !== "gameDashboard") {
      return;
    }

    if (periodController.state === "INTERMISSION") {
      const timer = setInterval(() => {
        setIntermissionSeconds((prev) => {
          const next = prev + 1;
          updateSession({ clock: formatSecondsToClock(next) });
          return next;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [session, stage, periodController.state, updateSession]);

  useEffect(() => {
    if (
      !session ||
      stage !== "gameDashboard" ||
      periodController.state === "INTERMISSION" ||
      isScoreboardClockSyncActive
    ) {
      return;
    }

    if (session.clock !== gameClock.displayTime) {
      updateSession({ clock: gameClock.displayTime });
    }
  }, [
    session,
    stage,
    periodController.state,
    gameClock.displayTime,
    isScoreboardClockSyncActive,
  ]);

  useEffect(() => {
    if (!session || stage !== "gameDashboard") return;

    const periodDurationMs =
      getPeriodLengthMinutes(session.periodLength) * 60 * 1000;
    gameClock.setDuration(periodDurationMs);

    if (!isClockRunning && !isScoreboardClockSyncActive) {
      const sessionRemainingMs = parseClockDisplayToMs(session.clock);
      gameClock.syncPausedRemaining(sessionRemainingMs, periodDurationMs);
    }
  }, [
    stage,
    session?.period,
    session?.periodLength,
    isClockRunning,
    isScoreboardClockSyncActive,
  ]);

  useEffect(() => {
    if (stage !== "gameDashboard" || periodController.state !== "IN_PROGRESS") {
      penaltyClockPrevRemainingMsRef.current = null;
      penaltyClockCarryMsRef.current = 0;
      return;
    }

    const currentRemainingMs = gameClock.remainingTimeMs;
    const prevRemainingMs = penaltyClockPrevRemainingMsRef.current;
    penaltyClockPrevRemainingMsRef.current = currentRemainingMs;

    if (
      !isClockRunning ||
      !gameClock.isRunning ||
      isAnyModalOpen ||
      prevRemainingMs == null
    ) {
      return;
    }

    const deltaMs = prevRemainingMs - currentRemainingMs;
    penaltyClockCarryMsRef.current += deltaMs;

    const elapsedWholeSeconds =
      penaltyClockCarryMsRef.current >= 0
        ? Math.floor(penaltyClockCarryMsRef.current / 1000)
        : Math.ceil(penaltyClockCarryMsRef.current / 1000);
    if (elapsedWholeSeconds === 0) return;

    penaltyClockCarryMsRef.current -= elapsedWholeSeconds * 1000;

    setActivePenalties((prev) => {
      if (periodController.state !== "IN_PROGRESS") return prev;
      return prev.map((penalty) => {
        const rewindBufferSeconds = Math.max(0, penalty.durationMinutes * 60);
        return {
          ...penalty,
          remainingSeconds: Math.max(
            -rewindBufferSeconds,
            Math.min(
              rewindBufferSeconds,
              penalty.remainingSeconds - elapsedWholeSeconds,
            ),
          ),
        };
      });
    });
  }, [
    stage,
    periodController.state,
    gameClock.remainingTimeMs,
    gameClock.isRunning,
    isClockRunning,
    isAnyModalOpen,
  ]);

  useEffect(() => {
    if (stage !== "gameDashboard" || periodController.state !== "IN_PROGRESS") {
      return;
    }

    if (isScoreboardClockSyncActive) {
      return;
    }

    const shouldPauseForModal =
      isAnyModalOpen && !(isRunningTimeActive && isRunningTimeEventModalOpen);

    if (isClockRunning && shouldPauseForModal && gameClock.isRunning) {
      gameClock.pause();
      return;
    }

    if (isClockRunning && !shouldPauseForModal && !gameClock.isRunning) {
      gameClock.resume();
      return;
    }

    if (!isClockRunning && gameClock.isRunning) {
      gameClock.pause();
    }
  }, [
    stage,
    periodController.state,
    isClockRunning,
    isAnyModalOpen,
    isRunningTimeActive,
    isRunningTimeEventModalOpen,
    gameClock.isRunning,
    isScoreboardClockSyncActive,
  ]);

  useEffect(() => {
    const allowBackgroundSync =
      stage === "gameDashboard" ||
      stage === "gameSummary" ||
      stage === "sendScoresheet";
    if (!allowBackgroundSync) return;

    void refreshSyncStateFromQueue();
    void flushAllOfflineQueues();

    const syncTimer = setInterval(() => {
      void flushAllOfflineQueues();
    }, 7000);

    return () => clearInterval(syncTimer);
  }, [stage, activeApiBase, nextGame?.gameId]);

  useEffect(() => {
    if (stage !== "gameDashboard" || gameHasEnded || !nextGame?.gameId) {
      return;
    }

    const payload = buildLiveShotSummaryPayload();
    const signature = JSON.stringify(payload);
    if (signature === lastLiveShotSyncSignatureRef.current) {
      return;
    }

    if (liveShotSyncTimerRef.current != null) {
      clearTimeout(liveShotSyncTimerRef.current);
      liveShotSyncTimerRef.current = null;
    }

    const gameId = nextGame.gameId;
    liveShotSyncTimerRef.current = setTimeout(() => {
      liveShotSyncTimerRef.current = null;
      void (async () => {
        try {
          await postLiveShotSummaryToBackend(gameId, payload);
          lastLiveShotSyncSignatureRef.current = signature;
          trace("shots.sync.success", {
            gameId,
            homeTotal: payload.homeTotal,
            awayTotal: payload.awayTotal,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          trace("shots.sync.failed", { gameId, message });
        }
      })();
    }, 450);

    return () => {
      if (liveShotSyncTimerRef.current != null) {
        clearTimeout(liveShotSyncTimerRef.current);
        liveShotSyncTimerRef.current = null;
      }
    };
  }, [
    stage,
    gameHasEnded,
    nextGame?.gameId,
    activeApiBase,
    safeHomeShotsByPeriod[1],
    safeHomeShotsByPeriod[2],
    safeHomeShotsByPeriod[3],
    safeHomeShotsByPeriod.OT,
    safeAwayShotsByPeriod[1],
    safeAwayShotsByPeriod[2],
    safeAwayShotsByPeriod[3],
    safeAwayShotsByPeriod.OT,
    homeShotsTotal,
    awayShotsTotal,
  ]);

  useEffect(() => {
    lastLiveShotSyncSignatureRef.current = "";
    if (liveShotSyncTimerRef.current != null) {
      clearTimeout(liveShotSyncTimerRef.current);
      liveShotSyncTimerRef.current = null;
    }
  }, [nextGame?.gameId]);

  useEffect(() => {
    if (
      stage === "gameDashboard" &&
      !gameHasEnded &&
      session &&
      nextGame?.gameId
    ) {
      void persistActiveGameSnapshot(
        buildActiveGameSnapshot(session, nextGame),
      );
      return;
    }

    if (gameHasEnded || stage === "gameSummary") {
      void clearActiveGameSnapshot();
    }
  }, [
    stage,
    gameHasEnded,
    session,
    nextGame,
    activeRosterTeam,
    rostersByTeam,
    coachesByTeam,
    startersByTeam,
    headCoachSignatures,
    officials,
    homeShotsByPeriod,
    awayShotsByPeriod,
    eventFeed,
    playerStatsById,
    teamPenaltyCountById,
    activePenalties,
    homeGoaliePulled,
    awayGoaliePulled,
    penaltyShotActive,
    gameStartedAtIso,
  ]);

  function updateSession(patch: Partial<SessionState>) {
    setSession((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function loadActiveGameSnapshot() {
    try {
      const raw = await storageGetItem(ACTIVE_GAME_SNAPSHOT_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as ActiveGameSnapshot;
    } catch {
      try {
        await storageRemoveItem(ACTIVE_GAME_SNAPSHOT_KEY);
      } catch {
        // Ignore cleanup failures.
      }
      return null;
    }
  }

  async function loadActiveGameResume() {
    try {
      const raw = await storageGetItem(ACTIVE_GAME_RESUME_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ActiveGameResume> & {
        session?: SessionState;
        nextGame?: NextGame | null;
        timestampIso?: string;
      };

      if (!parsed || !parsed.session) return null;

      return {
        stage: "gameDashboard",
        session: parsed.session,
        nextGame: parsed.nextGame ?? null,
        gameStartedAtIso:
          typeof parsed.gameStartedAtIso === "string"
            ? parsed.gameStartedAtIso
            : null,
        timestampIso:
          typeof parsed.timestampIso === "string"
            ? parsed.timestampIso
            : new Date().toISOString(),
      };
    } catch {
      try {
        await storageRemoveItem(ACTIVE_GAME_RESUME_KEY);
      } catch {
        // Ignore cleanup failure.
      }
      return null;
    }
  }

  async function clearActiveGameSnapshot() {
    try {
      await storageRemoveItem(ACTIVE_GAME_SNAPSHOT_KEY);
      await storageRemoveItem(ACTIVE_GAME_RESUME_KEY);
      await storageRemoveItem(ACTIVE_GAME_MARKER_KEY);
    } catch {
      // Ignore storage failures during cleanup.
    }
  }

  async function hasActiveGameMarker() {
    try {
      const marker = await storageGetItem(ACTIVE_GAME_MARKER_KEY);
      return marker === "1";
    } catch {
      return false;
    }
  }

  async function markActiveGame() {
    try {
      await storageSetItem(ACTIVE_GAME_MARKER_KEY, "1");
    } catch {
      // Ignore marker write failures.
    }
  }

  function buildActiveGameSnapshot(
    currentSession: SessionState,
    currentNextGame: NextGame,
  ): ActiveGameSnapshot {
    const leanOfficials = officials.map((official) => ({
      ...official,
      // Base64 signatures can exceed AsyncStorage row limits on Android; exclude from resume snapshot.
      signatureImageBase64: null,
    }));

    return {
      userId: currentSession.userId,
      accessCode: currentSession.code,
      stage: "gameDashboard",
      session: currentSession,
      nextGame: currentNextGame,
      activeRosterTeam,
      rostersByTeam,
      coachesByTeam,
      startersByTeam,
      headCoachSignatures: {},
      officials: leanOfficials,
      homeShotsByPeriod,
      awayShotsByPeriod,
      shotHistory,
      eventFeed,
      playerStatsById,
      teamPenaltyCountById,
      activePenalties,
      homeGoaliePulled,
      awayGoaliePulled,
      penaltyShotActive,
      gameStartedAtIso,
      timestampIso: new Date().toISOString(),
    };
  }

  async function persistActiveGameSnapshot(snapshot: ActiveGameSnapshot) {
    const resumeSnapshot: ActiveGameResume = {
      stage: snapshot.stage,
      session: snapshot.session,
      nextGame: snapshot.nextGame,
      gameStartedAtIso: snapshot.gameStartedAtIso ?? null,
      timestampIso: snapshot.timestampIso,
    };

    try {
      const serializedResume = JSON.stringify(resumeSnapshot);
      await storageSetItem(ACTIVE_GAME_RESUME_KEY, serializedResume);
      trace("activegame.resume.saved", {
        stage: resumeSnapshot.stage,
        gameId: resumeSnapshot.nextGame?.gameId ?? null,
        bytes: serializedResume.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("activegame.resume.save.error", { message });
    }

    try {
      await markActiveGame();

      const serializedSnapshot = JSON.stringify(snapshot);
      await storageSetItem(ACTIVE_GAME_SNAPSHOT_KEY, serializedSnapshot);
      trace("activegame.snapshot.saved", {
        stage: snapshot.stage,
        gameId: snapshot.nextGame?.gameId ?? null,
        bytes: serializedSnapshot.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("activegame.snapshot.save.error", { message });
    }
  }

  function restoreActiveGameSnapshot(
    snapshot: ActiveGameSnapshot,
    accessCode: string,
  ) {
    const normalizedEventFeed = Array.isArray(snapshot.eventFeed)
      ? snapshot.eventFeed.filter((event): event is GameFeedEvent =>
          Boolean(event && event.localId),
        )
      : [];
    const normalizedActivePenalties = Array.isArray(snapshot.activePenalties)
      ? snapshot.activePenalties.filter((penalty): penalty is ActivePenalty =>
          Boolean(penalty && penalty.id && penalty.teamId),
        )
      : [];

    setSession({
      ...snapshot.session,
      code: accessCode,
      apiBase: activeApiBase,
    });
    setNextGame(snapshot.nextGame);
    setActiveRosterTeam(snapshot.activeRosterTeam);
    setRostersByTeam(snapshot.rostersByTeam);
    setCoachesByTeam(snapshot.coachesByTeam);
    setStartersByTeam(snapshot.startersByTeam);
    setHeadCoachSignatures(snapshot.headCoachSignatures);
    setOfficials(snapshot.officials);
    setHomeShotsByPeriod(normalizeShotsByPeriod(snapshot.homeShotsByPeriod));
    setAwayShotsByPeriod(normalizeShotsByPeriod(snapshot.awayShotsByPeriod));
    setShotHistory(
      Array.isArray(snapshot.shotHistory) ? snapshot.shotHistory : [],
    );
    setEventFeed(normalizedEventFeed);
    setPlayerStatsById(snapshot.playerStatsById ?? {});
    setTeamPenaltyCountById(snapshot.teamPenaltyCountById ?? {});
    setActivePenalties(normalizedActivePenalties);
    setHomeGoaliePulled(snapshot.homeGoaliePulled);
    setAwayGoaliePulled(snapshot.awayGoaliePulled);
    setPenaltyShotActive(snapshot.penaltyShotActive);
    setGameStartedAtIso(snapshot.gameStartedAtIso ?? null);
    setPeriodController({
      state:
        parseClockToSeconds(snapshot.session.clock) <
        getPeriodLengthMinutes(snapshot.session.periodLength) * 60
          ? "IN_PROGRESS"
          : "NOT_STARTED",
      isOvertime: snapshot.session.period >= 4,
    });
    setGameHasEnded(false);
    setStage("gameDashboard");
  }

  function trace(step: string, details?: DebugPayload) {
    if (!VERBOSE_TRACE) {
      const isImportant =
        /^login\./.test(step) ||
        /\.error$/.test(step) ||
        /\.failed$/.test(step) ||
        /\.restored$/.test(step) ||
        /^officials\.save\./.test(step);

      if (!isImportant) {
        return;
      }
    }

    const timestamp = new Date().toISOString().slice(11, 19);
    const detailsText = details ? ` ${JSON.stringify(details)}` : "";
    const line = `${timestamp} ${step}${detailsText}`;
    // console.log(`[NF-MOBILE] ${line}`);
    setDebugTrace((prev) => [line, ...prev].slice(0, 12));
  }

  function getRosterForTeam(teamId: string) {
    return rostersByTeam[teamId] ?? [];
  }

  function findPlayerName(teamId: string, playerId: string) {
    if (!playerId) return "";
    const player = getRosterForTeam(teamId).find(
      (row) => row.playerId === playerId,
    );
    return player?.fullName ?? "Unknown Player";
  }

  function getClockContext() {
    if (!session) {
      return {
        period: 1,
        clockRemaining: "00:00",
        timeInPeriod: "00:00",
      };
    }

    const periodLengthMinutes = getPeriodLengthMinutes(session.periodLength);
    return {
      period: session.period,
      clockRemaining: session.clock,
      timeInPeriod:
        periodController.state === "INTERMISSION"
          ? formatSecondsToClock(intermissionSeconds)
          : computeElapsedTime(periodLengthMinutes, session.clock),
    };
  }

  function expireMinorOnPowerPlayGoal(scoringTeamId: string) {
    const defendingTeamId =
      scoringTeamId === homeTeamId ? awayTeamId : homeTeamId;
    if (!defendingTeamId) return;

    setActivePenalties((prev) => {
      const eligibleIndexes = prev
        .map((penalty, index) => ({ penalty, index }))
        .filter(
          ({ penalty }) =>
            penalty.teamId === defendingTeamId &&
            penalty.affectsManpower &&
            getPenaltyRule(penalty.penaltyType).goalExpiration !== "none" &&
            !penalty.isCoincidentalMinor,
        );

      if (eligibleIndexes.length === 0) return prev;

      const oldest = eligibleIndexes.reduce((earliest, current) => {
        const earliestTs = Date.parse(earliest.penalty.startedAtIso || "");
        const currentTs = Date.parse(current.penalty.startedAtIso || "");
        if (!Number.isFinite(earliestTs)) return current;
        if (!Number.isFinite(currentTs)) return earliest;
        return currentTs < earliestTs ? current : earliest;
      });

      const target = oldest.penalty;
      const updated = [...prev];

      const rule = getPenaltyRule(target.penaltyType);

      if (
        rule.goalExpiration === "reduce_minor" &&
        target.remainingSeconds > 120
      ) {
        updated[oldest.index] = {
          ...target,
          remainingSeconds: Math.max(0, target.remainingSeconds - 120),
          durationMinutes: Math.max(0, target.durationMinutes - 2),
          penaltyType: "Minor",
          suspensionBehavior: PENALTY_RULES.Minor.suspensionBehavior,
          requiresRefereeNotes: PENALTY_RULES.Minor.requiresRefereeNotes,
          reviewRequired: PENALTY_RULES.Minor.reviewRequired,
        };
        return updated;
      }

      updated.splice(oldest.index, 1);
      return updated;
    });
  }

  function getDefaultGoalType(scoringTeamId: string): GoalStrength {
    if (penaltyShotActive) return "Penalty Shot";

    const isHomeScoring = scoringTeamId === homeTeamId;
    const scoringSkaters = isHomeScoring ? homeSkatersOnIce : awaySkatersOnIce;
    const opponentSkaters = isHomeScoring ? awaySkatersOnIce : homeSkatersOnIce;

    if (scoringSkaters > opponentSkaters) return "Power Play";
    if (scoringSkaters < opponentSkaters) return "Short-Handed";

    const opponentGoaliePulled = isHomeScoring
      ? awayGoaliePulled
      : homeGoaliePulled;
    if (opponentGoaliePulled) return "Empty Net";
    return "Even Strength";
  }

  function getSkaterStrengthContext(
    scoringTeamId: string,
  ): "Power Play" | "Short-Handed" | "Even Strength" {
    const isHomeScoring = scoringTeamId === homeTeamId;
    const scoringSkaters = isHomeScoring ? homeSkatersOnIce : awaySkatersOnIce;
    const opponentSkaters = isHomeScoring ? awaySkatersOnIce : homeSkatersOnIce;
    if (scoringSkaters > opponentSkaters) return "Power Play";
    if (scoringSkaters < opponentSkaters) return "Short-Handed";
    return "Even Strength";
  }

  function openGoalModal(prefilledData: GoalModalState) {
    setGoalModalError("");
    setGoalModal(prefilledData);
  }

  function updateGoalScorer(nextScorerId: string) {
    setGoalModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scorerId: nextScorerId,
        assist1Id: prev.assist1Id === nextScorerId ? "" : prev.assist1Id,
        assist2Id: prev.assist2Id === nextScorerId ? "" : prev.assist2Id,
      };
    });
  }

  function updateScore(teamId: string) {
    if (!session) return;
    if (teamId === homeTeamId) {
      updateSession({ homeScore: session.homeScore + 1 });
      return;
    }

    if (teamId === awayTeamId) {
      updateSession({ awayScore: session.awayScore + 1 });
    }
  }

  function autoReturnPulledGoalieIfNeeded(scoringTeamId: string) {
    if (!session) return;

    const defendingTeamId =
      scoringTeamId === homeTeamId ? awayTeamId : homeTeamId;
    const defendingTeamName =
      scoringTeamId === homeTeamId ? session.awayTeam : session.homeTeam;
    const defendingGoaliePulled =
      scoringTeamId === homeTeamId ? awayGoaliePulled : homeGoaliePulled;

    if (!defendingGoaliePulled) {
      return;
    }

    const goalieId = currentGoalieByTeam[defendingTeamId] ?? null;
    const goalieName = goalieId
      ? findPlayerName(defendingTeamId, goalieId)
      : "Goalie";

    if (scoringTeamId === homeTeamId) {
      setAwayGoaliePulled(false);
    } else {
      setHomeGoaliePulled(false);
    }

    appendGoalieEvent(
      defendingTeamId,
      defendingTeamName,
      "returned",
      goalieName,
      goalieName,
    );
  }

  function addEventToFeed(event: GameFeedEvent) {
    setEventFeed((prev) => [event, ...prev]);
  }

  async function offlineQueue(event: GameFeedEvent) {
    const queueKey =
      event.eventType === "Penalty"
        ? PENALTY_OFFLINE_QUEUE_KEY
        : event.eventType === "Shot"
          ? SHOT_OFFLINE_QUEUE_KEY
          : event.eventType === "Goalie"
            ? GOALIE_OFFLINE_QUEUE_KEY
            : GOAL_OFFLINE_QUEUE_KEY;
    try {
      const existingRaw = await storageGetItem(queueKey);
      const existing = existingRaw
        ? (JSON.parse(existingRaw) as GameFeedEvent[])
        : [];
      const next = [...existing, event];
      await storageSetItem(queueKey, JSON.stringify(next));
      setSyncState("queued");
      trace(`${event.eventType.toLowerCase()}.offline.queued`, {
        localId: event.localId,
        queueLength: next.length,
      });
      await refreshSyncStateFromQueue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSyncState("error");
      trace(`${event.eventType.toLowerCase()}.offline.queue.error`, {
        message,
      });
    }
  }

  async function getQueuedEventsForKey(queueKey: string) {
    const raw = await storageGetItem(queueKey);
    if (!raw) return [] as GameFeedEvent[];

    try {
      const parsed = JSON.parse(raw) as GameFeedEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function getPendingFinalizeRequests() {
    const raw = await storageGetItem(FINALIZE_OFFLINE_QUEUE_KEY);
    if (!raw) return [] as PendingFinalizeRequest[];

    try {
      const parsed = JSON.parse(raw) as PendingFinalizeRequest[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function savePendingFinalizeRequests(items: PendingFinalizeRequest[]) {
    if (items.length === 0) {
      await storageRemoveItem(FINALIZE_OFFLINE_QUEUE_KEY);
      return;
    }

    await storageSetItem(FINALIZE_OFFLINE_QUEUE_KEY, JSON.stringify(items));
  }

  function isLikelyConnectivityError(message: string) {
    return /network request failed|failed to fetch|networkerror|timed out/i.test(
      message,
    );
  }

  async function queuePendingFinalizeRequest(
    gameId: string,
    payload: CompleteGamePayload,
    lastError: string,
  ) {
    const existing = await getPendingFinalizeRequests();
    const withoutCurrent = existing.filter((item) => item.gameId !== gameId);

    const previous = existing.find((item) => item.gameId === gameId);
    const nextRecord: PendingFinalizeRequest = {
      gameId,
      payload,
      queuedAtIso: previous?.queuedAtIso ?? new Date().toISOString(),
      attempts: (previous?.attempts ?? 0) + 1,
      lastError,
    };

    await savePendingFinalizeRequests([...withoutCurrent, nextRecord]);
    setSyncState("queued");
    await refreshSyncStateFromQueue();
    trace("finalize.offline.queued", {
      gameId,
      attempts: nextRecord.attempts,
    });
  }

  async function getPendingQueueCount() {
    const [goalQueue, shotQueue, penaltyQueue, goalieQueue, finalizeQueue] =
      await Promise.all([
        getQueuedEventsForKey(GOAL_OFFLINE_QUEUE_KEY),
        getQueuedEventsForKey(SHOT_OFFLINE_QUEUE_KEY),
        getQueuedEventsForKey(PENALTY_OFFLINE_QUEUE_KEY),
        getQueuedEventsForKey(GOALIE_OFFLINE_QUEUE_KEY),
        getPendingFinalizeRequests(),
      ]);

    return (
      goalQueue.length +
      shotQueue.length +
      penaltyQueue.length +
      goalieQueue.length +
      finalizeQueue.length
    );
  }

  async function postCompletePayloadToBackend(
    gameId: string,
    completePayload: CompleteGamePayload,
  ) {
    const response = await fetch(`${activeApiBase}/games/${gameId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(completePayload),
    });

    if (!response.ok) {
      throw new Error(`Failed to complete game (${response.status}).`);
    }

    return (await response.json()) as CompletionResponse;
  }

  function buildLiveShotSummaryPayload(): LiveShotSummaryPayload {
    return {
      homeByPeriod: {
        p1: safeHomeShotsByPeriod[1],
        p2: safeHomeShotsByPeriod[2],
        p3: safeHomeShotsByPeriod[3],
        ot: safeHomeShotsByPeriod.OT,
      },
      awayByPeriod: {
        p1: safeAwayShotsByPeriod[1],
        p2: safeAwayShotsByPeriod[2],
        p3: safeAwayShotsByPeriod[3],
        ot: safeAwayShotsByPeriod.OT,
      },
      homeTotal: homeShotsTotal,
      awayTotal: awayShotsTotal,
    };
  }

  async function postLiveShotSummaryToBackend(
    gameId: string,
    shotSummary: LiveShotSummaryPayload,
  ) {
    const response = await fetch(
      `${activeApiBase}/games/${gameId}/shots-mobile`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shotSummary),
      },
    );

    if (!response.ok) {
      throw new Error(`Shot sync failed (${response.status}).`);
    }
  }

  async function syncLiveStatus(
    gameId: string,
    homeOnPP: boolean,
    awayOnPP: boolean,
    homeSkatersCount: number,
    awaySkatersCount: number,
    homeStarterIds: string[],
    awayStarterIds: string[],
  ) {
    try {
      await fetch(`${activeApiBase}/games/${gameId}/live-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeOnPowerPlay: homeOnPP,
          awayOnPowerPlay: awayOnPP,
          currentPeriod: session?.period ?? 1,
          homeSkatersOnIce: homeSkatersCount,
          awaySkatersOnIce: awaySkatersCount,
          homeStarterIds,
          awayStarterIds,
        }),
      });
    } catch {
      // Non-critical; GameView falls back to penalty-history inference.
    }
  }

  async function flushPendingFinalizeQueue() {
    try {
      const queued = await getPendingFinalizeRequests();
      if (queued.length === 0) return;

      const unsent: PendingFinalizeRequest[] = [];
      for (const request of queued) {
        try {
          const completion = await postCompletePayloadToBackend(
            request.gameId,
            request.payload,
          );
          if (completion?.emailRequested && !completion?.emailSent) {
            unsent.push({
              ...request,
              attempts: request.attempts + 1,
              lastError:
                completion?.emailError ??
                "Finalized but scoresheet email send failed.",
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          unsent.push({
            ...request,
            attempts: request.attempts + 1,
            lastError: message,
          });
        }
      }

      await savePendingFinalizeRequests(unsent);
      trace("finalize.offline.flush", {
        attempted: queued.length,
        remaining: unsent.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("finalize.offline.flush.error", { message });
      setSyncState("error");
    }
  }

  async function refreshSyncStateFromQueue() {
    try {
      const totalPending = await getPendingQueueCount();
      setPendingSyncCount(totalPending);

      if (totalPending > 0) {
        setSyncState("queued");
        return;
      }

      setSyncState((prev) => (prev === "syncing" ? prev : "up_to_date"));
    } catch {
      setSyncState("error");
    }
  }

  async function flushAllOfflineQueues() {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;

    try {
      const pendingBefore = await getPendingQueueCount();
      setPendingSyncCount(pendingBefore);
      if (pendingBefore === 0) {
        setSyncState("up_to_date");
        return;
      }

      setSyncState("syncing");
      await flushOfflineGoalQueue();
      await flushOfflineShotQueue();
      await flushOfflinePenaltyQueue();
      await flushOfflineGoalieQueue();
      await flushPendingFinalizeQueue();
      await refreshSyncStateFromQueue();
    } catch {
      setSyncState("error");
    } finally {
      syncInFlightRef.current = false;
    }
  }

  async function handleManualSyncPress() {
    await flushAllOfflineQueues();
    await refreshSyncStateFromQueue();
  }

  async function postGoalToBackend(event: GameFeedEvent) {
    if (!event.gameId) {
      throw new Error("Missing gameId for goal sync.");
    }

    if (event.eventType !== "Goal") {
      throw new Error("Invalid goal event payload.");
    }

    const payload = {
      TeamId: event.teamId,
      ScorerId: event.playerId,
      Assist1Id: event.assist1Id || null,
      Assist2Id: event.assist2Id || null,
      Period: event.period,
      TimeInPeriod: event.timeInPeriod,
      Strength: event.strength,
      ClientEventId: event.localId,
    };

    const response = await fetch(
      `${activeApiBase}/games/${event.gameId}/goals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(`Goal sync failed (${response.status}).`);
    }
  }

  async function syncGoalEvent(event: GameFeedEvent) {
    setSyncState("syncing");
    try {
      await postGoalToBackend(event);
      trace("goal.sync.success", { localId: event.localId });
      await refreshSyncStateFromQueue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("goal.sync.failed", { localId: event.localId, message });
      await offlineQueue(event);
      setGoalModalError("Offline: goal queued for later sync.");
    }
  }

  async function postShotToBackend(event: GameFeedEvent) {
    if (!event.gameId) {
      throw new Error("Missing gameId for shot sync.");
    }

    if (event.eventType !== "Shot") {
      throw new Error("Invalid shot event payload.");
    }

    const response = await fetch(
      `${activeApiBase}/games/${event.gameId}/shots/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          TeamId: event.teamId,
          Period: event.period,
          TimeInPeriod: event.timeInPeriod,
          ClientEventId: event.localId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shot event sync failed (${response.status}).`);
    }
  }

  async function syncShotEvent(event: GameFeedEvent) {
    setSyncState("syncing");
    try {
      await postShotToBackend(event);
      trace("shot.event.sync.success", { localId: event.localId });
      await refreshSyncStateFromQueue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("shot.event.sync.failed", { localId: event.localId, message });
      await offlineQueue(event);
    }
  }

  async function flushOfflineShotQueue() {
    try {
      const queued = await getQueuedEventsForKey(SHOT_OFFLINE_QUEUE_KEY);
      if (queued.length === 0) return;

      const unsent: GameFeedEvent[] = [];
      for (const item of queued) {
        try {
          await postShotToBackend(item);
        } catch {
          unsent.push(item);
        }
      }

      if (unsent.length === 0) {
        await storageRemoveItem(SHOT_OFFLINE_QUEUE_KEY);
      } else {
        await storageSetItem(SHOT_OFFLINE_QUEUE_KEY, JSON.stringify(unsent));
      }

      trace("shot.event.offline.flush", {
        attempted: queued.length,
        remaining: unsent.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("shot.event.offline.flush.error", { message });
    }
  }

  async function flushOfflineGoalQueue() {
    try {
      const raw = await storageGetItem(GOAL_OFFLINE_QUEUE_KEY);
      if (!raw) return;

      const queued = JSON.parse(raw) as GameFeedEvent[];
      if (!Array.isArray(queued) || queued.length === 0) return;

      const unsent: GameFeedEvent[] = [];
      for (const item of queued) {
        try {
          await postGoalToBackend(item);
        } catch {
          unsent.push(item);
        }
      }

      if (unsent.length === 0) {
        await storageRemoveItem(GOAL_OFFLINE_QUEUE_KEY);
      } else {
        await storageSetItem(GOAL_OFFLINE_QUEUE_KEY, JSON.stringify(unsent));
      }

      trace("goal.offline.flush", {
        attempted: queued.length,
        remaining: unsent.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("goal.offline.flush.error", { message });
    }
  }

  async function postPenaltyToBackend(event: GameFeedEvent) {
    if (!event.gameId) {
      throw new Error("Missing gameId for penalty sync.");
    }

    if (event.eventType !== "Penalty") {
      throw new Error("Invalid penalty event payload.");
    }

    const payload = {
      TeamId: event.teamId,
      PlayerId: event.playerId,
      Infraction: event.infraction,
      DurationMinutes: event.durationMinutes,
      PenaltyType: event.penaltyType,
      SuspensionBehavior: event.suspensionBehavior ?? null,
      RequiresRefereeNotes: event.requiresRefereeNotes ?? false,
      ReviewRequired: event.reviewRequired ?? false,
      Period: event.period,
      TimeInPeriod: event.timeInPeriod,
      ClientEventId: event.localId,
    };

    const response = await fetch(
      `${activeApiBase}/games/${event.gameId}/penalties`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(`Penalty sync failed (${response.status}).`);
    }
  }

  async function postGoalieToBackend(event: GameFeedEvent) {
    if (!event.gameId) {
      throw new Error("Missing gameId for goalie sync.");
    }

    if (event.eventType !== "Goalie") {
      throw new Error("Invalid goalie event payload.");
    }

    const payload = {
      TeamId: event.teamId,
      Period: event.period,
      TimeInPeriod: event.timeInPeriod,
      GoalieChangeKind: event.goalieChangeKind ?? "change",
      GoalieOldName: event.goalieOldName ?? null,
      GoalieNewName: event.goalieNewName ?? null,
      ClientEventId: event.localId,
    };

    const response = await fetch(
      `${activeApiBase}/games/${event.gameId}/goalies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(`Goalie sync failed (${response.status}).`);
    }
  }

  async function updateGoalieInBackend(event: GameFeedEvent) {
    if (!event.gameId) {
      throw new Error("Missing gameId for goalie update sync.");
    }

    if (event.eventType !== "Goalie") {
      throw new Error("Invalid goalie event payload.");
    }

    const payload = {
      TeamId: event.teamId,
      Period: event.period,
      TimeInPeriod: event.timeInPeriod,
      GoalieChangeKind: event.goalieChangeKind ?? "change",
      GoalieOldName: event.goalieOldName ?? null,
      GoalieNewName: event.goalieNewName ?? null,
      ClientEventId: event.localId,
    };

    const response = await fetch(
      `${activeApiBase}/games/${event.gameId}/goalies/${event.localId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(`Goalie update sync failed (${response.status}).`);
    }
  }

  async function updateEventTimingInBackend(event: GameFeedEvent) {
    if (!event.gameId)
      throw new Error("Missing gameId for event timing update.");
    const response = await fetch(
      `${activeApiBase}/games/${event.gameId}/events/${event.localId}/timing`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: event.eventType,
          period: event.period,
          timeInPeriod: event.timeInPeriod,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Event timing update failed (${response.status}).`);
    }
  }

  async function syncPenaltyEvent(event: GameFeedEvent) {
    setSyncState("syncing");
    try {
      await postPenaltyToBackend(event);
      trace("penalty.sync.success", { localId: event.localId });
      await refreshSyncStateFromQueue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("penalty.sync.failed", { localId: event.localId, message });
      await offlineQueue(event);
      setPenaltyModalError("Offline: penalty queued for later sync.");
    }
  }

  async function syncGoalieEvent(event: GameFeedEvent) {
    setSyncState("syncing");
    try {
      await postGoalieToBackend(event);
      trace("goalie.sync.success", { localId: event.localId });
      await refreshSyncStateFromQueue();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("goalie.sync.failed", { localId: event.localId, message });
      await offlineQueue(event);
    }
  }

  async function flushOfflinePenaltyQueue() {
    try {
      const raw = await storageGetItem(PENALTY_OFFLINE_QUEUE_KEY);
      if (!raw) return;

      const queued = JSON.parse(raw) as GameFeedEvent[];
      if (!Array.isArray(queued) || queued.length === 0) return;

      const unsent: GameFeedEvent[] = [];
      for (const item of queued) {
        try {
          await postPenaltyToBackend(item);
        } catch {
          unsent.push(item);
        }
      }

      if (unsent.length === 0) {
        await storageRemoveItem(PENALTY_OFFLINE_QUEUE_KEY);
      } else {
        await storageSetItem(PENALTY_OFFLINE_QUEUE_KEY, JSON.stringify(unsent));
      }

      trace("penalty.offline.flush", {
        attempted: queued.length,
        remaining: unsent.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("penalty.offline.flush.error", { message });
    }
  }

  async function flushOfflineGoalieQueue() {
    try {
      const raw = await storageGetItem(GOALIE_OFFLINE_QUEUE_KEY);
      if (!raw) return;

      const queued = JSON.parse(raw) as GameFeedEvent[];
      if (!Array.isArray(queued) || queued.length === 0) return;

      const unsent: GameFeedEvent[] = [];
      for (const item of queued) {
        try {
          await postGoalieToBackend(item);
        } catch {
          unsent.push(item);
        }
      }

      if (unsent.length === 0) {
        await storageRemoveItem(GOALIE_OFFLINE_QUEUE_KEY);
      } else {
        await storageSetItem(GOALIE_OFFLINE_QUEUE_KEY, JSON.stringify(unsent));
      }

      trace("goalie.offline.flush", {
        attempted: queued.length,
        remaining: unsent.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("goalie.offline.flush.error", { message });
    }
  }

  function handleGoalButtonPress(teamId: string) {
    if (!session || !canControlGame(session.role)) return;
    const teamName =
      teamId === homeTeamId ? session.homeTeam : session.awayTeam;
    const periodLengthMinutes = getPeriodLengthMinutes(session.periodLength);
    const elapsed = computeElapsedTime(periodLengthMinutes, session.clock);

    setResumeClockAfterGoalModal(false);

    openGoalModal({
      visible: true,
      scoringTeamId: teamId,
      scoringTeamName: teamName,
      period: session.period,
      clockRemaining: session.clock,
      timeInPeriod: elapsed,
      strength: getDefaultGoalType(teamId),
      scorerId: "",
      assist1Id: "",
      assist2Id: "",
    });
  }

  function closeGoalModal() {
    setGoalModalError("");
    setGoalModal(null);
    setResumeClockAfterGoalModal(false);
  }

  async function saveGoalEvent() {
    if (!session || !goalModal || !nextGame?.gameId) return;
    if (!goalModal.scorerId) {
      setGoalModalError("Goal scorer is required.");
      return;
    }

    const goalEvent: GameFeedEvent = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: nextGame.gameId,
      eventType: "Goal",
      teamId: goalModal.scoringTeamId,
      teamName: goalModal.scoringTeamName,
      playerId: goalModal.scorerId,
      playerName: findPlayerName(goalModal.scoringTeamId, goalModal.scorerId),
      assist1Id: goalModal.assist1Id || undefined,
      assist1Name: findPlayerName(goalModal.scoringTeamId, goalModal.assist1Id),
      assist2Id: goalModal.assist2Id || undefined,
      assist2Name: findPlayerName(goalModal.scoringTeamId, goalModal.assist2Id),
      period: goalModal.period,
      timeInPeriod: goalModal.timeInPeriod,
      strength: goalModal.strength,
      createdAtIso: new Date().toISOString(),
    };

    updateScore(goalModal.scoringTeamId);
    addEventToFeed(goalEvent);
    adjustShots(
      goalModal.scoringTeamId === homeTeamId ? "home" : "away",
      1,
      false,
    );
    autoReturnPulledGoalieIfNeeded(goalModal.scoringTeamId);

    const isHomeScoring = goalModal.scoringTeamId === homeTeamId;
    const scoringSkaters = isHomeScoring ? homeSkatersOnIce : awaySkatersOnIce;
    const defendingSkaters = isHomeScoring
      ? awaySkatersOnIce
      : homeSkatersOnIce;
    if (scoringSkaters > defendingSkaters) {
      expireMinorOnPowerPlayGoal(goalModal.scoringTeamId);
    }

    setPlayerStatsById((prev) => {
      const next = { ...prev };
      const scorer = next[goalModal.scorerId] ?? {
        goals: 0,
        assists: 0,
        shots: 0,
        penaltyMinutes: 0,
      };
      next[goalModal.scorerId] = {
        goals: scorer.goals + 1,
        assists: scorer.assists,
        shots: scorer.shots + 1,
        penaltyMinutes: scorer.penaltyMinutes,
      };

      if (goalModal.assist1Id) {
        const assist1 = next[goalModal.assist1Id] ?? {
          goals: 0,
          assists: 0,
          shots: 0,
          penaltyMinutes: 0,
        };
        next[goalModal.assist1Id] = {
          goals: assist1.goals,
          assists: assist1.assists + 1,
          shots: assist1.shots,
          penaltyMinutes: assist1.penaltyMinutes,
        };
      }

      if (goalModal.assist2Id) {
        const assist2 = next[goalModal.assist2Id] ?? {
          goals: 0,
          assists: 0,
          shots: 0,
          penaltyMinutes: 0,
        };
        next[goalModal.assist2Id] = {
          goals: assist2.goals,
          assists: assist2.assists + 1,
          shots: assist2.shots,
          penaltyMinutes: assist2.penaltyMinutes,
        };
      }

      return next;
    });

    setGoalModalError("");
    closeGoalModal();
    void syncGoalEvent(goalEvent);
  }

  function getPenaltyDurationMinutes(penaltyType: string) {
    return getPenaltyRule(penaltyType).durationMinutes;
  }

  function shouldAffectManpower(penaltyType: string) {
    return getPenaltyRule(penaltyType).affectsManpower;
  }

  function shouldRequireRefereeNotes(penaltyType: string) {
    return getPenaltyRule(penaltyType).requiresRefereeNotes;
  }

  function shouldRequireSuspensionReview(penaltyType: string) {
    return getPenaltyRule(penaltyType).reviewRequired;
  }

  function openPenaltyModal(prefilledData: PenaltyModalState) {
    setPenaltyModalError("");
    setPenaltyModal(prefilledData);
  }

  function handlePenaltyButtonPress(teamId: string) {
    if (!session || !canControlGame(session.role)) return;
    const teamName =
      teamId === homeTeamId ? session.homeTeam : session.awayTeam;
    const periodLengthMinutes = getPeriodLengthMinutes(session.periodLength);
    const elapsed = computeElapsedTime(periodLengthMinutes, session.clock);

    setResumeClockAfterPenaltyModal(false);

    openPenaltyModal({
      visible: true,
      penalizedTeamId: teamId,
      penalizedTeamName: teamName,
      period: session.period,
      clockRemaining: session.clock,
      timeInPeriod: elapsed,
      playerId: "",
      infraction: QUICK_PICK_INFRACTIONS[0],
      durationMinutes: getPenaltyDurationMinutes("Minor"),
      penaltyType: "Minor",
    });
  }

  function closePenaltyModal() {
    setPenaltyModalError("");
    setPenaltyModal(null);
    setResumeClockAfterPenaltyModal(false);
  }

  function openSetEditClockModal() {
    if (!session || !canControlGame(session.role)) return;
    if (isClockRunning) return;

    setClockModalMinutes(Math.floor(parseClockToSeconds(session.clock) / 60));
    setClockModalSeconds(parseClockToSeconds(session.clock) % 60);
    setShowClockModal(true);
  }

  function openTimeoutModal() {
    if (!session || !canControlGame(session.role)) return;
    if (isClockRunning && !isRunningTimeActive) return;

    const periodLengthMinutes = getPeriodLengthMinutes(session.periodLength);
    const elapsed = computeElapsedTime(periodLengthMinutes, session.clock);

    setTimeoutModal({
      visible: true,
      teamSide: "home",
      durationSeconds: 60,
      remainingSeconds: 60,
      isRunning: false,
      period: session.period,
      clockRemaining: session.clock,
      timeInPeriod: elapsed,
    });
  }

  function closeTimeoutModal() {
    setTimeoutModal(null);
  }

  function adjustTimeoutDuration(deltaSeconds: number) {
    setTimeoutModal((prev) => {
      if (!prev) return prev;
      if (prev.isRunning) return prev;
      const next = Math.max(
        30,
        Math.min(600, prev.durationSeconds + deltaSeconds),
      );
      return {
        ...prev,
        durationSeconds: next,
        remainingSeconds: next,
      };
    });
  }

  function startTimeoutCountdown() {
    setTimeoutModal((prev) => {
      if (!prev || prev.isRunning) return prev;
      return {
        ...prev,
        isRunning: true,
        remainingSeconds: prev.durationSeconds,
      };
    });
  }

  function saveTimeoutEvent() {
    if (!timeoutModal || !nextGame?.gameId || !session) return;

    const selectedTeamId =
      timeoutModal.teamSide === "home" ? homeTeamId : awayTeamId;
    const selectedTeamName =
      timeoutModal.teamSide === "home" ? session.homeTeam : session.awayTeam;

    if (!selectedTeamId) {
      closeTimeoutModal();
      return;
    }

    const timeoutEvent: GameFeedEvent = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: nextGame.gameId,
      eventType: "Timeout",
      teamId: selectedTeamId,
      teamName: selectedTeamName,
      timeoutDurationSeconds: timeoutModal.durationSeconds,
      period: timeoutModal.period,
      timeInPeriod: timeoutModal.timeInPeriod,
      strength: "Even Strength",
      createdAtIso: new Date().toISOString(),
    };

    addEventToFeed(timeoutEvent);
    closeTimeoutModal();
  }

  useEffect(() => {
    if (!timeoutModal?.visible || !timeoutModal.isRunning) return;
    if (timeoutModal.remainingSeconds <= 0) return;

    const timer = setTimeout(() => {
      setTimeoutModal((prev) => {
        if (!prev || !prev.visible || !prev.isRunning) return prev;
        return {
          ...prev,
          remainingSeconds: Math.max(0, prev.remainingSeconds - 1),
        };
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    timeoutModal?.visible,
    timeoutModal?.isRunning,
    timeoutModal?.remainingSeconds,
  ]);

  useEffect(() => {
    if (!timeoutModal?.visible || !timeoutModal.isRunning) return;
    if (timeoutModal.remainingSeconds !== 0) return;

    saveTimeoutEvent();
  }, [
    timeoutModal?.visible,
    timeoutModal?.isRunning,
    timeoutModal?.remainingSeconds,
  ]);

  function applyScheduledPeriodLengthToClock() {
    if (!session) return;
    const scheduledSeconds = getPeriodLengthMinutes(session.periodLength) * 60;
    const scheduledMs = scheduledSeconds * 1000;
    gameClock.syncPausedRemaining(scheduledMs, scheduledMs);
    updateSession({ clock: formatSecondsToClock(scheduledSeconds) });
    setClockModalMinutes(Math.floor(scheduledSeconds / 60));
    setClockModalSeconds(scheduledSeconds % 60);
  }

  function adjustManualClock(deltaSeconds: number) {
    const currentTotal = clockModalMinutes * 60 + clockModalSeconds;
    const nextTotal = Math.max(
      0,
      Math.min(60 * 60, currentTotal + deltaSeconds),
    );
    setClockModalMinutes(Math.floor(nextTotal / 60));
    setClockModalSeconds(nextTotal % 60);
  }

  function shiftPenaltyTimersForClockAdjustment(deltaSeconds: number) {
    if (!deltaSeconds) return;

    setActivePenalties((prev) =>
      prev.map((penalty) => {
        const maxSeconds = Math.max(0, penalty.durationMinutes * 60);
        return {
          ...penalty,
          remainingSeconds: Math.max(
            -maxSeconds,
            Math.min(maxSeconds, penalty.remainingSeconds + deltaSeconds),
          ),
        };
      }),
    );
  }

  function adjustPenaltyRemainingTime(penaltyId: string, deltaSeconds: number) {
    if (!session || !canControlGame(session.role) || !deltaSeconds) return;

    setActivePenalties((prev) =>
      prev.map((penalty) => {
        if (penalty.id !== penaltyId) return penalty;

        const maxSeconds = Math.max(0, penalty.durationMinutes * 60);
        return {
          ...penalty,
          remainingSeconds: Math.max(
            -maxSeconds,
            Math.min(maxSeconds, penalty.remainingSeconds + deltaSeconds),
          ),
        };
      }),
    );
  }

  function openPenaltyAdjustModal(penalty: ActivePenalty) {
    if (!session || !canControlGame(session.role) || isClockRunning) return;

    setPenaltyAdjustModal({
      visible: true,
      penaltyId: penalty.id,
      teamName: penalty.teamName,
      playerName: penalty.playerName,
      infraction: penalty.infraction,
      currentSeconds: penalty.remainingSeconds,
      durationMinutes: penalty.durationMinutes,
      deltaSeconds: 0,
    });
  }

  function closePenaltyAdjustModal() {
    setPenaltyAdjustModal(null);
  }

  function shiftPenaltyAdjustPreview(deltaSeconds: number) {
    setPenaltyAdjustModal((prev) => {
      if (!prev) return prev;

      const maxSeconds = Math.max(0, prev.durationMinutes * 60);
      const nextDelta = prev.deltaSeconds + deltaSeconds;
      const previewSeconds = Math.max(
        -maxSeconds,
        Math.min(maxSeconds, prev.currentSeconds + nextDelta),
      );

      return {
        ...prev,
        deltaSeconds: previewSeconds - prev.currentSeconds,
      };
    });
  }

  function applyPenaltyAdjustModal() {
    if (!penaltyAdjustModal || !session || !canControlGame(session.role))
      return;

    adjustPenaltyRemainingTime(
      penaltyAdjustModal.penaltyId,
      penaltyAdjustModal.deltaSeconds,
    );
    closePenaltyAdjustModal();
  }

  function applyManualClockAdjustment() {
    if (!session) return;
    const currentSeconds = parseClockToSeconds(session.clock);
    const nextSeconds = Math.max(0, clockModalMinutes * 60 + clockModalSeconds);
    const deltaSeconds = nextSeconds - currentSeconds;
    shiftPenaltyTimersForClockAdjustment(deltaSeconds);
    gameClock.syncPausedRemaining(
      nextSeconds * 1000,
      getPeriodLengthMinutes(session.periodLength) * 60 * 1000,
    );
    updateSession({ clock: formatSecondsToClock(nextSeconds) });
    setShowClockModal(false);
  }

  async function savePenaltyEvent() {
    if (!penaltyModal || !nextGame?.gameId) return;
    if (!penaltyModal.playerId) {
      setPenaltyModalError("Penalized player is required.");
      return;
    }

    const normalizedPenaltyType = normalizePenaltyType(
      penaltyModal.penaltyType,
    );
    const normalizedDuration = getPenaltyDurationMinutes(normalizedPenaltyType);

    const isMinorPenalty =
      normalizedPenaltyType === "Minor" ||
      normalizedPenaltyType === "Double Minor" ||
      normalizedPenaltyType === "Bench Minor";
    const counterpartCoincidental = isMinorPenalty
      ? activePenalties.find(
          (penalty) =>
            penalty.teamId !== penaltyModal.penalizedTeamId &&
            (penalty.penaltyType === "Minor" ||
              penalty.penaltyType === "Double Minor" ||
              penalty.penaltyType === "Bench Minor") &&
            penalty.period === penaltyModal.period &&
            penalty.timeInPeriod === penaltyModal.timeInPeriod,
        )
      : undefined;

    const penaltyEvent: GameFeedEvent = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: nextGame.gameId,
      eventType: "Penalty",
      teamId: penaltyModal.penalizedTeamId,
      teamName: penaltyModal.penalizedTeamName,
      playerId: penaltyModal.playerId,
      playerName: findPlayerName(
        penaltyModal.penalizedTeamId,
        penaltyModal.playerId,
      ),
      infraction: penaltyModal.infraction,
      durationMinutes: normalizedDuration,
      penaltyType: normalizedPenaltyType,
      suspensionBehavior: getPenaltyRule(normalizedPenaltyType)
        .suspensionBehavior,
      requiresRefereeNotes: shouldRequireRefereeNotes(normalizedPenaltyType),
      reviewRequired: shouldRequireSuspensionReview(normalizedPenaltyType),
      period: penaltyModal.period,
      timeInPeriod: penaltyModal.timeInPeriod,
      strength: "Even Strength",
      coincidental: Boolean(counterpartCoincidental),
      createdAtIso: new Date().toISOString(),
    };

    addEventToFeed(penaltyEvent);

    setPlayerStatsById((prev) => {
      const current = prev[penaltyModal.playerId] ?? {
        goals: 0,
        assists: 0,
        shots: 0,
        penaltyMinutes: 0,
      };
      return {
        ...prev,
        [penaltyModal.playerId]: {
          ...current,
          penaltyMinutes: current.penaltyMinutes + normalizedDuration,
        },
      };
    });

    setTeamPenaltyCountById((prev) => ({
      ...prev,
      [penaltyModal.penalizedTeamId]:
        (prev[penaltyModal.penalizedTeamId] ?? 0) + 1,
    }));

    setActivePenalties((prev) => {
      const newPenalty: ActivePenalty = {
        id: penaltyEvent.localId,
        teamId: penaltyModal.penalizedTeamId,
        teamName: penaltyModal.penalizedTeamName,
        playerId: penaltyModal.playerId,
        playerName: findPlayerName(
          penaltyModal.penalizedTeamId,
          penaltyModal.playerId,
        ),
        infraction: penaltyModal.infraction,
        remainingSeconds: normalizedDuration * 60,
        durationMinutes: normalizedDuration,
        penaltyType: normalizedPenaltyType,
        affectsManpower: shouldAffectManpower(normalizedPenaltyType),
        isCoincidentalMinor: Boolean(counterpartCoincidental),
        suspensionBehavior: getPenaltyRule(normalizedPenaltyType)
          .suspensionBehavior,
        requiresRefereeNotes: shouldRequireRefereeNotes(normalizedPenaltyType),
        reviewRequired: shouldRequireSuspensionReview(normalizedPenaltyType),
        startedAtIso: penaltyEvent.createdAtIso,
        period: penaltyModal.period,
        timeInPeriod: penaltyModal.timeInPeriod,
      };

      if (!counterpartCoincidental) {
        return [...prev, newPenalty];
      }

      return [
        ...prev.map((penalty) =>
          penalty.id === counterpartCoincidental.id
            ? {
                ...penalty,
                isCoincidentalMinor: true,
                affectsManpower: false,
              }
            : penalty,
        ),
        {
          ...newPenalty,
          affectsManpower: false,
        },
      ];
    });

    setPenaltyModalError("");
    closePenaltyModal();
    void syncPenaltyEvent(penaltyEvent);
  }

  function handleClockToggle() {
    if (!session || !canControlGame(session.role) || isAnyModalOpen) return;

    if (periodController.state === "NOT_STARTED") {
      setPeriodController((prev) => ({ ...prev, state: "IN_PROGRESS" }));
    }

    const periodDurationMs =
      getPeriodLengthMinutes(session.periodLength) * 60 * 1000;

    if (isClockRunning) {
      gameClock.pause();
      setIsClockRunning(false);
      return;
    }

    gameClock.setDuration(periodDurationMs);
    gameClock.syncPausedRemaining(
      parseClockDisplayToMs(session.clock),
      periodDurationMs,
    );
    penaltyClockPrevRemainingMsRef.current = gameClock.remainingTimeMs;
    penaltyClockCarryMsRef.current = 0;
    gameClock.resume();
    setIsClockRunning(true);
  }

  function startIntermission() {
    setIsClockRunning(false);
    gameClock.pause();
    gameClock.syncPausedRemaining(0, gameClock.periodDurationMs);
    setIntermissionSeconds(0);
    setPeriodController((prev) => ({ ...prev, state: "INTERMISSION" }));
    updateSession({ clock: "00:00" });
  }

  function confirmPeriodOver() {
    if (!session) return;
    setShowPeriodOverVerify(false);

    if (!periodController.isOvertime && session.period >= 3) {
      setShowEndOfRegulation(true);
      return;
    }

    startIntermission();
  }

  function handlePeriodControlButtonPress() {
    if (!session || !canControlGame(session.role) || isAnyModalOpen) return;
    if (periodController.state === "INTERMISSION") {
      setShowResumeVerify(true);
    }
  }

  function confirmResumeFromIntermission() {
    if (!session) return;
    setShowResumeVerify(false);

    const nextPeriod = periodController.isOvertime
      ? session.period + 1
      : Math.min(4, session.period + 1);
    const resetClock = formatSecondsToClock(
      getPeriodLengthMinutes(session.periodLength) * 60,
    );
    updateSession({
      period: nextPeriod,
      clock: resetClock,
    });
    const resetMs = getPeriodLengthMinutes(session.periodLength) * 60 * 1000;
    gameClock.syncPausedRemaining(resetMs, resetMs);
    gameClock.pause();
    setPeriodController((prev) => ({ ...prev, state: "IN_PROGRESS" }));
    setIntermissionSeconds(0);
    setIsClockRunning(false);
  }

  function handleGoToOvertime() {
    if (!session) return;
    setShowEndOfRegulation(false);
    setPeriodController({
      state: "INTERMISSION",
      isOvertime: true,
    });
    setIntermissionSeconds(0);
    setIsClockRunning(false);
    gameClock.pause();
    gameClock.syncPausedRemaining(0, gameClock.periodDurationMs);
    updateSession({ clock: "00:00" });
  }

  function openGoalieChangeModal(side: "home" | "away") {
    if (!session || !canControlGame(session.role)) return;
    const teamId = side === "home" ? homeTeamId : awayTeamId;
    const teamName = side === "home" ? session.homeTeam : session.awayTeam;
    const goalieOptions = getRosterForTeam(teamId).filter(
      (player) => player.isGoalie && player.isActive,
    );
    setGoalieModal({
      visible: true,
      side,
      teamId,
      teamName,
      selectedGoalieId:
        currentGoalieByTeam[teamId] ?? goalieOptions[0]?.playerId ?? "",
    });
  }

  function closeGoalieChangeModal() {
    setGoalieModal(null);
  }

  function openThemedDropdown(config: ThemedDropdownState) {
    setActiveDropdown(config);
  }

  function closeThemedDropdown() {
    setActiveDropdown(null);
  }

  function selectThemedDropdownValue(value: string) {
    if (!activeDropdown) return;
    activeDropdown.onSelect(value);
    setActiveDropdown(null);
  }

  function appendGoalieEvent(
    teamId: string,
    teamName: string,
    kind: "change" | "pulled" | "returned",
    oldGoalieName?: string,
    newGoalieName?: string,
  ) {
    const context = getClockContext();
    const event: GameFeedEvent = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: nextGame?.gameId ?? "",
      eventType: "Goalie",
      teamId,
      teamName,
      period: context.period,
      timeInPeriod: context.timeInPeriod,
      strength: "Even Strength",
      goalieOldName: oldGoalieName,
      goalieNewName: newGoalieName,
      goalieChangeKind: kind,
      createdAtIso: new Date().toISOString(),
    };
    addEventToFeed(event);
    void syncGoalieEvent(event);
  }

  function applyGoalieChange() {
    if (!goalieModal) return;
    const oldGoalieId = currentGoalieByTeam[goalieModal.teamId] ?? null;
    const oldGoalieName = oldGoalieId
      ? findPlayerName(goalieModal.teamId, oldGoalieId)
      : "None";
    const newGoalieName = goalieModal.selectedGoalieId
      ? findPlayerName(goalieModal.teamId, goalieModal.selectedGoalieId)
      : "None";

    setCurrentGoalieByTeam((prev) => ({
      ...prev,
      [goalieModal.teamId]: goalieModal.selectedGoalieId || null,
    }));

    if (goalieModal.side === "home") {
      setHomeGoaliePulled(false);
    } else {
      setAwayGoaliePulled(false);
    }

    appendGoalieEvent(
      goalieModal.teamId,
      goalieModal.teamName,
      "change",
      oldGoalieName,
      newGoalieName,
    );
    closeGoalieChangeModal();
  }

  function toggleGoaliePulledFromModal() {
    if (!goalieModal) return;
    const isHome = goalieModal.side === "home";
    const isPulledNow = isHome ? homeGoaliePulled : awayGoaliePulled;
    const oldGoalieId = currentGoalieByTeam[goalieModal.teamId] ?? null;
    const oldGoalieName = oldGoalieId
      ? findPlayerName(goalieModal.teamId, oldGoalieId)
      : "None";

    if (isHome) {
      setHomeGoaliePulled((prev) => !prev);
    } else {
      setAwayGoaliePulled((prev) => !prev);
    }

    appendGoalieEvent(
      goalieModal.teamId,
      goalieModal.teamName,
      isPulledNow ? "returned" : "pulled",
      oldGoalieName,
      oldGoalieName,
    );
    closeGoalieChangeModal();
  }

  function updateDerivedStateFromEvents(nextEvents: GameFeedEvent[]) {
    setEventFeed(nextEvents);

    if (session) {
      const homeScore = nextEvents.filter(
        (event) => event.eventType === "Goal" && event.teamId === homeTeamId,
      ).length;
      const awayScore = nextEvents.filter(
        (event) => event.eventType === "Goal" && event.teamId === awayTeamId,
      ).length;
      updateSession({ homeScore, awayScore });
    }

    const nextPenaltyCounts = nextEvents
      .filter((event) => event.eventType === "Penalty")
      .reduce<Record<string, number>>((acc, event) => {
        acc[event.teamId] = (acc[event.teamId] ?? 0) + 1;
        return acc;
      }, {});
    setTeamPenaltyCountById(nextPenaltyCounts);
  }

  function openEventActions(event: GameFeedEvent) {
    setEventActionModal({
      visible: true,
      event,
    });
  }

  function closeEventActions() {
    setEventActionModal(null);
  }

  function requestDeleteSelectedEvent() {
    if (!eventActionModal) return;
    setEventDeleteConfirmModal({
      visible: true,
      event: eventActionModal.event,
    });
    closeEventActions();
  }

  function closeEventDeleteConfirmModal() {
    setEventDeleteConfirmModal(null);
  }

  function openEventEditModal(event: GameFeedEvent) {
    setEventEditModalError("");
    setEventEditModal({
      visible: true,
      event,
      teamId: event.teamId,
      period: event.period,
      timeInPeriod: event.timeInPeriod,
      playerId: event.playerId ?? "",
      assist1Id: event.assist1Id ?? "",
      assist2Id: event.assist2Id ?? "",
      infraction: event.infraction ?? QUICK_PICK_INFRACTIONS[0],
      durationMinutes:
        event.durationMinutes ??
        getPenaltyDurationMinutes(event.penaltyType ?? "Minor"),
      penaltyType: normalizePenaltyType(event.penaltyType),
      strength: event.strength,
      goalieOldName: event.goalieOldName ?? "",
      goalieNewName: event.goalieNewName ?? "",
      goalieChangeKind: event.goalieChangeKind ?? "change",
    });
    closeEventActions();
  }

  function closeEventEditModal() {
    setEventEditModalError("");
    setEventEditModal(null);
  }

  async function saveEventEdit() {
    if (!eventEditModal) return;

    const timeMatch = eventEditModal.timeInPeriod
      .trim()
      .match(/^(\d{1,2}):([0-5]\d)$/);
    if (!timeMatch) {
      setEventEditModalError("Enter time in MM:SS format.");
      return;
    }
    const eventTimeSeconds = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    const periodLengthSeconds =
      getPeriodLengthMinutes(session?.periodLength ?? "") * 60;
    if (eventTimeSeconds > periodLengthSeconds) {
      setEventEditModalError(
        `Time cannot exceed ${formatSecondsToClock(periodLengthSeconds)}.`,
      );
      return;
    }
    if (eventEditModal.period < 1 || eventEditModal.period > 4) {
      setEventEditModalError("Select a valid period.");
      return;
    }

    if (eventEditModal.event.eventType === "Goal" && !eventEditModal.playerId) {
      setEventEditModalError("Goal scorer is required.");
      return;
    }

    if (
      eventEditModal.event.eventType === "Penalty" &&
      !eventEditModal.playerId
    ) {
      setEventEditModalError("Penalized player is required.");
      return;
    }

    const normalizedTimeInPeriod = formatSecondsToClock(eventTimeSeconds);
    try {
      await updateEventTimingInBackend({
        ...eventEditModal.event,
        period: eventEditModal.period,
        timeInPeriod: normalizedTimeInPeriod,
      });
    } catch (err) {
      setEventEditModalError(err instanceof Error ? err.message : String(err));
      return;
    }

    setEventEditModalError("");

    const eventId = eventEditModal.event.localId;
    const nextEvents = eventFeed.map((event) => {
      if (event.localId !== eventId) return event;
      const normalizedPenaltyType = normalizePenaltyType(
        eventEditModal.penaltyType,
      );
      const normalizedPenaltyRule = getPenaltyRule(normalizedPenaltyType);
      return {
        ...event,
        teamId: eventEditModal.teamId,
        teamName:
          eventEditModal.teamId === homeTeamId
            ? (session?.homeTeam ?? event.teamName)
            : eventEditModal.teamId === awayTeamId
              ? (session?.awayTeam ?? event.teamName)
              : event.teamName,
        period: eventEditModal.period,
        timeInPeriod: normalizedTimeInPeriod,
        playerId: eventEditModal.playerId,
        playerName: findPlayerName(
          eventEditModal.teamId,
          eventEditModal.playerId,
        ),
        assist1Id: eventEditModal.assist1Id || undefined,
        assist1Name: findPlayerName(
          eventEditModal.teamId,
          eventEditModal.assist1Id,
        ),
        assist2Id: eventEditModal.assist2Id || undefined,
        assist2Name: findPlayerName(
          eventEditModal.teamId,
          eventEditModal.assist2Id,
        ),
        infraction: eventEditModal.infraction,
        durationMinutes: normalizedPenaltyRule.durationMinutes,
        penaltyType: normalizedPenaltyType,
        suspensionBehavior: normalizedPenaltyRule.suspensionBehavior,
        requiresRefereeNotes: normalizedPenaltyRule.requiresRefereeNotes,
        reviewRequired: normalizedPenaltyRule.reviewRequired,
        strength: eventEditModal.strength,
        goalieOldName: eventEditModal.goalieOldName,
        goalieNewName: eventEditModal.goalieNewName,
        goalieChangeKind: eventEditModal.goalieChangeKind,
      };
    });

    if (eventEditModal.event.eventType === "Penalty") {
      setActivePenalties((prev) =>
        prev.map((penalty) =>
          penalty.id !== eventId
            ? penalty
            : {
                ...penalty,
                teamId: eventEditModal.teamId,
                teamName:
                  eventEditModal.teamId === homeTeamId
                    ? (session?.homeTeam ?? penalty.teamName)
                    : eventEditModal.teamId === awayTeamId
                      ? (session?.awayTeam ?? penalty.teamName)
                      : penalty.teamName,
                playerId: eventEditModal.playerId,
                playerName: findPlayerName(
                  eventEditModal.teamId,
                  eventEditModal.playerId,
                ),
                infraction: eventEditModal.infraction,
                remainingSeconds:
                  getPenaltyDurationMinutes(eventEditModal.penaltyType) * 60,
                durationMinutes: getPenaltyDurationMinutes(
                  eventEditModal.penaltyType,
                ),
                penaltyType: normalizePenaltyType(eventEditModal.penaltyType),
                affectsManpower:
                  shouldAffectManpower(eventEditModal.penaltyType) &&
                  !Boolean(penalty.isCoincidentalMinor),
                suspensionBehavior: getPenaltyRule(eventEditModal.penaltyType)
                  .suspensionBehavior,
                requiresRefereeNotes: getPenaltyRule(eventEditModal.penaltyType)
                  .requiresRefereeNotes,
                reviewRequired: getPenaltyRule(eventEditModal.penaltyType)
                  .reviewRequired,
                period: eventEditModal.period,
                timeInPeriod: normalizedTimeInPeriod,
              },
        ),
      );
    }

    updateDerivedStateFromEvents(nextEvents);

    if (eventEditModal.event.eventType === "Goalie") {
      const updatedGoalieEvent = nextEvents.find(
        (event) => event.localId === eventEditModal.event.localId,
      );
      if (updatedGoalieEvent) {
        try {
          await updateGoalieInBackend(updatedGoalieEvent);
          trace("goalie.update.sync.success", {
            localId: updatedGoalieEvent.localId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          trace("goalie.update.sync.failed", {
            localId: updatedGoalieEvent.localId,
            message,
          });
        }
      }
    }

    closeEventEditModal();
  }

  async function deleteEventFromBackend(event: GameFeedEvent) {
    if (!event.gameId) return;
    try {
      if (event.eventType === "Goal") {
        await fetch(
          `${activeApiBase}/games/${event.gameId}/goals/${event.localId}`,
          { method: "DELETE" },
        );
      }
      if (event.eventType === "Penalty") {
        await fetch(
          `${activeApiBase}/games/${event.gameId}/penalties/${event.localId}`,
          { method: "DELETE" },
        );
      }
      if (event.eventType === "Goalie") {
        await fetch(
          `${activeApiBase}/games/${event.gameId}/goalies/${event.localId}`,
          { method: "DELETE" },
        );
      }
      if (event.eventType === "Shot") {
        await fetch(
          `${activeApiBase}/games/${event.gameId}/shots/events/${event.localId}`,
          { method: "DELETE" },
        );
      }
    } catch {
      // Backend delete is best-effort to keep local editing responsive.
    }
  }

  async function deleteSelectedEvent() {
    if (!eventDeleteConfirmModal) return;
    const event = eventDeleteConfirmModal.event;
    const nextEvents = eventFeed.filter(
      (item) => item.localId !== event.localId,
    );
    updateDerivedStateFromEvents(nextEvents);

    if (event.eventType === "Penalty") {
      setActivePenalties((prev) =>
        prev.filter((penalty) => penalty.id !== event.localId),
      );
    }

    if (event.eventType === "Shot") {
      const team = event.teamId === homeTeamId ? "home" : "away";
      const transitioned = transitionShotTotals(
        homeShotsByPeriod,
        awayShotsByPeriod,
        { team, period: event.period, delta: -1 },
      );
      setHomeShotsByPeriod(transitioned.home);
      setAwayShotsByPeriod(transitioned.away);
      const queuedShots = await getQueuedEventsForKey(SHOT_OFFLINE_QUEUE_KEY);
      await storageSetItem(
        SHOT_OFFLINE_QUEUE_KEY,
        JSON.stringify(
          queuedShots.filter((queued) => queued.localId !== event.localId),
        ),
      );
    }

    await deleteEventFromBackend(event);
    closeEventDeleteConfirmModal();
  }

  async function fetchTeamsForUser(userId: string) {
    const url = `${activeApiBase}/users/${userId}/teams`;
    trace("teams.fetch.start", { userId, url });

    const response = await fetch(url);
    trace("teams.fetch.response", { status: response.status, ok: response.ok });

    const payload = await response.json();
    trace("teams.fetch.payload", summarizePayload(payload));

    if (!response.ok) {
      throw new Error(`Failed to load teams for user ${userId}.`);
    }

    return Array.isArray(payload) ? (payload as TeamAssignment[]) : [];
  }

  async function fetchNextGameForTeam(
    teamId: string,
  ): Promise<NextGameLookupResult> {
    const url = `${activeApiBase}/teams/${teamId}/nextgame`;
    trace("nextgame.fetch.start", { teamId, url });

    const response = await fetch(url);
    trace("nextgame.fetch.response", {
      teamId,
      status: response.status,
      ok: response.ok,
    });

    const payload = (await response.json()) as Record<string, unknown> | null;
    trace("nextgame.fetch.payload", summarizePayload(payload));

    const payloadIsClosed =
      payload?.isClosed === true ||
      payload?.IsClosed === true ||
      ["COMPLETED", "CLOSED", "FINAL"].includes(
        String(payload?.status ?? payload?.Status ?? "").toUpperCase(),
      );

    if (!response.ok || payloadIsClosed) {
      if (response.status === 410 || response.status === 425) {
        const closedMessage =
          (typeof payload?.Message === "string" && payload.Message) ||
          (typeof payload?.message === "string" && payload.message) ||
          "The scheduled game is closed.";
        return { nextGame: null, closedMessage };
      }
      if (payloadIsClosed) {
        const closedMessage =
          (typeof payload?.Message === "string" && payload.Message) ||
          (typeof payload?.message === "string" && payload.message) ||
          "This game has been finalized and can no longer be managed.";
        return { nextGame: null, closedMessage };
      }
      return { nextGame: null };
    }

    if (!payload || typeof payload !== "object") return { nextGame: null };
    const nextGame = normalizeNextGame(teamId, payload);
    if (!nextGame) return { nextGame: null };

    const unavailableMessage = getGameLoginUnavailableMessage(nextGame, teamId);
    return unavailableMessage
      ? { nextGame: null, closedMessage: unavailableMessage }
      : { nextGame };
  }

  async function fetchRosterForTeam(teamId: string) {
    const url = `${activeApiBase}/teams/${teamId}/roster-mobile`;
    trace("roster.fetch.start", { teamId, url });

    const response = await fetch(url);
    trace("roster.fetch.response", {
      teamId,
      status: response.status,
      ok: response.ok,
    });

    const payload = await response.json();
    trace("roster.fetch.payload", summarizePayload(payload));

    if (!response.ok) {
      throw new Error(`Failed to load roster for ${teamId}.`);
    }

    if (!Array.isArray(payload)) return [];

    return payload.map((entry) => {
      const row = entry as Record<string, unknown>;
      const positionValue =
        (typeof row.position === "string" && row.position) ||
        (typeof row.Position === "string" && row.Position) ||
        "-";
      const goalieFlag =
        (typeof row.isGoalie === "boolean" && row.isGoalie) ||
        (typeof row.IsGoalie === "boolean" && row.IsGoalie) ||
        /^g$/i.test(positionValue.trim());

      return {
        playerId:
          (typeof row.playerId === "string" && row.playerId) ||
          (typeof row.PlayerId === "string" && row.PlayerId) ||
          "",
        fullName:
          (typeof row.fullName === "string" && row.fullName) ||
          (typeof row.FullName === "string" && row.FullName) ||
          "Unknown Player",
        jerseyNumber:
          (typeof row.jerseyNumber === "number" && row.jerseyNumber) ||
          (typeof row.JerseyNumber === "number" && row.JerseyNumber) ||
          null,
        position: positionValue,
        grade:
          (typeof row.grade === "number" && row.grade) ||
          (typeof row.Grade === "number" && row.Grade) ||
          null,
        isGoalie: goalieFlag,
        isActive:
          (typeof row.isActive === "boolean" && row.isActive) ||
          (typeof row.IsActive === "boolean" && row.IsActive) ||
          false,
      } as RosterPlayer;
    });
  }

  async function fetchCoachesForTeam(teamId: string) {
    const url = `${activeApiBase}/teams/${teamId}/coaches-mobile`;
    trace("coaches.fetch.start", { teamId, url });

    const response = await fetch(url);
    trace("coaches.fetch.response", {
      teamId,
      status: response.status,
      ok: response.ok,
    });

    const payload = await response.json();
    trace("coaches.fetch.payload", summarizePayload(payload));

    if (!response.ok) {
      throw new Error(`Failed to load coaches for ${teamId}.`);
    }

    if (!Array.isArray(payload)) return [];

    return payload
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          roleName:
            (typeof row.roleName === "string" && row.roleName) ||
            (typeof row.RoleName === "string" && row.RoleName) ||
            "Coach",
          coachName:
            (typeof row.coachName === "string" && row.coachName) ||
            (typeof row.CoachName === "string" && row.CoachName) ||
            "",
          coachEmail:
            (typeof row.coachEmail === "string" && row.coachEmail) ||
            (typeof row.CoachEmail === "string" && row.CoachEmail) ||
            null,
        } as TeamCoach;
      })
      .filter((coach) => coach.coachName.trim().length > 0);
  }

  async function fetchOfficialsForGame(gameId: string) {
    const url = `${activeApiBase}/games/${gameId}/officials/verification`;
    trace("officials.fetch.start", { gameId, url });

    const response = await fetch(url);
    trace("officials.fetch.response", {
      status: response.status,
      ok: response.ok,
    });

    const payload = await response.json();
    trace("officials.fetch.payload", summarizePayload(payload));

    if (!response.ok) {
      throw new Error("Failed to load officials for scheduled game.");
    }

    const rawOfficials = Array.isArray(
      (payload as Record<string, unknown>)?.officials,
    )
      ? ((payload as Record<string, unknown>).officials as unknown[])
      : [];

    const normalizedOfficials = rawOfficials.map((entry) => {
      const row = entry as Record<string, unknown>;
      const rawRole =
        (typeof row.role === "string" && row.role) ||
        (typeof row.Role === "string" && row.Role) ||
        "Official";
      return {
        role: normalizeOfficialAssignmentRole(rawRole),
        officialName:
          (typeof row.officialName === "string" && row.officialName) ||
          (typeof row.OfficialName === "string" && row.OfficialName) ||
          "Not assigned",
        officialId:
          (typeof row.officialId === "string" && row.officialId) ||
          (typeof row.OfficialId === "string" && row.OfficialId) ||
          undefined,
        officialEmail:
          (typeof row.officialEmail === "string" && row.officialEmail) ||
          (typeof row.OfficialEmail === "string" && row.OfficialEmail) ||
          null,
        signatureImageBase64:
          (typeof row.signatureImageBase64 === "string" &&
            row.signatureImageBase64) ||
          (typeof row.SignatureImageBase64 === "string" &&
            row.SignatureImageBase64) ||
          null,
        signedByName:
          (typeof row.signedByName === "string" && row.signedByName) ||
          (typeof row.SignedByName === "string" && row.SignedByName) ||
          null,
        signedAtUtc:
          (typeof row.signedAtUtc === "string" && row.signedAtUtc) ||
          (typeof row.SignedAtUtc === "string" && row.SignedAtUtc) ||
          null,
      } as OfficialVerification;
    });
    const officialsByRole = new Map<string, OfficialVerification>();
    normalizedOfficials.forEach((official) => {
      if (!officialsByRole.has(official.role))
        officialsByRole.set(official.role, official);
    });
    return [...officialsByRole.values()].sort(
      (left, right) =>
        OFFICIAL_ASSIGNMENT_ROLES.indexOf(
          left.role as (typeof OFFICIAL_ASSIGNMENT_ROLES)[number],
        ) -
        OFFICIAL_ASSIGNMENT_ROLES.indexOf(
          right.role as (typeof OFFICIAL_ASSIGNMENT_ROLES)[number],
        ),
    );
  }

  async function fetchOfficialOptions(gameId: string) {
    const response = await fetch(
      `${activeApiBase}/games/${gameId}/officials/options-mobile`,
      { headers: { "x-TipIn-access-code": session?.code ?? "" } },
    );
    const payload = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(payload)) {
      const serverMessage = !Array.isArray(payload)
        ? String(
            (payload as Record<string, unknown>).message ??
              (payload as Record<string, unknown>).error ??
              "",
          )
        : "";
      throw new Error(
        serverMessage ||
          `Failed to load available officials (HTTP ${response.status}).`,
      );
    }
    return payload
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          officialId: String(row.officialId ?? row.OfficialId ?? ""),
          displayName: String(row.displayName ?? row.DisplayName ?? ""),
          email: String(row.email ?? row.Email ?? "") || null,
          role: String(row.role ?? row.Role ?? ""),
        } as OfficialOption;
      })
      .filter((official) => official.officialId && official.displayName);
  }

  async function assignOfficialToGame(
    role: string,
    officialId: string,
    previousRole?: string,
  ) {
    if (!nextGame?.gameId || !session?.code) return;
    setIsOfficialsLoading(true);
    setOfficialsError("");
    try {
      const response = await fetch(
        `${activeApiBase}/games/${nextGame.gameId}/officials/assignment-mobile`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-TipIn-access-code": session.code,
          },
          body: JSON.stringify({
            officialId,
            role,
            previousRole: previousRole || null,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Failed to assign official.");
      }
      setOfficials(await fetchOfficialsForGame(nextGame.gameId));
    } catch (err) {
      setOfficialsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsOfficialsLoading(false);
    }
  }

  async function removeOfficialFromGame(role: string) {
    if (!nextGame?.gameId || !session?.code) return;
    setIsOfficialsLoading(true);
    setOfficialsError("");
    try {
      const response = await fetch(
        `${activeApiBase}/games/${nextGame.gameId}/officials/${encodeURIComponent(role)}/assignment-mobile`,
        {
          method: "DELETE",
          headers: { "x-TipIn-access-code": session.code },
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.message || "Failed to remove official from game.",
        );
      }
      setOfficials(await fetchOfficialsForGame(nextGame.gameId));
    } catch (err) {
      setOfficialsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsOfficialsLoading(false);
    }
  }

  function confirmRemoveOfficial(official: OfficialVerification) {
    Alert.alert(
      "Remove Official from Game?",
      `${official.officialName} will be removed from ${toOfficialRoleLabel(official.role)}. The Official will remain available for future games.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void removeOfficialFromGame(official.role),
        },
      ],
    );
  }

  function openAddOfficialModal() {
    const assignedRoles = new Set(officials.map((official) => official.role));
    setAddOfficialForm({
      firstName: "",
      lastName: "",
      email: "",
      isReferee: true,
      isLinesman: false,
      isActive: true,
      assignmentRole:
        ["Referee1", "Referee2"].find((role) => !assignedRoles.has(role)) || "",
    });
    setOfficialsError("");
    setShowAddOfficialModal(true);
  }

  async function saveNewOfficial() {
    if (!nextGame?.gameId || !session?.code) return;
    if (!addOfficialForm.firstName.trim() || !addOfficialForm.lastName.trim()) {
      setOfficialsError("First name and last name are required.");
      return;
    }
    if (!addOfficialForm.isReferee && !addOfficialForm.isLinesman) {
      setOfficialsError("Select Referee, Linesman, or both.");
      return;
    }

    const assignmentRole = addOfficialForm.assignmentRole;
    if (
      assignmentRole &&
      !(assignmentRole.startsWith("Referee")
        ? addOfficialForm.isReferee
        : addOfficialForm.isLinesman)
    ) {
      setOfficialsError(
        "The game assignment must match one of the selected Official roles.",
      );
      return;
    }

    setIsSavingOfficial(true);
    setOfficialsError("");
    try {
      const response = await fetch(
        `${activeApiBase}/games/${nextGame.gameId}/officials/mobile`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-TipIn-access-code": session.code,
          },
          body: JSON.stringify({
            ...addOfficialForm,
            firstName: addOfficialForm.firstName.trim(),
            lastName: addOfficialForm.lastName.trim(),
            email: addOfficialForm.email.trim() || null,
            assignmentRole: assignmentRole || null,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Failed to add official.");
      }
      const [loadedOfficials, loadedOptions] = await Promise.all([
        fetchOfficialsForGame(nextGame.gameId),
        fetchOfficialOptions(nextGame.gameId),
      ]);
      setOfficials(loadedOfficials);
      setOfficialOptions(loadedOptions);
      setShowAddOfficialModal(false);
    } catch (err) {
      setOfficialsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingOfficial(false);
    }
  }

  async function handleRefreshOfficials() {
    if (!nextGame?.gameId) return;

    setIsOfficialsLoading(true);
    setOfficialsError("");

    try {
      const [loaded, options] = await Promise.all([
        fetchOfficialsForGame(nextGame.gameId),
        fetchOfficialOptions(nextGame.gameId),
      ]);
      setOfficials(loaded);
      setOfficialOptions(options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOfficialsError(message);
      trace("officials.refresh.error", { message });
    } finally {
      setIsOfficialsLoading(false);
    }
  }

  async function fetchMediaOutlets() {
    const url = `${activeApiBase}/email/media-outlets-mobile`;
    trace("media-outlets.fetch.start", { url });

    const response = await fetch(url);
    trace("media-outlets.fetch.response", {
      status: response.status,
      ok: response.ok,
    });

    const payload = await response.json().catch(() => null);
    trace("media-outlets.fetch.payload", summarizePayload(payload));

    if (!response.ok || !Array.isArray(payload)) {
      const serverMessage =
        payload && typeof payload === "object"
          ? String(
              (payload as Record<string, unknown>).message ??
                (payload as Record<string, unknown>).error ??
                "",
            )
          : "";
      throw new Error(
        serverMessage ||
          `Unable to load media outlets (HTTP ${response.status}).`,
      );
    }

    return payload
      .map((entry, index) => {
        const row = entry as Record<string, unknown>;
        const email =
          (typeof row.email === "string" && row.email.trim()) ||
          (typeof row.Email === "string" && row.Email.trim()) ||
          "";
        const name =
          (typeof row.name === "string" && row.name.trim()) ||
          (typeof row.Name === "string" && row.Name.trim()) ||
          "Media Outlet";

        return {
          key: `media:${index}:${email.toLowerCase()}`,
          recipientName: name,
          recipientMeta: `Media Outlet • ${email}`,
          email,
        } as EmailRecipientOption;
      })
      .filter((recipient) => recipient.email.length > 0);
  }

  async function saveOfficialsForGame(
    gameId: string,
    rows: OfficialVerification[],
  ) {
    const url = `${activeApiBase}/games/${gameId}/officials/verification`;
    const payload = {
      officials: rows.map((official) => ({
        role: official.role,
        signatureImageBase64: official.signatureImageBase64 ?? null,
      })),
    };

    trace("officials.save.start", { gameId, count: rows.length });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    trace("officials.save.response", {
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      throw new Error("Failed to save official signatures.");
    }
  }

  function getTeamStarterValidation(teamId: string) {
    const roster = rostersByTeam[teamId] ?? [];
    const starters = startersByTeam[teamId] ?? [];
    const starterPlayers = roster.filter((player) =>
      starters.includes(player.playerId),
    );

    const hasGoalieStarter = starterPlayers.some((player) => player.isGoalie);
    const requiresSixStarters = isVarsityLevelName(
      nextGame?.levelName || session?.level,
    );
    return {
      count: starters.length,
      hasGoalieStarter,
      requiresSixStarters,
      isValid: requiresSixStarters
        ? starters.length === 6 && hasGoalieStarter
        : hasGoalieStarter,
    };
  }

  async function markGameInProgress(gameId: string) {
    const response = await fetch(
      `${activeApiBase}/games/${gameId}/start-mobile`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to mark game in progress (${response.status}).`);
    }
  }

  async function loadRosterAndCoaches(game: NextGame) {
    const homeId = game.homeTeamId;
    const awayId = game.awayTeamId;
    if (!homeId || !awayId) {
      setRosterError("Game data is missing team IDs.");
      return;
    }

    setIsRosterLoading(true);
    setRosterError("");

    try {
      const [
        homeRoster,
        awayRoster,
        homeCoaches,
        awayCoaches,
        mediaRecipients,
      ] = await Promise.all([
        fetchRosterForTeam(homeId),
        fetchRosterForTeam(awayId),
        fetchCoachesForTeam(homeId),
        fetchCoachesForTeam(awayId),
        fetchMediaOutlets().catch(() => []),
      ]);

      setRostersByTeam({
        [homeId]: homeRoster,
        [awayId]: awayRoster,
      });

      setCoachesByTeam({
        [homeId]: homeCoaches,
        [awayId]: awayCoaches,
      });

      setMediaOutletRecipients(mediaRecipients);

      setStartersByTeam({
        [homeId]: [],
        [awayId]: [],
      });

      setHeadCoachSignatures({});
      setCurrentGoalieByTeam({
        [homeId]:
          homeRoster.find((player) => player.isGoalie && player.isActive)
            ?.playerId ?? null,
        [awayId]:
          awayRoster.find((player) => player.isGoalie && player.isActive)
            ?.playerId ?? null,
      });
      trace("roster.load.complete", {
        homeCount: homeRoster.length,
        awayCount: awayRoster.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRosterError("Unable to load roster/coaches.");
      trace("roster.load.error", { message });
    } finally {
      setIsRosterLoading(false);
    }
  }

  async function refreshRosterAndCoaches() {
    if (!nextGame) return;

    const homeId = nextGame.homeTeamId;
    const awayId = nextGame.awayTeamId;
    if (!homeId || !awayId) {
      setRosterError("Game data is missing team IDs.");
      return;
    }

    setIsRosterLoading(true);
    setRosterError("");

    try {
      const [
        homeRoster,
        awayRoster,
        homeCoaches,
        awayCoaches,
        mediaRecipients,
      ] = await Promise.all([
        fetchRosterForTeam(homeId),
        fetchRosterForTeam(awayId),
        fetchCoachesForTeam(homeId),
        fetchCoachesForTeam(awayId),
        fetchMediaOutlets().catch(() => []),
      ]);

      const preserveStarterSelections = (
        teamId: string,
        refreshedRoster: RosterPlayer[],
      ) => {
        setStartersByTeam((prev) => {
          const existingSelections = prev[teamId] ?? [];
          const refreshedActivePlayerIds = new Set(
            refreshedRoster
              .filter((player) => player.isActive)
              .map((player) => player.playerId),
          );

          const nextSelections = existingSelections.filter((playerId) =>
            refreshedActivePlayerIds.has(playerId),
          );

          if (nextSelections.length === existingSelections.length) {
            return prev;
          }

          return {
            ...prev,
            [teamId]: nextSelections,
          };
        });
      };

      setRostersByTeam((prev) => ({
        ...prev,
        [homeId]: homeRoster,
        [awayId]: awayRoster,
      }));

      setCoachesByTeam((prev) => ({
        ...prev,
        [homeId]: homeCoaches,
        [awayId]: awayCoaches,
      }));

      setMediaOutletRecipients(mediaRecipients);

      setCurrentGoalieByTeam((prev) => ({
        ...prev,
        [homeId]:
          homeRoster.find((player) => player.isGoalie && player.isActive)
            ?.playerId ??
          prev[homeId] ??
          null,
        [awayId]:
          awayRoster.find((player) => player.isGoalie && player.isActive)
            ?.playerId ??
          prev[awayId] ??
          null,
      }));

      preserveStarterSelections(homeId, homeRoster);
      preserveStarterSelections(awayId, awayRoster);

      requestAnimationFrame(() => {
        rosterScrollViewRef.current?.scrollTo({
          y: rosterScrollOffsetRef.current,
          animated: false,
        });
      });

      trace("roster.refresh.complete", {
        homeCount: homeRoster.length,
        awayCount: awayRoster.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRosterError("Unable to load roster/coaches.");
      trace("roster.refresh.error", { message });
    } finally {
      setIsRosterLoading(false);
    }
  }

  function toggleStarter(teamId: string, playerId: string) {
    setStartersByTeam((prev) => {
      const current = prev[teamId] ?? [];
      const roster = rostersByTeam[teamId] ?? [];
      const player = roster.find((p) => p.playerId === playerId);

      if (!player?.isActive) {
        setRosterError("Only active players can be marked as starters.");
        return prev;
      }

      const isSelected = current.includes(playerId);

      if (isSelected) {
        return {
          ...prev,
          [teamId]: current.filter((id) => id !== playerId),
        };
      }

      if (current.length >= 6) {
        return prev;
      }

      return {
        ...prev,
        [teamId]: [...current, playerId],
      };
    });
  }

  function togglePlayerActive(teamId: string, playerId: string) {
    setRostersByTeam((prev) => {
      const roster = prev[teamId] ?? [];
      const updated = roster.map((player) =>
        player.playerId === playerId
          ? { ...player, isActive: !player.isActive }
          : player,
      );

      const updatedPlayer = updated.find(
        (player) => player.playerId === playerId,
      );
      if (updatedPlayer && !updatedPlayer.isActive) {
        setStartersByTeam((starterPrev) => ({
          ...starterPrev,
          [teamId]: (starterPrev[teamId] ?? []).filter((id) => id !== playerId),
        }));
      }

      return {
        ...prev,
        [teamId]: updated,
      };
    });
  }

  async function applyScheduledGatewayConfiguration(
    game: NextGame,
    accessCode: string,
  ) {
    if (!game.gameId) return;

    try {
      const response = await fetch(
        `${activeApiBase}/games/${game.gameId}/gateway-mobile`,
        { headers: { "x-TipIn-access-code": accessCode } },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as {
        gatewayAvailable?: boolean;
        host?: string;
        port?: number;
        tokenSecret?: string;
      };
      trace("scoreboard.gateway.schedule.response", {
        gameId: game.gameId,
        gatewayAvailable: Boolean(payload.gatewayAvailable),
        hasHost: Boolean(payload.host),
        port: payload.port ?? null,
        hasToken: Boolean(payload.tokenSecret),
      });
      const settings: ScoreboardGatewaySettings = payload.gatewayAvailable
        ? {
            enabled: true,
            host: normalizeScoreboardHost(payload.host || ""),
            port: normalizeScoreboardPort(String(payload.port || 80)),
            tokenSecret: String(payload.tokenSecret || "").trim(),
          }
        : {
            enabled: false,
            host: scoreboardGatewaySettings.host,
            port: scoreboardGatewaySettings.port,
            tokenSecret: scoreboardGatewaySettings.tokenSecret,
          };

      scheduledGatewayAppliedRef.current = true;
      setScoreboardGatewaySettings(settings);
      setScoreboardSettingsDraft(settings);
      await storageSetItem(
        SCOREBOARD_GATEWAY_SETTINGS_KEY,
        JSON.stringify(settings),
      );
      trace("scoreboard.gateway.schedule.applied", {
        gameId: game.gameId,
        mode: payload.gatewayAvailable ? "gateway" : "manual",
        host: payload.gatewayAvailable ? settings.host : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace("scoreboard.gateway.schedule.failed", {
        gameId: game.gameId,
        message,
      });
    }
  }

  async function loadNextGame(
    userId: string,
    refreshing = false,
  ): Promise<{
    status: "games" | "no_games" | "invalid" | "error";
    message?: string;
  }> {
    trace("nextgame.load.start", { userId, refreshing });

    if (refreshing) {
      setIsRefreshingNextGame(true);
    } else {
      setIsNextGameLoading(true);
    }

    try {
      const teams = await fetchTeamsForUser(userId);
      const teamIds = teams
        .map(getTeamId)
        .filter((id): id is string => Boolean(id));

      trace("nextgame.load.teams", {
        totalTeams: teams.length,
        resolvedTeamIds: teamIds,
      });

      if (teamIds.length === 0) {
        trace("nextgame.load.invalid_code", { userId });
        setNextGame(null);
        setIsClosedGameNotice(false);
        const message =
          "That access code is not valid. Check the code and try again.";
        setNextGameMessage(message);
        return { status: "invalid", message };
      }

      const lookupResults = await Promise.all(
        teamIds.map((teamId) => fetchNextGameForTeam(teamId)),
      );

      const games = lookupResults
        .map((result) => result.nextGame)
        .filter((game): game is NextGame => Boolean(game));

      const closedMessages = lookupResults
        .map((result) => result.closedMessage)
        .filter((message): message is string => Boolean(message));

      trace("nextgame.load.games", {
        totalGames: games.length,
      });

      if (games.length === 0) {
        trace("nextgame.load.none");
        setNextGame(null);
        if (closedMessages.length > 0) {
          setIsClosedGameNotice(true);
          const message = closedMessages[0];
          setNextGameMessage(message);
          return { status: "no_games", message };
        } else {
          setIsClosedGameNotice(false);
          const message =
            "Access code is valid, but no game is scheduled within the next 48 hours.";
          setNextGameMessage(message);
          return { status: "no_games", message };
        }
      }

      const earliest = [...games].sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      )[0];

      // Required app state storage for next game.
      setNextGame(earliest);
      await applyScheduledGatewayConfiguration(earliest, userId);
      setIsClosedGameNotice(false);
      setNextGameMessage("");
      trace("nextgame.load.selected", {
        teamId: earliest.teamId,
        opponentName: earliest.opponentName,
        startTime: earliest.startTime,
        rinkName: earliest.rinkName,
      });

      const setupPatch: Partial<SessionState> = {
        gameDate: formatDateOnly(earliest.startTime),
        gameTime: formatTimeOnly(earliest.startTime),
        rink: earliest.rinkName,
      };

      if (earliest.homeTeamName) setupPatch.homeTeam = earliest.homeTeamName;
      if (earliest.awayTeamName) setupPatch.awayTeam = earliest.awayTeamName;
      if (earliest.arenaName) setupPatch.venue = earliest.arenaName;
      if (earliest.gameTypeName) setupPatch.gameType = earliest.gameTypeName;
      if (typeof earliest.periodLengthMinutes === "number") {
        setupPatch.periodLength = `${earliest.periodLengthMinutes} min`;
      }
      if (earliest.levelName) setupPatch.level = earliest.levelName;
      if (earliest.conferenceDistrict)
        setupPatch.conference = earliest.conferenceDistrict;
      if (earliest.sectionRegion) setupPatch.section = earliest.sectionRegion;

      updateSession(setupPatch);
      await loadRosterAndCoaches(earliest);
      return { status: "games" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isNetworkError = /network request failed/i.test(message);
      trace("nextgame.load.error", {
        message,
      });
      setNextGame(null);
      setIsClosedGameNotice(false);
      const failureMessage = isNetworkError
        ? `Unable to reach API at ${activeApiBase}. Verify API host/network settings.`
        : "Access code is valid, but no home game is scheduled within the next 48 hours.";
      setNextGameMessage(failureMessage);
      return {
        status: isNetworkError ? "error" : "no_games",
        message: failureMessage,
      };
    } finally {
      trace("nextgame.load.complete", { refreshing });
      setIsNextGameLoading(false);
      setIsRefreshingNextGame(false);
    }
  }

  async function handleLoginSuccess(
    response: LoginResponse,
    accessCode: string,
  ) {
    trace("login.success", {
      role: response.role,
      userId: response.userId,
      accessCode,
      apiBase: activeApiBase,
    });

    const defaultSession = {
      userId: response.userId,
      role: response.role,
      code: accessCode,
      apiBase: activeApiBase,
      season: "2026-2027",
      league: "MSHSL",
      level: "Varsity",
      conference: "",
      section: "",
      gameDate: "",
      gameTime: "",
      venue: "Bud King Ice Arena",
      rink: "",
      gameType: "Conference",
      periodLength: "17 min",
      homeTeam: "Winona Boys",
      awayTeam: "Rochester Mayo Boys",
      period: 1,
      clock: "17:00",
      homeScore: 0,
      awayScore: 0,
    } satisfies SessionState;

    setSession(defaultSession);
    setGameStartedAtIso(null);
    setGameHasEnded(false);
    setStage("login");
    setRestoreStatus("checking");

    const snapshot = await loadActiveGameSnapshot();
    if (snapshot && snapshot.stage === "gameDashboard") {
      if (shouldRefreshFarFutureNextGame(snapshot.nextGame)) {
        trace("activegame.snapshot.stale", {
          startTime: snapshot.nextGame?.startTime ?? null,
        });
        await clearActiveGameSnapshot();
      } else if (
        snapshot.accessCode.trim().toUpperCase() === accessCode &&
        snapshot.nextGame?.gameId &&
        snapshot.nextGame.homeTeamId === snapshot.nextGame.teamId
      ) {
        const authorizedTeams = await fetchTeamsForUser(accessCode);
        const ownsHomeTeam = authorizedTeams.some(
          (team) => getTeamId(team) === snapshot.nextGame?.homeTeamId,
        );
        const activeGame = ownsHomeTeam
          ? await fetchNextGameForTeam(snapshot.nextGame.homeTeamId)
          : { nextGame: null };
        if (activeGame.nextGame?.gameId === snapshot.nextGame.gameId) {
          setRestoreStatus("restored-snapshot");
          restoreActiveGameSnapshot(snapshot, accessCode);
          return;
        }
        trace("activegame.snapshot.unauthorized", {
          enteredCode: accessCode,
          gameId: snapshot.nextGame.gameId,
        });
      } else {
        trace("activegame.snapshot.code_mismatch", {
          enteredCode: accessCode,
          gameId: snapshot.nextGame?.gameId ?? null,
        });
      }
    }

    const resumeSnapshot = await loadActiveGameResume();
    if (resumeSnapshot) {
      if (shouldRefreshFarFutureNextGame(resumeSnapshot.nextGame)) {
        trace("activegame.resume.stale", {
          startTime: resumeSnapshot.nextGame?.startTime ?? null,
        });
        await clearActiveGameSnapshot();
      } else if (
        resumeSnapshot.session.code.trim().toUpperCase() === accessCode &&
        resumeSnapshot.nextGame?.gameId &&
        resumeSnapshot.nextGame.homeTeamId === resumeSnapshot.nextGame.teamId
      ) {
        const authorizedTeams = await fetchTeamsForUser(accessCode);
        const ownsHomeTeam = authorizedTeams.some(
          (team) => getTeamId(team) === resumeSnapshot.nextGame?.homeTeamId,
        );
        const activeGame = ownsHomeTeam
          ? await fetchNextGameForTeam(resumeSnapshot.nextGame.homeTeamId)
          : { nextGame: null };
        if (activeGame.nextGame?.gameId === resumeSnapshot.nextGame.gameId) {
          setRestoreStatus("restored-resume");
          setSession({
            ...resumeSnapshot.session,
            code: accessCode,
            apiBase: activeApiBase,
          });
          setGameStartedAtIso(resumeSnapshot.gameStartedAtIso ?? null);
          setNextGame(resumeSnapshot.nextGame);
          setGameHasEnded(false);
          setStage("gameDashboard");
          void loadRosterAndCoaches(resumeSnapshot.nextGame);
          trace("activegame.resume.restored", {
            gameId: resumeSnapshot.nextGame.gameId,
          });
          return;
        }
        trace("activegame.resume.unauthorized", {
          enteredCode: accessCode,
          gameId: resumeSnapshot.nextGame.gameId,
        });
      } else {
        trace("activegame.resume.code_mismatch", {
          enteredCode: accessCode,
          gameId: resumeSnapshot.nextGame?.gameId ?? null,
        });
      }
    }

    // A marker has no game or code ownership data, so it cannot authorize dashboard access.
    if (await hasActiveGameMarker()) {
      trace("activegame.marker.ignored_without_authorization", {
        userId: response.userId,
      });
    }

    setRestoreStatus("none");
    const nextGameResult = await loadNextGame(response.userId);

    if (nextGameResult.status === "invalid") {
      setError(nextGameResult.message || "That access code is not valid.");
      setStage("login");
      return;
    }

    if (nextGameResult.status === "no_games") {
      setError(
        nextGameResult.message ||
          "No home game is scheduled for this team within the next 48 hours.",
      );
      setStage("login");
      return;
    }

    if (nextGameResult.status === "error") {
      setError(
        nextGameResult.message ||
          "Unable to contact the game service. Check the network and try again.",
      );
      setStage("login");
      return;
    }

    setSession((prev) => prev ?? defaultSession);
    setStage("verifyGame");
  }

  async function handleAccessCodeContinue() {
    const normalized = accessCodeInput.trim().toUpperCase();
    const role = parseRoleFromAccessCode(normalized);

    trace("login.attempt", {
      enteredCode: normalized,
      parsedRole: role ?? "unknown",
      apiBase: activeApiBase,
    });

    if (!role) {
      setError("Enter a 9-character code in the format GM-9813SP.");
      trace("login.invalid_code", { enteredCode: normalized });
      return;
    }

    setError("");

    const loginResponse: LoginResponse = {
      userId: extractUserIdFromAccessCode(normalized),
      role,
    };

    trace("login.derived_identity", {
      derivedUserId: loginResponse.userId,
      role: loginResponse.role,
    });

    await handleLoginSuccess(loginResponse, normalized);
  }

  async function logout() {
    await clearActiveGameSnapshot();
    gameClock.stop();
    gameClock.syncPausedRemaining(17 * 60 * 1000, 17 * 60 * 1000);
    setStage("login");
    setSession(null);
    setGameHasEnded(false);
    setNextGame(null);
    setIsClosedGameNotice(false);
    setIsNextGameLoading(false);
    setIsRefreshingNextGame(false);
    setNextGameMessage("No Scheduled Games Found");
    setIsRosterLoading(false);
    setRosterError("");
    setRostersByTeam({});
    setCoachesByTeam({});
    setStartersByTeam({});
    setHeadCoachSignatures({});
    setSignatureContext(null);
    setSignatureNameInput("");
    setOfficials([]);
    setIsOfficialsLoading(false);
    setOfficialsError("");
    setShowStartConfirm(false);
    setIsClockRunning(false);
    setPeriodController({ state: "NOT_STARTED", isOvertime: false });
    setIntermissionSeconds(0);
    setShowPeriodOverVerify(false);
    setShowResumeVerify(false);
    setShowEndOfRegulation(false);
    setGoalModal(null);
    setResumeClockAfterGoalModal(false);
    setGoalModalError("");
    setPenaltyModal(null);
    setResumeClockAfterPenaltyModal(false);
    setPenaltyModalError("");
    setTimeoutModal(null);
    setGoalieModal(null);
    setEventActionModal(null);
    setEventEditModal(null);
    setEventEditModalError("");
    setShowSuspensionNotesModal(false);
    setRosterPreviewTeam(null);
    setShowOfficialsPreview(false);
    setShowStarterInformation(false);
    setSuspensionNotesByPenaltyId({});
    setSuspensionNotesError("");
    setSendRecipientSelection({});
    setCustomEmailInput("");
    setCustomEmails([]);
    setMediaOutletRecipients([]);
    setSendScoresheetError("");
    setEmailDeliveryStatus("idle");
    setEmailDeliveryMessage("");
    setIsFinalizingGame(false);
    setGameStartedAtIso(null);
    setSyncState("up_to_date");
    setPendingSyncCount(0);
    setEventFeed([]);
    setHomeShotsByPeriod({ 1: 0, 2: 0, 3: 0, OT: 0 });
    setAwayShotsByPeriod({ 1: 0, 2: 0, 3: 0, OT: 0 });
    setShotHistory([]);
    setPlayerStatsById({});
    setTeamPenaltyCountById({});
    setActivePenalties([]);
    setCurrentGoalieByTeam({});
    setHomeGoaliePulled(false);
    setAwayGoaliePulled(false);
    setPenaltyShotActive(false);
    setAccessCodeInput("");
    setError("");
  }

  async function handleRefreshNextGame() {
    if (!session?.userId) return;
    await loadNextGame(session.userId, true);
  }

  function score(team: "home" | "away", delta: 1 | -1) {
    if (!session || !canControlGame(session.role)) return;

    if (team === "home") {
      updateSession({ homeScore: Math.max(0, session.homeScore + delta) });
    } else {
      updateSession({ awayScore: Math.max(0, session.awayScore + delta) });
    }
  }

  function adjustShots(
    team: "home" | "away",
    delta: 1 | -1,
    recordShotEvent = true,
  ) {
    if (!session || !canControlGame(session.role)) return;
    const transitioned = transitionShotTotals(
      homeShotsByPeriod,
      awayShotsByPeriod,
      {
        team,
        period: session.period,
        delta,
      },
    );
    setHomeShotsByPeriod(transitioned.home);
    setAwayShotsByPeriod(transitioned.away);

    const shootingTeamId = team === "home" ? homeTeamId : awayTeamId;
    const shootingTeamName =
      team === "home" ? session.homeTeam : session.awayTeam;
    const goalieTeamId = team === "home" ? awayTeamId : homeTeamId;
    const goalieTeamName =
      team === "home" ? session.awayTeam : session.homeTeam;
    const goalieId = currentGoalieByTeam[goalieTeamId] ?? null;
    const goaliePulled = team === "home" ? awayGoaliePulled : homeGoaliePulled;
    const goalieName = goaliePulled
      ? "Empty Net"
      : goalieId
        ? findPlayerName(goalieTeamId, goalieId)
        : "Unknown Goalie";

    if (recordShotEvent && nextGame?.gameId) {
      if (delta === 1) {
        const periodLengthMinutes = getPeriodLengthMinutes(
          session.periodLength,
        );
        const shotEvent: GameFeedEvent = {
          localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          gameId: nextGame.gameId,
          eventType: "Shot",
          teamId: shootingTeamId,
          teamName: shootingTeamName,
          period: session.period,
          timeInPeriod: computeElapsedTime(periodLengthMinutes, session.clock),
          strength: "Even Strength",
          createdAtIso: new Date().toISOString(),
        };
        addEventToFeed(shotEvent);
        void syncShotEvent(shotEvent);
      } else {
        const shotToRemove = eventFeed.find(
          (event) =>
            event.eventType === "Shot" &&
            event.teamId === shootingTeamId &&
            event.period === session.period,
        );
        if (shotToRemove) {
          setEventFeed((prev) =>
            prev.filter((event) => event.localId !== shotToRemove.localId),
          );
          void getQueuedEventsForKey(SHOT_OFFLINE_QUEUE_KEY).then((queued) =>
            storageSetItem(
              SHOT_OFFLINE_QUEUE_KEY,
              JSON.stringify(
                queued.filter(
                  (event) => event.localId !== shotToRemove.localId,
                ),
              ),
            ),
          );
          void deleteEventFromBackend(shotToRemove);
        }
      }
    }

    setShotHistory((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        shootingTeamId,
        shootingTeamName,
        goalieTeamId,
        goalieTeamName,
        goalieId,
        goalieName,
        period: session.period,
        delta,
        createdAtIso: new Date().toISOString(),
      },
    ]);
  }

  function finalizeGameToSummary() {
    setIsClockRunning(false);
    gameClock.pause();
    setPeriodController((prev) => ({ ...prev, state: "NOT_STARTED" }));
    setGameHasEnded(true);
    setEmailDeliveryStatus("idle");
    setEmailDeliveryMessage("");
    setStage("gameSummary");
    void clearActiveGameSnapshot();
  }

  async function openSendScoresheet() {
    setSendScoresheetError("");
    const isVarsityGame = isVarsityLevelName(
      nextGame?.levelName || session?.level || "",
    );
    let currentMediaRecipients = mediaOutletRecipients;
    try {
      currentMediaRecipients = await fetchMediaOutlets();
      setMediaOutletRecipients(currentMediaRecipients);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSendScoresheetError(message);
      trace("media-outlets.refresh.error", { message });
    }

    const defaults = coachEmailRecipients.reduce<Record<string, boolean>>(
      (acc, recipient) => {
        acc[recipient.key] = true;
        return acc;
      },
      {},
    );

    for (const recipient of customEmailRecipients) {
      defaults[recipient.key] = true;
    }

    for (const recipient of currentMediaRecipients) {
      defaults[recipient.key] = isVarsityGame;
    }

    if (dqEmailPenaltyEvents.length > 0) {
      for (const recipient of officialEmailRecipients) {
        defaults[recipient.key] = true;
      }
    }

    setSendRecipientSelection(defaults);
    setStage("sendScoresheet");
  }

  function addCustomEmailRecipient() {
    const email = customEmailInput.trim();
    if (!email) {
      setSendScoresheetError(
        "Enter an email address before tapping Add Email.",
      );
      return;
    }

    if (!isValidEmailAddress(email)) {
      setSendScoresheetError("Enter a valid email address.");
      return;
    }

    const normalized = email.toLowerCase();
    const alreadyIncluded = [
      ...coachEmailRecipients.map((recipient) =>
        (recipient.coachEmail ?? "").toLowerCase(),
      ),
      ...officialEmailRecipients.map((recipient) =>
        recipient.email.toLowerCase(),
      ),
      ...mediaOutletRecipients.map((recipient) =>
        recipient.email.toLowerCase(),
      ),
      ...customEmails.map((recipient) => recipient.toLowerCase()),
    ].includes(normalized);

    if (alreadyIncluded) {
      setSendScoresheetError("That email is already in the recipient list.");
      return;
    }

    setSendScoresheetError("");
    setCustomEmails((prev) => [...prev, email]);
    setSendRecipientSelection((prev) => ({
      ...prev,
      [`custom:${normalized}`]: true,
    }));
    setCustomEmailInput("");
  }

  function removeCustomEmailRecipient(email: string) {
    const key = `custom:${email.toLowerCase()}`;
    setCustomEmails((prev) => prev.filter((item) => item !== email));
    setSendRecipientSelection((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function buildCompleteGamePayload(): CompleteGamePayload {
    const selectedCoachRecipients = coachEmailRecipients.filter((recipient) =>
      Boolean(sendRecipientSelection[recipient.key]),
    );

    const selectedOfficialRecipients = officialEmailRecipients.filter(
      (recipient) => Boolean(sendRecipientSelection[recipient.key]),
    );

    const selectedMediaRecipients = mediaOutletRecipients.filter((recipient) =>
      Boolean(sendRecipientSelection[recipient.key]),
    );

    const selectedCustomRecipients = customEmailRecipients.filter((recipient) =>
      Boolean(sendRecipientSelection[recipient.key]),
    );

    if (
      dqEmailPenaltyEvents.length > 0 &&
      selectedOfficialRecipients.length === 0 &&
      selectedCustomRecipients.length === 0
    ) {
      throw new Error(
        "A DQ requires at least one official email recipient. Add official emails in Admin Officials or add one in this screen.",
      );
    }

    const selectedRecipientEmails = [
      ...selectedCoachRecipients
        .map((recipient) => recipient.coachEmail)
        .filter((email): email is string => Boolean(email && email.trim())),
      ...selectedOfficialRecipients
        .map((recipient) => recipient.email)
        .filter((email): email is string => Boolean(email && email.trim())),
      ...selectedMediaRecipients
        .map((recipient) => recipient.email)
        .filter((email): email is string => Boolean(email && email.trim())),
      ...selectedCustomRecipients
        .map((recipient) => recipient.email)
        .filter((email): email is string => Boolean(email && email.trim())),
    ];
    const invalidRecipient = selectedRecipientEmails.find(
      (email) => !isValidEmailAddress(email),
    );
    if (invalidRecipient) {
      throw new Error(`Invalid selected recipient email: ${invalidRecipient}`);
    }

    const selectedRecipientLabels = [
      ...selectedCoachRecipients.map(
        (recipient) => `${recipient.coachName} <${recipient.coachEmail}>`,
      ),
      ...selectedOfficialRecipients.map(
        (recipient) => `${recipient.recipientName} <${recipient.email}>`,
      ),
      ...selectedMediaRecipients.map(
        (recipient) => `${recipient.recipientName} <${recipient.email}>`,
      ),
      ...selectedCustomRecipients.map((recipient) => recipient.email),
    ];

    const suspensionNotes = gameDqPenaltyEvents
      .map((event) => {
        const notes = (suspensionNotesByPenaltyId[event.localId] ?? "").trim();
        if (!notes) return null;
        return `${event.teamName} ${event.playerName}: ${notes}`;
      })
      .filter((line): line is string => Boolean(line));

    const suspensionNoteEntries = gameDqPenaltyEvents
      .map((event) => {
        const notes = (suspensionNotesByPenaltyId[event.localId] ?? "").trim();
        if (!notes) return null;

        return {
          eventRef: event.localId,
          notes,
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          eventRef: string;
          notes: string;
        } => Boolean(entry),
      );

    const notesBlocks = [
      `Final: Away - ${buildTeamDisplayName(nextGame?.awayTeamName || session?.awayTeam, nextGame?.awayTeamMascot)} ${session?.awayScore ?? 0} - ${session?.homeScore ?? 0} Home - ${buildTeamDisplayName(nextGame?.homeTeamName || session?.homeTeam, nextGame?.homeTeamMascot)}`,
      selectedRecipientLabels.length > 0
        ? `Recipients: ${selectedRecipientLabels.join(", ")}`
        : "Recipients: none selected",
      suspensionNotes.length > 0
        ? `Suspension Notes: ${suspensionNotes.join(" | ")}`
        : null,
    ].filter((line): line is string => Boolean(line));

    const goalieSummaries = shotsByGoalie.map((goalie) => {
      const teamGoalsAgainst =
        goalie.goalieTeamId === homeTeamId
          ? (session?.awayScore ?? 0)
          : (session?.homeScore ?? 0);

      const teamGoalieRows = shotsByGoalie.filter(
        (row) => row.goalieTeamId === goalie.goalieTeamId,
      );
      const teamDurationSeconds = teamGoalieRows.reduce(
        (sum, row) => sum + (row.totalTimeInNetSeconds || 0),
        0,
      );

      const allocationRatio =
        teamDurationSeconds > 0
          ? (goalie.totalTimeInNetSeconds || 0) / teamDurationSeconds
          : 0;
      const goalsAgainstEstimate = Number(
        (teamGoalsAgainst * allocationRatio).toFixed(2),
      );
      const savesEstimate = Math.max(
        0,
        Number((goalie.totalShotsAgainst - goalsAgainstEstimate).toFixed(2)),
      );
      const savePctEstimate =
        goalie.totalShotsAgainst > 0
          ? Number(
              (
                (savesEstimate / Math.max(1, goalie.totalShotsAgainst)) *
                100
              ).toFixed(2),
            )
          : 0;

      return {
        goalieTeamId: goalie.goalieTeamId,
        goalieTeamName: goalie.goalieTeamName,
        goalieName: goalie.goalieName,
        shotsAgainstByPeriod: {
          p1: goalie.totals[1],
          p2: goalie.totals[2],
          p3: goalie.totals[3],
          ot: goalie.totals.OT,
        },
        shotsAgainst: goalie.totalShotsAgainst,
        timeInNetSeconds: goalie.totalTimeInNetSeconds,
        goalsAgainstEstimate,
        savesEstimate,
        savePctEstimate,
      };
    });

    return {
      notes: notesBlocks.join("\n"),
      suspensionNotes: suspensionNoteEntries,
      shotSummary: {
        homeByPeriod: {
          p1: safeHomeShotsByPeriod[1],
          p2: safeHomeShotsByPeriod[2],
          p3: safeHomeShotsByPeriod[3],
          ot: safeHomeShotsByPeriod.OT,
        },
        awayByPeriod: {
          p1: safeAwayShotsByPeriod[1],
          p2: safeAwayShotsByPeriod[2],
          p3: safeAwayShotsByPeriod[3],
          ot: safeAwayShotsByPeriod.OT,
        },
        homeTotal: homeShotsTotal,
        awayTotal: awayShotsTotal,
      },
      goalieSummaries,
      emailDispatch: {
        to: Array.from(
          new Set(
            selectedRecipientEmails
              .map((email) => email.trim())
              .filter((email) => email.length > 0),
          ),
        ),
        subject: `Scoresheet: ${session?.homeTeam ?? "Home"} vs ${session?.awayTeam ?? "Away"}`,
      },
    };
  }

  async function completeGameInBackend(
    gameId: string,
    payloadOverride?: CompleteGamePayload,
  ) {
    const completePayload = payloadOverride ?? buildCompleteGamePayload();

    return await postCompletePayloadToBackend(gameId, completePayload);
  }

  async function handleSendScoresAndFinalize() {
    if (!nextGame?.gameId) {
      await logout();
      return;
    }

    setSendScoresheetError("");
    setEmailDeliveryStatus("idle");
    setEmailDeliveryMessage("");
    setIsFinalizingGame(true);

    try {
      const completePayload = buildCompleteGamePayload();
      const completion = await completeGameInBackend(
        nextGame.gameId,
        completePayload,
      );

      if (completion?.emailRequested && !completion?.emailSent) {
        const message =
          completion?.emailError ||
          "Game finalized, but sending scoresheet email failed.";
        setEmailDeliveryStatus("failed");
        setEmailDeliveryMessage(message);
        setSendScoresheetError(message);
        return;
      }

      setEmailDeliveryStatus("sent");
      setEmailDeliveryMessage("Scoresheet email sent.");
      setStage("gameSummary");
      setTimeout(() => {
        void logout();
      }, 1300);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (isLikelyConnectivityError(message)) {
        try {
          await queuePendingFinalizeRequest(
            nextGame.gameId,
            buildCompleteGamePayload(),
            message,
          );
          setEmailDeliveryStatus("queued");
          setEmailDeliveryMessage(
            "Offline: finalization queued and will sync automatically when connection returns.",
          );
          setSendScoresheetError("");
          setStage("gameSummary");
          return;
        } catch (queueErr) {
          const queueMessage =
            queueErr instanceof Error ? queueErr.message : String(queueErr);
          setEmailDeliveryStatus("failed");
          setEmailDeliveryMessage(
            `Offline and unable to queue finalization: ${queueMessage}`,
          );
          setSendScoresheetError(
            `Offline and unable to queue finalization: ${queueMessage}`,
          );
          trace("game.complete.queue.error", { message: queueMessage });
          return;
        }
      }

      setEmailDeliveryStatus("failed");
      setEmailDeliveryMessage(message);
      setSendScoresheetError(message);
      trace("game.complete.error", { message });
    } finally {
      setIsFinalizingGame(false);
    }
  }

  function confirmSuspensionNotesAndContinue() {
    const missing = gameDqPenaltyEvents.find(
      (event) =>
        (getPenaltyRule(event.penaltyType ?? "Minor").requiresRefereeNotes ||
          getPenaltyRule(event.penaltyType ?? "Minor").reviewRequired) &&
        !(suspensionNotesByPenaltyId[event.localId] ?? "").trim(),
    );
    if (missing) {
      setSuspensionNotesError(
        "Referee notes are required for every possible suspension penalty.",
      );
      return;
    }

    setSuspensionNotesError("");
    setShowSuspensionNotesModal(false);
    finalizeGameToSummary();
  }

  function beginHeadCoachSignature(teamId: string, teamName: string) {
    const headCoach = (coachesByTeam[teamId] ?? []).find(
      (coach) => coach.roleName === "Head Coach",
    );
    if (!headCoach) {
      setRosterError(`Head coach not found for ${teamName}.`);
      return;
    }

    setSignatureContext({
      type: "coach",
      teamId,
      teamName,
      signerName: headCoach.coachName,
    });
    setSignatureNameInput(headCoachSignatures[teamId] ?? headCoach.coachName);
    setStage("coachSignature");
  }

  function beginOfficialSignature(index: number) {
    const official = officials[index];
    if (!official) return;

    setOfficialsError("");
    setSignatureContext({
      type: "official",
      officialIndex: index,
      role: official.role,
      signerName: official.officialName,
    });
    setSignatureNameInput(official.signedByName ?? official.officialName ?? "");
    setStage("coachSignature");
  }

  function confirmSignature() {
    if (!signatureContext) return;

    const signedBy = signatureNameInput.trim();
    if (!signedBy) {
      if (signatureContext.type === "coach") {
        setRosterError("Enter the coach signature name to continue.");
      } else {
        setOfficialsError("Enter the official signature name to continue.");
      }
      return;
    }

    if (signatureContext.type === "coach") {
      setHeadCoachSignatures((prev) => ({
        ...prev,
        [signatureContext.teamId]: signedBy,
      }));
      setRosterError("");
      setStage("rosterVerify");
    } else {
      setOfficials((prev) =>
        prev.map((official, index) => {
          if (index !== signatureContext.officialIndex) return official;
          return {
            ...official,
            signedByName: signedBy,
            signatureImageBase64: buildMobileSignatureToken(
              official.role,
              signedBy,
            ),
            signedAtUtc: new Date().toISOString(),
          };
        }),
      );
      setOfficialsError("");
      setStage("officialsVerify");
    }

    setSignatureContext(null);
    setSignatureNameInput("");
  }

  async function goToOfficialsFromRoster() {
    if (!homeTeamId || !awayTeamId) {
      setRosterError("Missing home/away teams for roster verification.");
      return;
    }

    const homeValidation = getTeamStarterValidation(homeTeamId);
    const awayValidation = getTeamStarterValidation(awayTeamId);

    if (!homeValidation.isValid || !awayValidation.isValid) {
      setRosterError(
        homeValidation.requiresSixStarters || awayValidation.requiresSixStarters
          ? "Varsity games require 6 starters per team with at least 1 goalie. Other levels require at least 1 goalie starter."
          : "Each team must select at least 1 goalie starter.",
      );
      return;
    }

    if (!headCoachSignatures[homeTeamId] || !headCoachSignatures[awayTeamId]) {
      setRosterError("Head coach signatures are required for both teams.");
      return;
    }

    if (!nextGame?.gameId) {
      setRosterError("Scheduled game ID is missing; cannot verify officials.");
      return;
    }

    setRosterError("");
    setOfficialsError("");
    setIsOfficialsLoading(true);

    try {
      const [loaded, options] = await Promise.all([
        fetchOfficialsForGame(nextGame.gameId),
        fetchOfficialOptions(nextGame.gameId),
      ]);
      setOfficials(loaded);
      setOfficialOptions(options);
      setStage("officialsVerify");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRosterError(message);
      trace("officials.fetch.error", { message });
    } finally {
      setIsOfficialsLoading(false);
    }
  }

  function startGameFromOfficials() {
    if (!nextGame?.gameId) {
      setOfficialsError("Scheduled game ID is missing; cannot start game.");
      return;
    }

    if (!officials.length) {
      setOfficialsError("No officials are assigned to this game.");
      return;
    }

    const missing = officials.find(
      (official) => !official.signatureImageBase64,
    );
    if (missing) {
      setOfficialsError(
        `Signature required for ${toOfficialRoleLabel(missing.role)}.`,
      );
      return;
    }

    setOfficialsError("");
    setShowStartConfirm(true);
  }

  async function handleConfirmStartGame() {
    if (!session) {
      setOfficialsError("Session is missing; please log in again.");
      setShowStartConfirm(false);
      return;
    }

    if (!nextGame?.gameId) {
      setOfficialsError("Scheduled game ID is missing; cannot start game.");
      setShowStartConfirm(false);
      return;
    }

    if (!officials.length) {
      setOfficialsError("No officials are assigned to this game.");
      setShowStartConfirm(false);
      return;
    }

    const missing = officials.find(
      (official) => !official.signatureImageBase64,
    );
    if (missing) {
      setOfficialsError(
        `Signature required for ${toOfficialRoleLabel(missing.role)}.`,
      );
      setShowStartConfirm(false);
      return;
    }

    setOfficialsError("");
    setShowStartConfirm(false);
    setIsOfficialsLoading(true);

    try {
      await saveOfficialsForGame(nextGame.gameId, officials);
      await markGameInProgress(nextGame.gameId);
      await markActiveGame();
      const startedAtIso = new Date().toISOString();
      setGameStartedAtIso(startedAtIso);

      const homeStarters = startersByTeam[homeTeamId] ?? [];
      const awayStarters = startersByTeam[awayTeamId] ?? [];
      const homeStarterGoalieId =
        (rostersByTeam[homeTeamId] ?? []).find(
          (player) =>
            player.isGoalie &&
            player.isActive &&
            homeStarters.includes(player.playerId),
        )?.playerId ?? null;
      const awayStarterGoalieId =
        (rostersByTeam[awayTeamId] ?? []).find(
          (player) =>
            player.isGoalie &&
            player.isActive &&
            awayStarters.includes(player.playerId),
        )?.playerId ?? null;
      setCurrentGoalieByTeam((prev) => ({
        ...prev,
        [homeTeamId]: homeStarterGoalieId,
        [awayTeamId]: awayStarterGoalieId,
      }));

      setGameHasEnded(false);
      const startedSession: SessionState = {
        ...session,
        clock: formatSecondsToClock(
          getPeriodLengthMinutes(session.periodLength) * 60,
        ),
        period: 1,
      };
      const startedPeriodMs =
        getPeriodLengthMinutes(session.periodLength) * 60 * 1000;
      gameClock.syncPausedRemaining(startedPeriodMs, startedPeriodMs);
      gameClock.pause();
      setSession(startedSession);
      setPeriodController({ state: "NOT_STARTED", isOvertime: false });
      setIntermissionSeconds(0);
      setStage("gameDashboard");
      await persistActiveGameSnapshot(
        buildActiveGameSnapshot(startedSession, nextGame),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOfficialsError(message);
      trace("officials.save.error", { message });
    } finally {
      setIsOfficialsLoading(false);
    }
  }

  function handleEndGame() {
    if (gameDqPenaltyEvents.length > 0) {
      setSuspensionNotesError("");
      setShowSuspensionNotesModal(true);
      return;
    }

    finalizeGameToSummary();
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {stage !== "login" ? (
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <Image source={TipIn_LOGO} style={styles.headerLogo} />
            <View>
              <Text style={styles.brand}>
                <Text style={styles.headerBrandTip}>Tip</Text>
                <Text style={styles.headerBrandIn}>In</Text>
                <Text style={styles.headerBrandProduct}> Game Manager</Text>
              </Text>
            </View>
          </View>

          <View style={styles.seasonChip}>
            <Text style={styles.seasonChipLabel}>Season:</Text>
            <Text style={styles.seasonChipValue}>2026-2027</Text>
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={rosterScrollViewRef}
        contentContainerStyle={styles.content}
        onScroll={(event) => {
          if (stage === "rosterVerify") {
            rosterScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }
        }}
        scrollEventThrottle={16}
        refreshControl={
          stage === "verifyGame" && session ? (
            <RefreshControl
              refreshing={isRefreshingNextGame}
              onRefresh={handleRefreshNextGame}
              tintColor="#FF7B00"
            />
          ) : stage === "officialsVerify" && session ? (
            <RefreshControl
              refreshing={isOfficialsLoading}
              onRefresh={handleRefreshOfficials}
              tintColor="#FF7B00"
            />
          ) : stage === "rosterVerify" && session ? (
            <RefreshControl
              refreshing={isRosterLoading}
              onRefresh={refreshRosterAndCoaches}
              tintColor="#FF7B00"
            />
          ) : undefined
        }
      >
        {stage === "login" ? (
          <View style={styles.loginWrap}>
            <View style={styles.loginBrandRow}>
              <Image source={TipIn_LOGO} style={styles.loginLogo} />
              <View>
                <Text style={styles.loginBrandTitle}>
                  <Text style={styles.loginBrandTip}>Tip</Text>
                  <Text style={styles.loginBrandIn}>In</Text>
                  <Text style={styles.loginBrandScoring}> Scoring</Text>
                </Text>
                <Text style={styles.loginBrandSubtitle}>GAME MANAGER</Text>
              </View>
            </View>

            <View style={styles.loginIntroBlock}>
              <Text style={styles.loginIntroTitle}>Enter Your Access Code</Text>
              <Text style={styles.loginIntroBody}>
                Access codes are provided by your team administrator.
              </Text>
            </View>

            <View style={styles.loginForm}>
              <TextInput
                style={styles.codeInputFigma}
                value={accessCodeInput}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={9}
                placeholder="GM-1A2B3C"
                placeholderTextColor="#5E7290"
                onChangeText={(value) => {
                  setAccessCodeInput(formatAccessCodeInput(value));
                  setError("");
                }}
              />
            </View>

            <Pressable
              style={styles.primaryButtonFigma}
              onPress={handleAccessCodeContinue}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>

            {error ? (
              <View
                style={styles.loginErrorPanel}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                <Text style={styles.loginErrorTitle}>Unable to Continue</Text>
                <Text style={styles.loginErrorText}>{error}</Text>
              </View>
            ) : null}
            <Text style={styles.restoreStatusText}>
              Restore status: {restoreStatus}
            </Text>

            {nextGameMessage ? (
              <Text style={styles.restoreStatusText}>{nextGameMessage}</Text>
            ) : null}
          </View>
        ) : null}

        {stage === "verifyGame" && session ? (
          <View style={styles.card}>
            <Text style={styles.title}>Verify Game</Text>
            <Text style={styles.sectionLabel}>TEAMS</Text>
            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>HOME TEAM</Text>
                <Text style={styles.cellValue}>{session.homeTeam}</Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>AWAY TEAM</Text>
                <Text style={styles.cellValue}>{session.awayTeam}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>LEAGUE & LEVEL</Text>
            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>LEAGUE</Text>
                <Text style={styles.cellValue}>{session.league}</Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>LEVEL</Text>
                <Text style={styles.cellValue}>{session.level}</Text>
              </View>
            </View>
            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>TEAM TYPE</Text>
                <Text style={styles.cellValue}>
                  {nextGame?.teamType ?? "-"}
                </Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>STATUS</Text>
                <Text style={styles.cellValue}>
                  {isClosedGameNotice ? "Closed" : "Open"}
                </Text>
              </View>
            </View>
            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>CONFERENCE / REGION</Text>
                <Text style={styles.cellValue}>{session.conference}</Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>SECTION / DISTRICT</Text>
                <Text style={styles.cellValue}>{session.section}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>GAME DETAILS</Text>
            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>DATE</Text>
                <Text style={styles.cellValue}>{session.gameDate}</Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>TIME</Text>
                <Text style={styles.cellValue}>{session.gameTime}</Text>
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>VENUE</Text>
                <Text style={styles.cellValue}>{session.venue}</Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>RINK</Text>
                <Text style={styles.cellValue}>{session.rink}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>GAME TYPE & PERIOD LENGTH</Text>
            <View style={styles.twoColRow}>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>GAME TYPE</Text>
                <Text style={styles.cellValue}>{session.gameType}</Text>
              </View>
              <View style={styles.twoColCell}>
                <Text style={styles.cellLabel}>PERIOD LENGTH</Text>
                <TextInput
                  style={styles.inputInline}
                  value={session.periodLength}
                  onChangeText={(periodLength) =>
                    updateSession({ periodLength })
                  }
                  placeholder="17 min"
                  placeholderTextColor="#7a8fa8"
                />
              </View>
            </View>

            <View style={styles.rowButtons}>
              <Pressable style={styles.secondaryButton} onPress={logout}>
                <Text style={styles.secondaryButtonText}>
                  Wrong Game / Back to Login
                </Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => setStage("rosterVerify")}
              >
                <Text style={styles.primaryButtonText}>
                  Confirm and Next to Verify Rosters
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {stage === "rosterVerify" && session ? (
          <View style={styles.card}>
            <Text style={styles.title}>Verify Rosters</Text>
            <Text style={styles.note}>
              Review starters, active players, and coach approval status.
            </Text>

            {rosterError ? (
              <Text style={styles.error}>{rosterError}</Text>
            ) : null}

            {isRosterLoading ? (
              <View style={styles.nextGameLoadingWrap}>
                <ActivityIndicator color="#FF7B00" />
                <Text style={styles.nextGameEmptyText}>
                  Loading rosters and coaches...
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>ROSTER</Text>
                <View style={styles.tabRow}>
                  <Pressable
                    style={[
                      styles.tabButton,
                      activeRosterTeam === "home" && styles.tabButtonActive,
                    ]}
                    onPress={() => setActiveRosterTeam("home")}
                  >
                    <Text
                      style={[
                        styles.tabButtonText,
                        activeRosterTeam === "home" &&
                          styles.tabButtonTextActive,
                      ]}
                    >
                      {session.homeTeam.toUpperCase()}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.tabButton,
                      activeRosterTeam === "away" && styles.tabButtonActive,
                    ]}
                    onPress={() => setActiveRosterTeam("away")}
                  >
                    <Text
                      style={[
                        styles.tabButtonText,
                        activeRosterTeam === "away" &&
                          styles.tabButtonTextActive,
                      ]}
                    >
                      {session.awayTeam.toUpperCase()}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.tableHeaderRow}>
                  <Text style={styles.tableHeaderStarter}>STARTER</Text>
                  <Text style={styles.tableHeaderJersey}>JERSEY</Text>
                  <Text style={styles.tableHeaderPos}>POS</Text>
                  <Text style={styles.tableHeaderGrade}>GRADE</Text>
                  <Text style={styles.tableHeaderPlayer}>PLAYER</Text>
                  <Text style={styles.tableHeaderActive}>ACTIVE</Text>
                </View>

                {activeRosterSorted.length === 0 ? (
                  <Text style={styles.nextGameEmptyText}>
                    No roster entries found for {activeTeamName}.
                  </Text>
                ) : (
                  activeRosterSorted.map((player, idx) => {
                    const selectedStarters = activeTeamId
                      ? (startersByTeam[activeTeamId] ?? [])
                      : [];
                    const isStarter = selectedStarters.includes(
                      player.playerId,
                    );

                    return (
                      <View
                        key={player.playerId}
                        style={
                          idx % 2 === 0
                            ? styles.tableDataRow
                            : styles.tableDataRowAlt
                        }
                      >
                        <Pressable
                          style={styles.starterToggleWrap}
                          hitSlop={8}
                          onPress={() => {
                            if (!activeTeamId) return;
                            toggleStarter(activeTeamId, player.playerId);
                            setRosterError("");
                          }}
                        >
                          <View
                            style={[
                              styles.starterToggle,
                              isStarter
                                ? styles.starterToggleOn
                                : styles.starterToggleOff,
                            ]}
                          >
                            <View
                              style={[
                                styles.starterToggleKnob,
                                isStarter
                                  ? styles.starterToggleKnobOn
                                  : styles.starterToggleKnobOff,
                              ]}
                            />
                          </View>
                        </Pressable>
                        <Text style={styles.tableDataJersey}>
                          {player.jerseyNumber ?? "-"}
                        </Text>
                        <Text style={styles.tableDataPos}>
                          {player.isGoalie ? "G" : player.position}
                        </Text>
                        <Text style={styles.tableDataGrade}>
                          {player.grade ?? "-"}
                        </Text>
                        <Text style={styles.tableDataPlayer}>
                          {player.fullName}
                        </Text>
                        <Pressable
                          style={[
                            styles.activeToggle,
                            player.isActive
                              ? styles.activeToggleOn
                              : styles.activeToggleOff,
                          ]}
                          hitSlop={8}
                          onPress={() => {
                            if (!activeTeamId) return;
                            togglePlayerActive(activeTeamId, player.playerId);
                            setRosterError("");
                          }}
                        >
                          <View
                            style={[
                              styles.activeToggleKnob,
                              player.isActive
                                ? styles.activeToggleKnobOn
                                : styles.activeToggleKnobOff,
                            ]}
                          />
                        </Pressable>
                      </View>
                    );
                  })
                )}

                <Text style={styles.sectionLabel}>COACHING STAFF</Text>
                {(activeCoaches.length > 0
                  ? activeCoaches
                  : [{ roleName: "Head Coach", coachName: "Not assigned" }]
                ).map((coach, idx) => {
                  const signedBy = activeTeamId
                    ? headCoachSignatures[activeTeamId]
                    : undefined;
                  const isHeadCoach = coach.roleName === "Head Coach";
                  return (
                    <View
                      key={`${coach.roleName}-${coach.coachName}-${idx}`}
                      style={
                        idx % 2 === 0
                          ? styles.officialRow
                          : styles.officialRowAlt
                      }
                    >
                      <View style={styles.officialRoleCol}>
                        <Text style={styles.officialRoleText}>
                          {coach.roleName.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.officialNameCol}>
                        <Text style={styles.officialNameText}>
                          {coach.coachName}
                        </Text>
                      </View>
                      <View style={styles.officialSignCol}>
                        {isHeadCoach ? (
                          <Pressable
                            style={styles.signaturePlaceholderMini}
                            onPress={() => {
                              if (!activeTeamId) return;
                              beginHeadCoachSignature(
                                activeTeamId,
                                activeTeamName,
                              );
                            }}
                          >
                            <Text style={styles.signatureTextMini}>
                              {signedBy ? `SIGNED: ${signedBy}` : "TAP TO SIGN"}
                            </Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.footerHint}>Assistant coach</Text>
                        )}
                      </View>
                    </View>
                  );
                })}

                <Text style={styles.sectionLabel}>VERIFICATION STATUS</Text>

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Home Starters</Text>
                  <Text style={styles.metaValue}>
                    {homeTeamId
                      ? getTeamStarterValidation(homeTeamId).count
                      : 0}
                    {homeTeamId &&
                    getTeamStarterValidation(homeTeamId).requiresSixStarters
                      ? "/6"
                      : ""}
                    {homeTeamId &&
                    getTeamStarterValidation(homeTeamId).hasGoalieStarter
                      ? " • Goalie OK"
                      : " • Need goalie"}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Away Starters</Text>
                  <Text style={styles.metaValue}>
                    {awayTeamId
                      ? getTeamStarterValidation(awayTeamId).count
                      : 0}
                    {awayTeamId &&
                    getTeamStarterValidation(awayTeamId).requiresSixStarters
                      ? "/6"
                      : ""}
                    {awayTeamId &&
                    getTeamStarterValidation(awayTeamId).hasGoalieStarter
                      ? " • Goalie OK"
                      : " • Need goalie"}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Head Coach Signatures</Text>
                  <Text style={styles.metaValue}>
                    {homeTeamId && headCoachSignatures[homeTeamId]
                      ? "Home Signed"
                      : "Home Pending"}{" "}
                    •{" "}
                    {awayTeamId && headCoachSignatures[awayTeamId]
                      ? "Away Signed"
                      : "Away Pending"}
                  </Text>
                </View>

                <Text style={styles.footerHint}>
                  {isVarsityLevelName(nextGame?.levelName || session.level)
                    ? "Select 6 starters per team (minimum 1 goalie), then collect both head coach signatures."
                    : "Select at least 1 goalie starter per team, then collect both head coach signatures."}
                </Text>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => setStage("verifyGame")}
                  >
                    <Text style={styles.secondaryButtonText}>Previous</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={goToOfficialsFromRoster}
                  >
                    <Text style={styles.primaryButtonText}>
                      Next: Verify Officials
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        ) : null}

        {stage === "coachSignature" && session && signatureContext ? (
          <View style={styles.card}>
            <Text style={styles.title}>
              {signatureContext.type === "coach"
                ? "Head Coach Signature"
                : "Official Signature"}
            </Text>
            <Text style={styles.note}>
              {signatureContext.type === "coach"
                ? `${signatureContext.teamName} • ${signatureContext.signerName}`
                : `${toOfficialRoleLabel(signatureContext.role)} • ${signatureContext.signerName}`}
            </Text>

            <Text style={styles.sectionLabel}>SIGNATURE CONFIRMATION</Text>
            <View style={styles.signaturePlaceholder}>
              <Text style={styles.signatureText}>
                Tap below to capture signature confirmation
              </Text>
            </View>

            <TextInput
              style={styles.inputInline}
              value={signatureNameInput}
              onChangeText={setSignatureNameInput}
              placeholder={
                signatureContext.type === "coach"
                  ? "Enter signing coach name"
                  : "Enter signing official name"
              }
              placeholderTextColor="#7a8fa8"
            />

            <View style={styles.rowButtons}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setSignatureContext(null);
                  setSignatureNameInput("");
                  setStage(
                    signatureContext.type === "coach"
                      ? "rosterVerify"
                      : "officialsVerify",
                  );
                }}
              >
                <Text style={styles.secondaryButtonText}>
                  {signatureContext.type === "coach"
                    ? "Back to Rosters"
                    : "Back to Officials"}
                </Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={confirmSignature}
              >
                <Text style={styles.primaryButtonText}>Confirm Signature</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {stage === "officialsVerify" && session ? (
          <View style={styles.card}>
            <Text style={styles.title}>Verify Officials</Text>
            <Text style={styles.note}>Tap to sign next to each official.</Text>

            {officialsError ? (
              <Text style={styles.error}>{officialsError}</Text>
            ) : null}

            {isOfficialsLoading ? (
              <View style={styles.nextGameLoadingWrap}>
                <ActivityIndicator color="#FF7B00" />
                <Text style={styles.nextGameEmptyText}>
                  Loading officials...
                </Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>OFFICIALS</Text>

            {!isOfficialsLoading ? (
              <Pressable
                style={styles.addOfficialButton}
                onPress={openAddOfficialModal}
              >
                <Text style={styles.addOfficialButtonText}>+ Add Official</Text>
              </Pressable>
            ) : null}

            {!isOfficialsLoading ? (
              <>
                {officials.map((official, idx) => (
                  <View
                    key={`${official.role}-${idx}`}
                    style={
                      idx % 2 === 0 ? styles.officialRow : styles.officialRowAlt
                    }
                  >
                    <Pressable
                      style={styles.officialRoleSelect}
                      onPress={() => {
                        const officialType =
                          officialOptions.find(
                            (option) =>
                              option.officialId === official.officialId,
                          )?.role || official.role;
                        const roles = OFFICIAL_ASSIGNMENT_ROLES.filter(
                          (role) =>
                            role.startsWith("Referee")
                              ? officialType.toLowerCase().includes("referee")
                              : officialType.toLowerCase().includes("linesman"),
                        );
                        openThemedDropdown({
                          title: `Change Role for ${official.officialName}`,
                          selectedValue: official.role,
                          options: [
                            ...roles.map((role) => ({
                              value: role,
                              label: toOfficialRoleLabel(role),
                            })),
                            { value: "remove", label: "Remove from Game" },
                          ],
                          onSelect: (role) => {
                            if (role === "remove") {
                              confirmRemoveOfficial(official);
                              return;
                            }
                            if (role !== official.role && official.officialId)
                              void assignOfficialToGame(
                                role,
                                official.officialId,
                                official.role,
                              );
                          },
                        });
                      }}
                    >
                      <Text style={styles.officialRoleText}>
                        {toOfficialRoleLabel(official.role).toUpperCase()}
                      </Text>
                      <Text style={styles.officialRoleChevron}>⌄</Text>
                    </Pressable>
                    <View style={styles.officialNameCol}>
                      <Text style={styles.officialNameText}>
                        {official.officialName || "Not assigned"}
                      </Text>
                    </View>
                    <View style={styles.officialSignCol}>
                      <Text style={styles.officialSignLabel}>SIGNATURE</Text>
                      <Pressable
                        style={[
                          styles.signaturePlaceholderMini,
                          official.signatureImageBase64 &&
                            styles.signaturePlaceholderSigned,
                        ]}
                        onPress={() => beginOfficialSignature(idx)}
                      >
                        <Text
                          style={[
                            styles.signatureTextMini,
                            official.signatureImageBase64 &&
                              styles.signatureTextSigned,
                          ]}
                        >
                          {official.signatureImageBase64
                            ? `SIGNED: ${(official.signedByName || official.officialName).toUpperCase()}`
                            : "TAP TO SIGN"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                {OFFICIAL_ASSIGNMENT_ROLES.filter(
                  (role) =>
                    !officials.some((official) => official.role === role),
                ).map((role, index) => {
                  const roleType = role.startsWith("Referee")
                    ? "Referee"
                    : "Linesman";
                  const assignedIds = new Set(
                    officials
                      .map((official) => official.officialId)
                      .filter(Boolean),
                  );
                  const compatibleOptions = officialOptions.filter(
                    (official) =>
                      official.role
                        .toLowerCase()
                        .includes(roleType.toLowerCase()) &&
                      !assignedIds.has(official.officialId),
                  );
                  return (
                    <View
                      key={role}
                      style={
                        index % 2 === 0
                          ? styles.officialRow
                          : styles.officialRowAlt
                      }
                    >
                      <View style={styles.officialRoleCol}>
                        <Text style={styles.officialRoleText}>
                          {toOfficialRoleLabel(role).toUpperCase()}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.officialSelectButton}
                        onPress={() =>
                          openThemedDropdown({
                            title: `Select ${toOfficialRoleLabel(role)}`,
                            selectedValue: "",
                            options: compatibleOptions.length
                              ? compatibleOptions.map((official) => ({
                                  value: official.officialId,
                                  label: official.displayName,
                                }))
                              : [
                                  {
                                    value: "",
                                    label: `No ${roleType.toLowerCase()}s available`,
                                  },
                                ],
                            onSelect: (officialId) => {
                              if (officialId)
                                void assignOfficialToGame(role, officialId);
                            },
                          })
                        }
                      >
                        <Text style={styles.officialSelectButtonText}>
                          Select Official
                        </Text>
                        <Text style={styles.officialSelectChevron}>⌄</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </>
            ) : null}

            <View style={styles.rowButtons}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setStage("rosterVerify")}
              >
                <Text style={styles.secondaryButtonText}>Previous</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={startGameFromOfficials}
              >
                <Text style={styles.primaryButtonText}>Start Game</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showAddOfficialModal ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowAddOfficialModal(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.addOfficialModal}>
                <View style={styles.addOfficialHeader}>
                  <Text style={styles.addOfficialTitle}>Add Official</Text>
                  <Pressable
                    style={styles.addOfficialClose}
                    onPress={() => setShowAddOfficialModal(false)}
                  >
                    <Text style={styles.addOfficialCloseText}>×</Text>
                  </Pressable>
                </View>
                <View style={styles.addOfficialDivider} />
                <ScrollView contentContainerStyle={styles.addOfficialBody}>
                  <Text style={styles.addOfficialSectionTitle}>
                    Official Information
                  </Text>
                  {officialsError ? (
                    <Text style={styles.error}>{officialsError}</Text>
                  ) : null}
                  <View style={styles.addOfficialFields}>
                    <View style={styles.addOfficialField}>
                      <Text style={styles.inputLabel}>First Name</Text>
                      <TextInput
                        style={styles.inputInline}
                        value={addOfficialForm.firstName}
                        onChangeText={(firstName) =>
                          setAddOfficialForm((current) => ({
                            ...current,
                            firstName,
                          }))
                        }
                      />
                    </View>
                    <View style={styles.addOfficialField}>
                      <Text style={styles.inputLabel}>Last Name</Text>
                      <TextInput
                        style={styles.inputInline}
                        value={addOfficialForm.lastName}
                        onChangeText={(lastName) =>
                          setAddOfficialForm((current) => ({
                            ...current,
                            lastName,
                          }))
                        }
                      />
                    </View>
                    <View style={styles.addOfficialField}>
                      <Text style={styles.inputLabel}>Email</Text>
                      <TextInput
                        style={styles.inputInline}
                        value={addOfficialForm.email}
                        onChangeText={(email) =>
                          setAddOfficialForm((current) => ({
                            ...current,
                            email,
                          }))
                        }
                        keyboardType="email-address"
                        autoCapitalize="none"
                        placeholder="name@example.com"
                        placeholderTextColor="#66758d"
                      />
                    </View>
                    <View style={styles.addOfficialRolesField}>
                      <Text style={styles.inputLabel}>Roles</Text>
                      <View style={styles.addOfficialRoleRow}>
                        <Text style={styles.addOfficialRoleText}>Referee</Text>
                        <Switch
                          value={addOfficialForm.isReferee}
                          onValueChange={(isReferee) =>
                            setAddOfficialForm((current) => ({
                              ...current,
                              isReferee,
                            }))
                          }
                          trackColor={{ false: "#475569", true: "#FF7B00" }}
                        />
                      </View>
                      <View style={styles.addOfficialRoleRow}>
                        <Text style={styles.addOfficialRoleText}>Linesman</Text>
                        <Switch
                          value={addOfficialForm.isLinesman}
                          onValueChange={(isLinesman) =>
                            setAddOfficialForm((current) => ({
                              ...current,
                              isLinesman,
                            }))
                          }
                          trackColor={{ false: "#475569", true: "#FF7B00" }}
                        />
                      </View>
                    </View>
                    <View style={styles.addOfficialField}>
                      <Text style={styles.inputLabel}>Game Assignment</Text>
                      <Pressable
                        style={styles.officialSelectButton}
                        onPress={() => {
                          const assignedRoles = new Set(
                            officials.map((official) => official.role),
                          );
                          const roles = OFFICIAL_ASSIGNMENT_ROLES.filter(
                            (role) =>
                              !assignedRoles.has(role) &&
                              (role.startsWith("Referee")
                                ? addOfficialForm.isReferee
                                : addOfficialForm.isLinesman),
                          );
                          openThemedDropdown({
                            title: "Select Game Assignment",
                            selectedValue: addOfficialForm.assignmentRole,
                            options: [
                              {
                                value: "",
                                label: "Add to Officials List Only",
                              },
                              ...roles.map((role) => ({
                                value: role,
                                label: toOfficialRoleLabel(role),
                              })),
                            ],
                            onSelect: (assignmentRole) =>
                              setAddOfficialForm((current) => ({
                                ...current,
                                assignmentRole,
                              })),
                          });
                        }}
                      >
                        <Text style={styles.officialSelectButtonText}>
                          {addOfficialForm.assignmentRole
                            ? toOfficialRoleLabel(
                                addOfficialForm.assignmentRole,
                              )
                            : "Officials List Only"}
                        </Text>
                        <Text style={styles.officialSelectChevron}>⌄</Text>
                      </Pressable>
                    </View>
                    <View style={styles.addOfficialField}>
                      <Text style={styles.inputLabel}>Active</Text>
                      <Switch
                        value={addOfficialForm.isActive}
                        onValueChange={(isActive) =>
                          setAddOfficialForm((current) => ({
                            ...current,
                            isActive,
                          }))
                        }
                        trackColor={{ false: "#475569", true: "#FF7B00" }}
                      />
                    </View>
                  </View>
                </ScrollView>
                <View style={styles.addOfficialFooter}>
                  <Pressable
                    style={styles.secondaryButton}
                    disabled={isSavingOfficial}
                    onPress={() => setShowAddOfficialModal(false)}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.primaryButton,
                      isSavingOfficial && styles.buttonDisabled,
                    ]}
                    disabled={isSavingOfficial}
                    onPress={saveNewOfficial}
                  >
                    <Text style={styles.primaryButtonText}>
                      {isSavingOfficial ? "Saving..." : "Save"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {showStartConfirm && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowStartConfirm(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmModal}>
                <View style={styles.confirmHeader}>
                  <Text style={styles.confirmIcon}>⚠</Text>
                  <Text style={styles.confirmTitle}>
                    Ready to Start the Game?
                  </Text>
                  <Text style={styles.confirmSubtitle}>
                    Please read the following carefully before proceeding.
                  </Text>
                </View>

                <View style={styles.confirmBody}>
                  <View style={styles.confirmWarningCard}>
                    <Text style={styles.confirmWarningIcon}>🔒</Text>
                    <View style={styles.confirmWarningTextWrap}>
                      <Text style={styles.confirmWarningTitle}>
                        Rosters are locked at game start
                      </Text>
                      <Text style={styles.confirmWarningText}>
                        No players can be added, removed, or modified on either
                        team's roster once the game has started.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.confirmWarningCard}>
                    <Text style={styles.confirmWarningIcon}>📋</Text>
                    <View style={styles.confirmWarningTextWrap}>
                      <Text style={styles.confirmWarningTitle}>
                        Officials are locked at game start
                      </Text>
                      <Text style={styles.confirmWarningText}>
                        Official assignments and signatures cannot be changed
                        after the game begins.
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.confirmFooterText}>
                    By confirming, you acknowledge that all roster and official
                    information is correct and final.
                  </Text>
                </View>

                <View style={styles.confirmActions}>
                  <Pressable
                    style={styles.confirmSecondaryButton}
                    onPress={() => setShowStartConfirm(false)}
                  >
                    <Text style={styles.confirmSecondaryButtonText}>
                      ← Go Back
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.confirmPrimaryButton}
                    onPress={handleConfirmStartGame}
                  >
                    <Text style={styles.confirmPrimaryButtonText}>
                      Confirm &amp; Start Game →
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {goalModal?.visible && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Goal Event</Text>
                <Text style={styles.goalModalSubtitle}>
                  {isRunningTimeActive
                    ? "Running time active. The game clock will continue."
                    : "Clock paused. Capture goal details to continue."}
                </Text>

                {goalModalError ? (
                  <Text style={styles.error}>{goalModalError}</Text>
                ) : null}

                <View style={styles.goalLockedGrid}>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Scoring Team</Text>
                    <Text style={styles.goalLockedValue}>
                      {goalModal.scoringTeamName}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Period</Text>
                    <Text style={styles.goalLockedValue}>
                      {goalModal.period}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Time</Text>
                    <Text style={styles.goalLockedValue}>
                      {goalModal.timeInPeriod}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Clock Remaining</Text>
                    <Text style={styles.goalLockedValue}>
                      {goalModal.clockRemaining}
                    </Text>
                  </View>
                </View>

                <Text style={styles.sectionLabel}>GOAL SCORER</Text>
                <Pressable
                  style={styles.themedSelectTrigger}
                  onPress={() =>
                    openThemedDropdown({
                      title: "Goal Scorer",
                      selectedValue: goalModal.scorerId,
                      onSelect: updateGoalScorer,
                      options: [
                        { value: "", label: "Select player..." },
                        ...sortRosterPlayersForPicker(goalTeamRoster).map(
                          (player) => ({
                            value: player.playerId,
                            label: formatPlayerPickerLabel(player),
                          }),
                        ),
                      ],
                    })
                  }
                >
                  <Text
                    style={[
                      styles.themedSelectValue,
                      !goalModal.scorerId && styles.themedSelectPlaceholder,
                    ]}
                  >
                    {goalModal.scorerId
                      ? formatPlayerPickerLabel(
                          goalTeamRoster.find(
                            (player) => player.playerId === goalModal.scorerId,
                          ) ?? {
                            playerId: "",
                            fullName: "Unknown Player",
                            jerseyNumber: null,
                            position: "-",
                            grade: null,
                            isGoalie: false,
                            isActive: true,
                          },
                        )
                      : "Select player..."}
                  </Text>
                  <Text style={styles.themedSelectChevron}>▾</Text>
                </Pressable>

                <Text style={styles.sectionLabel}>ASSIST 1 (OPTIONAL)</Text>
                <Pressable
                  style={styles.themedSelectTrigger}
                  onPress={() =>
                    openThemedDropdown({
                      title: "Assist 1",
                      selectedValue: goalModal.assist1Id,
                      onSelect: (value) =>
                        setGoalModal((prev) =>
                          prev ? { ...prev, assist1Id: value } : prev,
                        ),
                      options: [
                        { value: "", label: "None" },
                        ...sortRosterPlayersForPicker(
                          goalAssistRoster.filter(
                            (player) => player.playerId !== goalModal.assist2Id,
                          ),
                        ).map((player) => ({
                          value: player.playerId,
                          label: formatPlayerPickerLabel(player),
                        })),
                      ],
                    })
                  }
                >
                  <Text
                    style={[
                      styles.themedSelectValue,
                      !goalModal.assist1Id && styles.themedSelectPlaceholder,
                    ]}
                  >
                    {goalModal.assist1Id
                      ? formatPlayerPickerLabel(
                          goalAssistRoster.find(
                            (player) => player.playerId === goalModal.assist1Id,
                          ) ?? {
                            playerId: "",
                            fullName: "Unknown Player",
                            jerseyNumber: null,
                            position: "-",
                            grade: null,
                            isGoalie: false,
                            isActive: true,
                          },
                        )
                      : "None"}
                  </Text>
                  <Text style={styles.themedSelectChevron}>▾</Text>
                </Pressable>

                <Text style={styles.sectionLabel}>ASSIST 2 (OPTIONAL)</Text>
                <Pressable
                  style={styles.themedSelectTrigger}
                  onPress={() =>
                    openThemedDropdown({
                      title: "Assist 2",
                      selectedValue: goalModal.assist2Id,
                      onSelect: (value) =>
                        setGoalModal((prev) =>
                          prev ? { ...prev, assist2Id: value } : prev,
                        ),
                      options: [
                        { value: "", label: "None" },
                        ...sortRosterPlayersForPicker(
                          goalAssistRoster.filter(
                            (player) => player.playerId !== goalModal.assist1Id,
                          ),
                        ).map((player) => ({
                          value: player.playerId,
                          label: formatPlayerPickerLabel(player),
                        })),
                      ],
                    })
                  }
                >
                  <Text
                    style={[
                      styles.themedSelectValue,
                      !goalModal.assist2Id && styles.themedSelectPlaceholder,
                    ]}
                  >
                    {goalModal.assist2Id
                      ? formatPlayerPickerLabel(
                          goalAssistRoster.find(
                            (player) => player.playerId === goalModal.assist2Id,
                          ) ?? {
                            playerId: "",
                            fullName: "Unknown Player",
                            jerseyNumber: null,
                            position: "-",
                            grade: null,
                            isGoalie: false,
                            isActive: true,
                          },
                        )
                      : "None"}
                  </Text>
                  <Text style={styles.themedSelectChevron}>▾</Text>
                </Pressable>

                <Text style={styles.sectionLabel}>GOAL TYPE</Text>
                <View style={styles.goalTypeRow}>
                  {(
                    [
                      "Even Strength",
                      "Power Play",
                      "Short-Handed",
                      "Empty Net",
                      "Penalty Shot",
                    ] as GoalStrength[]
                  ).map((type) => (
                    <Pressable
                      key={type}
                      disabled={
                        type === "Even Strength" && shouldLockEvenStrength
                      }
                      style={[
                        styles.goalTypeButton,
                        goalModal.strength === type &&
                          styles.goalTypeButtonActive,
                        type === "Even Strength" &&
                          shouldLockEvenStrength &&
                          styles.goalTypeButtonDisabled,
                      ]}
                      onPress={() => {
                        if (type === "Even Strength" && shouldLockEvenStrength)
                          return;
                        setGoalModal((prev) =>
                          prev ? { ...prev, strength: type } : prev,
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.goalTypeButtonText,
                          goalModal.strength === type &&
                            styles.goalTypeButtonTextActive,
                          type === "Even Strength" &&
                            shouldLockEvenStrength &&
                            styles.goalTypeButtonTextDisabled,
                        ]}
                      >
                        {type}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {goalModalSkaterStrength === "Power Play" ? (
                  <Text style={styles.powerPlayIndicator}>PP Goal</Text>
                ) : null}

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closeGoalModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={saveGoalEvent}
                  >
                    <Text style={styles.primaryButtonText}>Save Goal</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {showClockModal && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowClockModal(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Set / Edit Clock</Text>
                <Text style={styles.goalModalSubtitle}>
                  Clock is stopped. Apply the scheduled period length or choose
                  a manual clock value.
                </Text>

                <Text style={styles.sectionLabel}>SCHEDULED PERIOD LENGTH</Text>
                <Pressable
                  style={styles.clockPresetButton}
                  onPress={applyScheduledPeriodLengthToClock}
                >
                  <Text style={styles.clockPresetButtonText}>
                    Reset to{" "}
                    {formatSecondsToClock(
                      getPeriodLengthMinutes(session.periodLength) * 60,
                    )}
                  </Text>
                </Pressable>

                <Text style={styles.sectionLabel}>MANUAL ADJUSTMENT</Text>
                <View style={styles.clockManualPanel}>
                  <View style={styles.clockManualHeaderRow}>
                    <Text style={styles.clockManualHeaderText}>MIN</Text>
                    <Text style={styles.clockManualHeaderText}>SEC</Text>
                  </View>

                  <View style={styles.clockManualAdjustRow}>
                    <View style={styles.clockManualColumn}>
                      <Pressable
                        style={styles.clockArrowButton}
                        onPress={() => adjustManualClock(60)}
                      >
                        <Text style={styles.clockArrowText}>▲</Text>
                      </Pressable>
                      <Text style={styles.clockGhostValue}>
                        {String(Math.min(60, clockModalMinutes + 1)).padStart(
                          2,
                          "0",
                        )}
                      </Text>
                      <View style={styles.clockValueBox}>
                        <Text style={styles.clockValueText}>
                          {String(clockModalMinutes).padStart(2, "0")}
                        </Text>
                      </View>
                      <Text style={styles.clockGhostValue}>
                        {String(Math.max(0, clockModalMinutes - 1)).padStart(
                          2,
                          "0",
                        )}
                      </Text>
                      <Pressable
                        style={styles.clockArrowButton}
                        onPress={() => adjustManualClock(-60)}
                      >
                        <Text style={styles.clockArrowText}>▼</Text>
                      </Pressable>
                    </View>

                    <Text style={styles.clockColon}>:</Text>

                    <View style={styles.clockManualColumn}>
                      <Pressable
                        style={styles.clockArrowButton}
                        onPress={() => adjustManualClock(1)}
                      >
                        <Text style={styles.clockArrowText}>▲</Text>
                      </Pressable>
                      <Text style={styles.clockGhostValue}>
                        {String((clockModalSeconds + 1) % 60).padStart(2, "0")}
                      </Text>
                      <View style={styles.clockValueBox}>
                        <Text style={styles.clockValueText}>
                          {String(clockModalSeconds).padStart(2, "0")}
                        </Text>
                      </View>
                      <Text style={styles.clockGhostValue}>
                        {String((clockModalSeconds + 59) % 60).padStart(2, "0")}
                      </Text>
                      <Pressable
                        style={styles.clockArrowButton}
                        onPress={() => adjustManualClock(-1)}
                      >
                        <Text style={styles.clockArrowText}>▼</Text>
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.clockManualFooter}>
                    Clock will be set to{" "}
                    <Text style={styles.clockManualFooterValue}>
                      {formatSecondsToClock(
                        clockModalMinutes * 60 + clockModalSeconds,
                      )}
                    </Text>
                  </Text>
                </View>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => setShowClockModal(false)}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={applyManualClockAdjustment}
                  >
                    <Text style={styles.primaryButtonText}>Apply Clock</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {timeoutModal?.visible && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={closeTimeoutModal}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Team Timeout</Text>
                <Text style={styles.goalModalSubtitle}>
                  Capture timeout details and log to the selected team.
                </Text>

                <View style={styles.goalLockedGrid}>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Period</Text>
                    <Text style={styles.goalLockedValue}>
                      {timeoutModal.period}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Time</Text>
                    <Text style={styles.goalLockedValue}>
                      {timeoutModal.timeInPeriod}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Clock Remaining</Text>
                    <Text style={styles.goalLockedValue}>
                      {timeoutModal.clockRemaining}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>
                      {timeoutModal.isRunning
                        ? "Timeout Remaining"
                        : "Timeout Length"}
                    </Text>
                    <Text style={styles.goalLockedValue}>
                      {formatSecondsToClock(
                        timeoutModal.isRunning
                          ? timeoutModal.remainingSeconds
                          : timeoutModal.durationSeconds,
                      )}
                    </Text>
                  </View>
                </View>

                <Text style={styles.sectionLabel}>TEAM</Text>
                <View style={styles.timeoutTeamRow}>
                  <Pressable
                    style={[
                      styles.timeoutTeamBtn,
                      timeoutModal.teamSide === "home" &&
                        styles.timeoutTeamBtnActive,
                      timeoutModal.isRunning && styles.disabledButton,
                    ]}
                    disabled={timeoutModal.isRunning}
                    onPress={() =>
                      setTimeoutModal((prev) =>
                        prev ? { ...prev, teamSide: "home" } : prev,
                      )
                    }
                  >
                    <Text style={styles.timeoutTeamBtnText}>
                      {session.homeTeam}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.timeoutTeamBtn,
                      timeoutModal.teamSide === "away" &&
                        styles.timeoutTeamBtnActive,
                      timeoutModal.isRunning && styles.disabledButton,
                    ]}
                    disabled={timeoutModal.isRunning}
                    onPress={() =>
                      setTimeoutModal((prev) =>
                        prev ? { ...prev, teamSide: "away" } : prev,
                      )
                    }
                  >
                    <Text style={styles.timeoutTeamBtnText}>
                      {session.awayTeam}
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.sectionLabel}>DURATION</Text>
                <View style={styles.timeoutAdjustRow}>
                  <Pressable
                    style={[
                      styles.penaltyAdjustModalBtnWide,
                      timeoutModal.isRunning && styles.disabledButton,
                    ]}
                    disabled={timeoutModal.isRunning}
                    onPress={() => adjustTimeoutDuration(-30)}
                  >
                    <Text style={styles.penaltyAdjustModalBtnText}>-30s</Text>
                  </Pressable>
                  <View style={styles.timeoutValueBox}>
                    <Text style={styles.timeoutValueText}>
                      {formatSecondsToClock(timeoutModal.durationSeconds)}
                    </Text>
                  </View>
                  <Pressable
                    style={[
                      styles.penaltyAdjustModalBtnWide,
                      timeoutModal.isRunning && styles.disabledButton,
                    ]}
                    disabled={timeoutModal.isRunning}
                    onPress={() => adjustTimeoutDuration(30)}
                  >
                    <Text style={styles.penaltyAdjustModalBtnText}>+30s</Text>
                  </Pressable>
                </View>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closeTimeoutModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.primaryButton,
                      timeoutModal.isRunning && styles.disabledButton,
                    ]}
                    disabled={timeoutModal.isRunning}
                    onPress={startTimeoutCountdown}
                  >
                    <Text style={styles.primaryButtonText}>
                      {timeoutModal.isRunning
                        ? "Timeout Running..."
                        : "Start Timeout"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {penaltyAdjustModal?.visible && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={closePenaltyAdjustModal}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Adjust Penalty Time</Text>
                <Text style={styles.goalModalSubtitle}>
                  {penaltyAdjustModal.teamName} •{" "}
                  {penaltyAdjustModal.playerName}
                </Text>
                <Text style={styles.goalModalSubtitle}>
                  {penaltyAdjustModal.infraction}
                </Text>

                <View style={styles.penaltyAdjustModalSummary}>
                  <View style={styles.penaltyAdjustSummaryCol}>
                    <Text style={styles.penaltyAdjustSummaryLabel}>
                      Current
                    </Text>
                    <Text style={styles.penaltyAdjustSummaryValue}>
                      {formatSecondsToClock(penaltyAdjustModal.currentSeconds)}
                    </Text>
                  </View>
                  <View style={styles.penaltyAdjustSummaryCol}>
                    <Text style={styles.penaltyAdjustSummaryLabel}>New</Text>
                    <Text style={styles.penaltyAdjustSummaryValue}>
                      {formatSecondsToClock(
                        penaltyAdjustModal.currentSeconds +
                          penaltyAdjustModal.deltaSeconds,
                      )}
                    </Text>
                  </View>
                </View>

                <View style={styles.penaltyAdjustLayoutRow}>
                  <View style={styles.penaltyAdjustColumn}>
                    <View style={styles.penaltyAdjustPairRow}>
                      <Pressable
                        style={styles.penaltyAdjustModalBtn}
                        onPress={() => shiftPenaltyAdjustPreview(-1)}
                      >
                        <Text style={styles.penaltyAdjustModalBtnText}>
                          -1s
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.penaltyAdjustModalBtn}
                        onPress={() => shiftPenaltyAdjustPreview(-5)}
                      >
                        <Text style={styles.penaltyAdjustModalBtnText}>
                          -5s
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={styles.penaltyAdjustModalBtnWide}
                      onPress={() => shiftPenaltyAdjustPreview(-15)}
                    >
                      <Text style={styles.penaltyAdjustModalBtnText}>-15s</Text>
                    </Pressable>
                  </View>

                  <View style={styles.penaltyAdjustColumn}>
                    <View style={styles.penaltyAdjustPairRow}>
                      <Pressable
                        style={styles.penaltyAdjustModalBtn}
                        onPress={() => shiftPenaltyAdjustPreview(1)}
                      >
                        <Text style={styles.penaltyAdjustModalBtnText}>
                          +1s
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.penaltyAdjustModalBtn}
                        onPress={() => shiftPenaltyAdjustPreview(5)}
                      >
                        <Text style={styles.penaltyAdjustModalBtnText}>
                          +5s
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={styles.penaltyAdjustModalBtnWide}
                      onPress={() => shiftPenaltyAdjustPreview(15)}
                    >
                      <Text style={styles.penaltyAdjustModalBtnText}>+15s</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closePenaltyAdjustModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={applyPenaltyAdjustModal}
                  >
                    <Text style={styles.primaryButtonText}>Set</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {showPeriodOverVerify && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowPeriodOverVerify(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Verify Period Over</Text>
                <Text style={styles.goalModalSubtitle}>
                  Clock reached 0:00. Move to intermission?
                </Text>
                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => setShowPeriodOverVerify(false)}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={confirmPeriodOver}
                  >
                    <Text style={styles.primaryButtonText}>
                      Confirm Period Over
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {showResumeVerify && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowResumeVerify(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Verify Resume</Text>
                <Text style={styles.goalModalSubtitle}>
                  Advance period and restart game clock?
                </Text>
                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => setShowResumeVerify(false)}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={confirmResumeFromIntermission}
                  >
                    <Text style={styles.primaryButtonText}>Resume Game</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {showEndOfRegulation && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowEndOfRegulation(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>End Of Regulation</Text>
                <Text style={styles.goalModalSubtitle}>
                  Choose overtime or finalize the game.
                </Text>
                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={handleGoToOvertime}
                  >
                    <Text style={styles.secondaryButtonText}>
                      Go To Overtime
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={() => {
                      setShowEndOfRegulation(false);
                      handleEndGame();
                    }}
                  >
                    <Text style={styles.primaryButtonText}>
                      End Game - Final
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {showSuspensionNotesModal && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowSuspensionNotesModal(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Suspension Notes</Text>
                <Text style={styles.goalModalSubtitle}>
                  Enter referee notes for DQ and suspension-related penalties.
                  These notes are stored with the game and included in review
                  reporting.
                </Text>
                {suspensionNotesError ? (
                  <Text style={styles.error}>{suspensionNotesError}</Text>
                ) : null}

                {gameDqPenaltyEvents.map((event) => (
                  <View key={event.localId} style={styles.dqNoteCard}>
                    <Text style={styles.dqNoteTitle}>
                      {event.teamName} - {event.playerName}
                    </Text>
                    <Text style={styles.dqNoteMeta}>
                      {event.infraction} -{" "}
                      {getPenaltyTypeLabel(event.penaltyType ?? "Minor")} • P
                      {event.period} {event.timeInPeriod}
                    </Text>
                    <TextInput
                      style={styles.dqNoteInput}
                      multiline
                      value={suspensionNotesByPenaltyId[event.localId] ?? ""}
                      onChangeText={(value) =>
                        setSuspensionNotesByPenaltyId((prev) => ({
                          ...prev,
                          [event.localId]: value,
                        }))
                      }
                      placeholder="Enter referee notes"
                      placeholderTextColor="#7a8fa8"
                    />
                  </View>
                ))}

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => {
                      setSuspensionNotesError("");
                      setShowSuspensionNotesModal(false);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={confirmSuspensionNotesAndContinue}
                  >
                    <Text style={styles.primaryButtonText}>Continue</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {rosterPreviewData && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setRosterPreviewTeam(null)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>
                  {rosterPreviewData.teamName} Active Roster
                </Text>

                <Text style={styles.sectionLabel}>PLAYERS</Text>
                <ScrollView style={styles.rosterPreviewList}>
                  {rosterPreviewData.players.length === 0 ? (
                    <Text style={styles.footerHint}>No active players.</Text>
                  ) : (
                    rosterPreviewData.players.map((player) => (
                      <View
                        key={`preview-${rosterPreviewData.teamName}-${player.playerId}`}
                        style={styles.rosterPreviewRow}
                      >
                        <View style={styles.rosterPreviewTitleRow}>
                          <Text style={styles.rosterPreviewName}>
                            {player.fullName}
                          </Text>
                          {rosterPreviewData.starterIds.has(player.playerId) ? (
                            <View style={styles.starterBadge}>
                              <Text style={styles.starterBadgeText}>
                                STARTER
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.rosterPreviewMeta}>
                          #{player.jerseyNumber ?? "-"} • Pos{" "}
                          {player.position || "-"} • Grade {player.grade ?? "-"}
                        </Text>
                      </View>
                    ))
                  )}

                  <Text style={styles.sectionLabel}>COACHES</Text>
                  {rosterPreviewData.coaches.length === 0 ? (
                    <Text style={styles.footerHint}>No coaches listed.</Text>
                  ) : (
                    rosterPreviewData.coaches.map((coach, index) => (
                      <View
                        key={`preview-coach-${coach.roleName}-${coach.coachName}-${index}`}
                        style={styles.rosterPreviewRow}
                      >
                        <Text style={styles.rosterPreviewName}>
                          {coach.coachName}
                        </Text>
                        <Text style={styles.rosterPreviewMeta}>
                          {coach.roleName}
                          {coach.coachEmail ? ` • ${coach.coachEmail}` : ""}
                        </Text>
                      </View>
                    ))
                  )}
                </ScrollView>

                <Pressable
                  style={styles.primaryButton}
                  onPress={() => setRosterPreviewTeam(null)}
                >
                  <Text style={styles.primaryButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {showOfficialsPreview && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowOfficialsPreview(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Assigned Officials</Text>

                <ScrollView style={styles.rosterPreviewList}>
                  {officials.length === 0 ? (
                    <Text style={styles.footerHint}>
                      No officials assigned.
                    </Text>
                  ) : (
                    officials.map((official, index) => (
                      <View
                        key={`preview-official-${official.role}-${index}`}
                        style={styles.rosterPreviewRow}
                      >
                        <View style={styles.rosterPreviewTitleRow}>
                          <Text style={styles.rosterPreviewName}>
                            {official.officialName || "Not assigned"}
                          </Text>
                          {official.signatureImageBase64 ? (
                            <View style={styles.starterBadge}>
                              <Text style={styles.starterBadgeText}>
                                SIGNED
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.rosterPreviewMeta}>
                          {toOfficialRoleLabel(official.role)}
                          {official.officialEmail
                            ? ` • ${official.officialEmail}`
                            : ""}
                        </Text>
                        {official.signedByName ? (
                          <Text style={styles.rosterPreviewMeta}>
                            Signed by {official.signedByName}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  )}
                </ScrollView>

                <Pressable
                  style={styles.primaryButton}
                  onPress={() => setShowOfficialsPreview(false)}
                >
                  <Text style={styles.primaryButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {showStarterInformation && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => setShowStarterInformation(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.starterInformationModal}>
                <Text style={styles.goalModalTitle}>Starter Information</Text>

                <ScrollView style={styles.starterInformationScroll}>
                  <View style={styles.starterInformationTeamGrid}>
                    {starterInformationTeams.map((team) => (
                      <View
                        key={`starter-information-${team.teamId}`}
                        style={styles.starterInformationTeamColumn}
                      >
                        <Text style={styles.starterInformationTeamTitle}>
                          {team.side.toUpperCase()} TEAM
                        </Text>
                        <Text style={styles.starterInformationTeamName}>
                          {team.teamName}
                        </Text>
                        <Text style={styles.rosterPreviewGroupLabel}>
                          STARTERS
                        </Text>
                        {team.starters.length === 0 ? (
                          <Text style={styles.footerHint}>
                            No starters selected.
                          </Text>
                        ) : (
                          team.starterGroups.map((group) => (
                            <View
                              key={`starter-information-group-${team.teamId}-${group.label}`}
                            >
                              <Text
                                style={styles.starterInformationPositionLabel}
                              >
                                {group.label}
                              </Text>
                              {group.players.map((player) => (
                                <View
                                  key={`starter-information-player-${team.teamId}-${player.playerId}`}
                                  style={styles.rosterPreviewRow}
                                >
                                  <Text
                                    style={styles.starterInformationPlayerLine}
                                    numberOfLines={1}
                                  >
                                    #{player.jerseyNumber ?? "-"}{" "}
                                    {player.fullName}{" "}
                                    {player.isGoalie
                                      ? "G"
                                      : player.position || "-"}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ))
                        )}

                        <Text style={styles.rosterPreviewGroupLabel}>
                          COACHES
                        </Text>
                        {team.coaches.length === 0 ? (
                          <Text style={styles.footerHint}>
                            No coaches listed.
                          </Text>
                        ) : (
                          team.coaches.map((coach, index) => (
                            <View
                              key={`starter-information-coach-${team.teamId}-${coach.roleName}-${index}`}
                              style={styles.rosterPreviewRow}
                            >
                              <Text style={styles.starterInformationPlayerLine}>
                                {coach.coachName}
                              </Text>
                              <Text style={styles.rosterPreviewMeta}>
                                {coach.roleName}
                              </Text>
                            </View>
                          ))
                        )}
                      </View>
                    ))}
                  </View>

                  <View style={styles.starterInformationOfficials}>
                    <Text style={styles.sectionLabel}>OFFICIALS</Text>
                    {officials.length === 0 ? (
                      <Text style={styles.footerHint}>
                        No officials assigned.
                      </Text>
                    ) : (
                      officials.map((official, index) => (
                        <View
                          key={`starter-information-official-${official.role}-${index}`}
                          style={styles.rosterPreviewRow}
                        >
                          <Text style={styles.starterInformationPlayerLine}>
                            {official.officialName || "Not assigned"}
                          </Text>
                          <Text style={styles.rosterPreviewMeta}>
                            {toOfficialRoleLabel(official.role)}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                </ScrollView>

                <Pressable
                  style={styles.primaryButton}
                  onPress={() => setShowStarterInformation(false)}
                >
                  <Text style={styles.primaryButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {goalieModal?.visible ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>
                  {goalieModal.teamName} Goalie
                </Text>
                <Text style={styles.goalModalSubtitle}>
                  Change goalie or pull/return goalie status.
                </Text>

                <Text style={styles.sectionLabel}>SELECT GOALIE</Text>
                <Pressable
                  style={styles.themedSelectTrigger}
                  onPress={() =>
                    openThemedDropdown({
                      title: "Select Goalie",
                      selectedValue: goalieModal.selectedGoalieId,
                      onSelect: (value) =>
                        setGoalieModal((prev) =>
                          prev ? { ...prev, selectedGoalieId: value } : prev,
                        ),
                      options: getRosterForTeam(goalieModal.teamId)
                        .filter((player) => player.isGoalie && player.isActive)
                        .map((goalie) => ({
                          value: goalie.playerId,
                          label: formatPlayerPickerLabel(goalie),
                        })),
                    })
                  }
                >
                  <Text style={styles.themedSelectValue}>
                    {formatPlayerPickerLabel(
                      getRosterForTeam(goalieModal.teamId).find(
                        (player) =>
                          player.playerId === goalieModal.selectedGoalieId,
                      ) ?? {
                        playerId: "",
                        fullName: "Unknown Goalie",
                        jerseyNumber: null,
                        position: "G",
                        grade: null,
                        isGoalie: true,
                        isActive: true,
                      },
                    )}
                  </Text>
                  <Text style={styles.themedSelectChevron}>▾</Text>
                </Pressable>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={applyGoalieChange}
                  >
                    <Text style={styles.secondaryButtonText}>
                      Change Goalie
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={toggleGoaliePulledFromModal}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {(
                        goalieModal.side === "home"
                          ? homeGoaliePulled
                          : awayGoaliePulled
                      )
                        ? "Return Goalie"
                        : "Pull Goalie"}
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  style={styles.primaryButton}
                  onPress={closeGoalieChangeModal}
                >
                  <Text style={styles.primaryButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {eventActionModal?.visible ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={closeEventActions}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Event Options</Text>
                <Text style={styles.goalModalSubtitle}>
                  Edit or delete selected event.
                </Text>
                <View style={styles.rowButtons}>
                  {eventActionModal.event.eventType !== "Timeout" &&
                  eventActionModal.event.eventType !== "Shot" ? (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => openEventEditModal(eventActionModal.event)}
                    >
                      <Text style={styles.secondaryButtonText}>Edit Event</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={requestDeleteSelectedEvent}
                  >
                    <Text style={styles.secondaryButtonText}>Delete Event</Text>
                  </Pressable>
                </View>
                <Pressable
                  style={styles.primaryButton}
                  onPress={closeEventActions}
                >
                  <Text style={styles.primaryButtonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {eventDeleteConfirmModal?.visible ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={closeEventDeleteConfirmModal}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Verify Delete</Text>
                <Text style={styles.goalModalSubtitle}>
                  Are you sure you want to delete this{" "}
                  {eventDeleteConfirmModal.event.eventType.toLowerCase()} event?
                </Text>
                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closeEventDeleteConfirmModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={deleteSelectedEvent}
                  >
                    <Text style={styles.primaryButtonText}>Delete Event</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {eventEditModal?.visible ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={closeEventEditModal}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Edit Event</Text>
                <Text style={styles.goalModalSubtitle}>
                  Update event details and save.
                </Text>
                {eventEditModalError ? (
                  <Text style={styles.error}>{eventEditModalError}</Text>
                ) : null}

                <ScrollView
                  style={styles.eventEditScrollView}
                  contentContainerStyle={styles.eventEditScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.sectionLabel}>EVENT TIMING</Text>
                  <View style={styles.twoColRow}>
                    <View style={styles.twoColCell}>
                      <Text style={styles.inputLabel}>Period</Text>
                      <Pressable
                        style={styles.themedSelectTrigger}
                        onPress={() =>
                          openThemedDropdown({
                            title: "Event Period",
                            selectedValue: String(eventEditModal.period),
                            options: [
                              { value: "1", label: "1st Period" },
                              { value: "2", label: "2nd Period" },
                              { value: "3", label: "3rd Period" },
                              { value: "4", label: "Overtime" },
                            ],
                            onSelect: (value) =>
                              setEventEditModal((prev) =>
                                prev
                                  ? { ...prev, period: Number(value) }
                                  : prev,
                              ),
                          })
                        }
                      >
                        <Text style={styles.themedSelectValue}>
                          {eventEditModal.period === 4
                            ? "Overtime"
                            : `${eventEditModal.period}${eventEditModal.period === 1 ? "st" : eventEditModal.period === 2 ? "nd" : "rd"} Period`}
                        </Text>
                        <Text style={styles.themedSelectChevron}>▾</Text>
                      </Pressable>
                    </View>
                    <View style={styles.twoColCell}>
                      <Text style={styles.inputLabel}>Time (MM:SS)</Text>
                      <TextInput
                        style={styles.inputInline}
                        value={eventEditModal.timeInPeriod}
                        onChangeText={(timeInPeriod) =>
                          setEventEditModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  timeInPeriod:
                                    timeInPeriod.includes(":") &&
                                    timeInPeriod.length <= 5
                                      ? timeInPeriod
                                      : formatEventTimeInput(timeInPeriod),
                                }
                              : prev,
                          )
                        }
                        keyboardType="number-pad"
                        maxLength={5}
                        placeholder="00:00"
                        placeholderTextColor="#66758d"
                      />
                    </View>
                  </View>

                  {eventEditModal.event.eventType === "Goal" ? (
                    <>
                      <View style={styles.goalLockedGrid}>
                        <View style={styles.goalLockedItem}>
                          <Text style={styles.goalLockedLabel}>
                            Scoring Team
                          </Text>
                          <Text style={styles.goalLockedValue}>
                            {eventEditModal.teamId === homeTeamId
                              ? (session?.homeTeam ??
                                eventEditModal.event.teamName)
                              : eventEditModal.teamId === awayTeamId
                                ? (session?.awayTeam ??
                                  eventEditModal.event.teamName)
                                : eventEditModal.event.teamName}
                          </Text>
                        </View>
                        <View style={styles.goalLockedItem}>
                          <Text style={styles.goalLockedLabel}>
                            Strength Context
                          </Text>
                          <Text style={styles.goalLockedValue}>
                            {eventEditSkaterStrength}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.sectionLabel}>SCORER</Text>
                      <Pressable
                        style={styles.themedSelectTrigger}
                        onPress={() =>
                          openThemedDropdown({
                            title: "Scorer",
                            selectedValue: eventEditModal.playerId,
                            onSelect: (value) =>
                              setEventEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      playerId: value,
                                      assist1Id:
                                        prev.assist1Id === value
                                          ? ""
                                          : prev.assist1Id,
                                      assist2Id:
                                        prev.assist2Id === value
                                          ? ""
                                          : prev.assist2Id,
                                    }
                                  : prev,
                              ),
                            options: [
                              { value: "", label: "Select player..." },
                              ...sortRosterPlayersForPicker(
                                eventEditTeamRoster,
                              ).map((player) => ({
                                value: player.playerId,
                                label: formatPlayerPickerLabel(player),
                              })),
                            ],
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.themedSelectValue,
                            !eventEditModal.playerId &&
                              styles.themedSelectPlaceholder,
                          ]}
                        >
                          {eventEditModal.playerId
                            ? formatPlayerPickerLabel(
                                eventEditTeamRoster.find(
                                  (player) =>
                                    player.playerId === eventEditModal.playerId,
                                ) ?? {
                                  playerId: "",
                                  fullName: "Unknown Player",
                                  jerseyNumber: null,
                                  position: "-",
                                  grade: null,
                                  isGoalie: false,
                                  isActive: true,
                                },
                              )
                            : "Select player..."}
                        </Text>
                        <Text style={styles.themedSelectChevron}>▾</Text>
                      </Pressable>

                      <Text style={styles.sectionLabel}>ASSIST 1</Text>
                      <Pressable
                        style={styles.themedSelectTrigger}
                        onPress={() =>
                          openThemedDropdown({
                            title: "Assist 1",
                            selectedValue: eventEditModal.assist1Id,
                            onSelect: (value) =>
                              setEventEditModal((prev) =>
                                prev ? { ...prev, assist1Id: value } : prev,
                              ),
                            options: [
                              { value: "", label: "None" },
                              ...sortRosterPlayersForPicker(
                                eventEditAssistRoster.filter(
                                  (player) =>
                                    player.playerId !==
                                    eventEditModal.assist2Id,
                                ),
                              ).map((player) => ({
                                value: player.playerId,
                                label: formatPlayerPickerLabel(player),
                              })),
                            ],
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.themedSelectValue,
                            !eventEditModal.assist1Id &&
                              styles.themedSelectPlaceholder,
                          ]}
                        >
                          {eventEditModal.assist1Id
                            ? formatPlayerPickerLabel(
                                eventEditTeamRoster.find(
                                  (player) =>
                                    player.playerId ===
                                    eventEditModal.assist1Id,
                                ) ?? {
                                  playerId: "",
                                  fullName: "Unknown Player",
                                  jerseyNumber: null,
                                  position: "-",
                                  grade: null,
                                  isGoalie: false,
                                  isActive: true,
                                },
                              )
                            : "None"}
                        </Text>
                        <Text style={styles.themedSelectChevron}>▾</Text>
                      </Pressable>

                      <Text style={styles.sectionLabel}>ASSIST 2</Text>
                      <Pressable
                        style={styles.themedSelectTrigger}
                        onPress={() =>
                          openThemedDropdown({
                            title: "Assist 2",
                            selectedValue: eventEditModal.assist2Id,
                            onSelect: (value) =>
                              setEventEditModal((prev) =>
                                prev ? { ...prev, assist2Id: value } : prev,
                              ),
                            options: [
                              { value: "", label: "None" },
                              ...sortRosterPlayersForPicker(
                                eventEditAssistRoster.filter(
                                  (player) =>
                                    player.playerId !==
                                    eventEditModal.assist1Id,
                                ),
                              ).map((player) => ({
                                value: player.playerId,
                                label: formatPlayerPickerLabel(player),
                              })),
                            ],
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.themedSelectValue,
                            !eventEditModal.assist2Id &&
                              styles.themedSelectPlaceholder,
                          ]}
                        >
                          {eventEditModal.assist2Id
                            ? formatPlayerPickerLabel(
                                eventEditTeamRoster.find(
                                  (player) =>
                                    player.playerId ===
                                    eventEditModal.assist2Id,
                                ) ?? {
                                  playerId: "",
                                  fullName: "Unknown Player",
                                  jerseyNumber: null,
                                  position: "-",
                                  grade: null,
                                  isGoalie: false,
                                  isActive: true,
                                },
                              )
                            : "None"}
                        </Text>
                        <Text style={styles.themedSelectChevron}>▾</Text>
                      </Pressable>

                      <Text style={styles.sectionLabel}>GOAL TYPE</Text>
                      <View style={styles.goalTypeRow}>
                        {(
                          [
                            "Even Strength",
                            "Power Play",
                            "Short-Handed",
                            "Empty Net",
                            "Penalty Shot",
                          ] as GoalStrength[]
                        ).map((type) => (
                          <Pressable
                            key={type}
                            disabled={
                              type === "Even Strength" &&
                              shouldLockEventEditEvenStrength
                            }
                            style={[
                              styles.goalTypeButton,
                              eventEditModal.strength === type &&
                                styles.goalTypeButtonActive,
                              type === "Even Strength" &&
                                shouldLockEventEditEvenStrength &&
                                styles.goalTypeButtonDisabled,
                            ]}
                            onPress={() => {
                              if (
                                type === "Even Strength" &&
                                shouldLockEventEditEvenStrength
                              )
                                return;
                              setEventEditModal((prev) =>
                                prev ? { ...prev, strength: type } : prev,
                              );
                            }}
                          >
                            <Text
                              style={[
                                styles.goalTypeButtonText,
                                eventEditModal.strength === type &&
                                  styles.goalTypeButtonTextActive,
                                type === "Even Strength" &&
                                  shouldLockEventEditEvenStrength &&
                                  styles.goalTypeButtonTextDisabled,
                              ]}
                            >
                              {type}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      {eventEditSkaterStrength === "Power Play" ? (
                        <Text style={styles.powerPlayIndicator}>PP Goal</Text>
                      ) : null}
                    </>
                  ) : eventEditModal.event.eventType === "Penalty" ? (
                    <>
                      <View style={styles.goalLockedGrid}>
                        <View style={styles.goalLockedItem}>
                          <Text style={styles.goalLockedLabel}>
                            Penalized Team
                          </Text>
                          <Text style={styles.goalLockedValue}>
                            {eventEditModal.teamId === homeTeamId
                              ? (session?.homeTeam ??
                                eventEditModal.event.teamName)
                              : eventEditModal.teamId === awayTeamId
                                ? (session?.awayTeam ??
                                  eventEditModal.event.teamName)
                                : eventEditModal.event.teamName}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.sectionLabel}>PENALIZED PLAYER</Text>
                      <Pressable
                        style={styles.themedSelectTrigger}
                        onPress={() =>
                          openThemedDropdown({
                            title: "Penalized Player",
                            selectedValue: eventEditModal.playerId,
                            onSelect: (value) =>
                              setEventEditModal((prev) =>
                                prev ? { ...prev, playerId: value } : prev,
                              ),
                            options: [
                              { value: "", label: "Select player..." },
                              ...sortRosterPlayersForPicker(
                                eventEditTeamRoster,
                              ).map((player) => ({
                                value: player.playerId,
                                label: formatPlayerPickerLabel(player),
                              })),
                            ],
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.themedSelectValue,
                            !eventEditModal.playerId &&
                              styles.themedSelectPlaceholder,
                          ]}
                        >
                          {eventEditModal.playerId
                            ? formatPlayerPickerLabel(
                                eventEditTeamRoster.find(
                                  (player) =>
                                    player.playerId === eventEditModal.playerId,
                                ) ?? {
                                  playerId: "",
                                  fullName: "Unknown Player",
                                  jerseyNumber: null,
                                  position: "-",
                                  grade: null,
                                  isGoalie: false,
                                  isActive: true,
                                },
                              )
                            : "Select player..."}
                        </Text>
                        <Text style={styles.themedSelectChevron}>▾</Text>
                      </Pressable>

                      <Text style={styles.sectionLabel}>QUICK PICK</Text>
                      <View style={styles.quickPickRow}>
                        {QUICK_PICK_INFRACTIONS.map((infraction) => (
                          <Pressable
                            key={`edit-quick-${infraction}`}
                            style={[
                              styles.quickPickPill,
                              eventEditModal.infraction === infraction &&
                                styles.quickPickPillActive,
                            ]}
                            onPress={() =>
                              setEventEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      infraction,
                                      penaltyType:
                                        resolvePenaltyTypeForInfraction(
                                          infraction,
                                          prev.penaltyType,
                                        ),
                                      durationMinutes:
                                        getPenaltyDurationMinutes(
                                          resolvePenaltyTypeForInfraction(
                                            infraction,
                                            prev.penaltyType,
                                          ),
                                        ),
                                    }
                                  : prev,
                              )
                            }
                          >
                            <Text
                              style={[
                                styles.quickPickPillText,
                                eventEditModal.infraction === infraction &&
                                  styles.quickPickPillTextActive,
                              ]}
                            >
                              {infraction}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.sectionLabel}>INFRACTION</Text>
                      <Pressable
                        style={styles.themedSelectTrigger}
                        onPress={() =>
                          openThemedDropdown({
                            title: "Infraction",
                            selectedValue: eventEditModal.infraction,
                            onSelect: (value) =>
                              setEventEditModal((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      infraction: value,
                                      penaltyType:
                                        resolvePenaltyTypeForInfraction(
                                          value,
                                          prev.penaltyType,
                                        ),
                                      durationMinutes:
                                        getPenaltyDurationMinutes(
                                          resolvePenaltyTypeForInfraction(
                                            value,
                                            prev.penaltyType,
                                          ),
                                        ),
                                    }
                                  : prev,
                              ),
                            options: ALL_HOCKEY_INFRACTIONS_SORTED.map(
                              (infraction) => ({
                                value: infraction,
                                label: infraction,
                              }),
                            ),
                          })
                        }
                      >
                        <Text style={styles.themedSelectValue}>
                          {eventEditModal.infraction}
                        </Text>
                        <Text style={styles.themedSelectChevron}>▾</Text>
                      </Pressable>

                      <Text style={styles.sectionLabel}>PENALTY TYPE</Text>
                      <View style={styles.goalTypeRow}>
                        {PENALTY_TYPE_OPTIONS.map((option) => {
                          const selected =
                            normalizePenaltyType(eventEditModal.penaltyType) ===
                            option.value;
                          return (
                            <Pressable
                              key={`edit-ptype-${option.value}`}
                              style={[
                                styles.goalTypeButton,
                                selected && styles.goalTypeButtonActive,
                              ]}
                              onPress={() =>
                                setEventEditModal((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        penaltyType: option.value,
                                        durationMinutes:
                                          getPenaltyDurationMinutes(
                                            option.value,
                                          ),
                                      }
                                    : prev,
                                )
                              }
                            >
                              <Text
                                style={[
                                  styles.goalTypeButtonText,
                                  selected && styles.goalTypeButtonTextActive,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={styles.sectionLabel}>
                        DURATION (MINUTES)
                      </Text>
                      <View style={styles.themedSelectTrigger}>
                        <Text style={styles.themedSelectValue}>
                          {getPenaltyDurationMinutes(
                            eventEditModal.penaltyType,
                          )}{" "}
                          min
                        </Text>
                        <Text style={styles.themedSelectChevron}>•</Text>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.footerHint}>
                      Only Period and Time can be edited for goalie events.
                    </Text>
                  )}
                </ScrollView>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closeEventEditModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={saveEventEdit}
                  >
                    <Text style={styles.primaryButtonText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {penaltyModal?.visible && session ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Penalty Event</Text>
                <Text style={styles.goalModalSubtitle}>
                  {isRunningTimeActive
                    ? "Running time active. The game clock will continue."
                    : "Clock paused. Capture penalty details to continue."}
                </Text>

                {penaltyModalError ? (
                  <Text style={styles.error}>{penaltyModalError}</Text>
                ) : null}

                <View style={styles.goalLockedGrid}>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Penalized Team</Text>
                    <Text style={styles.goalLockedValue}>
                      {penaltyModal.penalizedTeamName}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Period</Text>
                    <Text style={styles.goalLockedValue}>
                      {penaltyModal.period}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Time</Text>
                    <Text style={styles.goalLockedValue}>
                      {penaltyModal.timeInPeriod}
                    </Text>
                  </View>
                  <View style={styles.goalLockedItem}>
                    <Text style={styles.goalLockedLabel}>Clock Remaining</Text>
                    <Text style={styles.goalLockedValue}>
                      {penaltyModal.clockRemaining}
                    </Text>
                  </View>
                </View>

                <Text style={styles.sectionLabel}>PENALIZED PLAYER</Text>
                <Pressable
                  style={styles.themedSelectTrigger}
                  onPress={() =>
                    openThemedDropdown({
                      title: "Penalized Player",
                      selectedValue: penaltyModal.playerId,
                      onSelect: (value) =>
                        setPenaltyModal((prev) =>
                          prev ? { ...prev, playerId: value } : prev,
                        ),
                      options: [
                        { value: "", label: "Select player..." },
                        ...sortRosterPlayersForPicker(penaltyTeamRoster).map(
                          (player) => ({
                            value: player.playerId,
                            label: formatPlayerPickerLabel(player),
                          }),
                        ),
                      ],
                    })
                  }
                >
                  <Text
                    style={[
                      styles.themedSelectValue,
                      !penaltyModal.playerId && styles.themedSelectPlaceholder,
                    ]}
                  >
                    {penaltyModal.playerId
                      ? formatPlayerPickerLabel(
                          penaltyTeamRoster.find(
                            (player) =>
                              player.playerId === penaltyModal.playerId,
                          ) ?? {
                            playerId: "",
                            fullName: "Unknown Player",
                            jerseyNumber: null,
                            position: "-",
                            grade: null,
                            isGoalie: false,
                            isActive: true,
                          },
                        )
                      : "Select player..."}
                  </Text>
                  <Text style={styles.themedSelectChevron}>▾</Text>
                </Pressable>

                <Text style={styles.sectionLabel}>QUICK PICK</Text>
                <View style={styles.quickPickRow}>
                  {QUICK_PICK_INFRACTIONS.map((infraction) => (
                    <Pressable
                      key={infraction}
                      style={[
                        styles.quickPickPill,
                        penaltyModal.infraction === infraction &&
                          styles.quickPickPillActive,
                      ]}
                      onPress={() =>
                        setPenaltyModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                infraction,
                                penaltyType: resolvePenaltyTypeForInfraction(
                                  infraction,
                                  prev.penaltyType,
                                ),
                                durationMinutes: getPenaltyDurationMinutes(
                                  resolvePenaltyTypeForInfraction(
                                    infraction,
                                    prev.penaltyType,
                                  ),
                                ),
                              }
                            : prev,
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.quickPickPillText,
                          penaltyModal.infraction === infraction &&
                            styles.quickPickPillTextActive,
                        ]}
                      >
                        {infraction}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.sectionLabel}>INFRACTION</Text>
                <Pressable
                  style={styles.themedSelectTrigger}
                  onPress={() =>
                    openThemedDropdown({
                      title: "Infraction",
                      selectedValue: penaltyModal.infraction,
                      onSelect: (value) =>
                        setPenaltyModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                infraction: value,
                                penaltyType: resolvePenaltyTypeForInfraction(
                                  value,
                                  prev.penaltyType,
                                ),
                                durationMinutes: getPenaltyDurationMinutes(
                                  resolvePenaltyTypeForInfraction(
                                    value,
                                    prev.penaltyType,
                                  ),
                                ),
                              }
                            : prev,
                        ),
                      options: ALL_HOCKEY_INFRACTIONS_SORTED.map(
                        (infraction) => ({
                          value: infraction,
                          label: infraction,
                        }),
                      ),
                    })
                  }
                >
                  <Text style={styles.themedSelectValue}>
                    {penaltyModal.infraction}
                  </Text>
                  <Text style={styles.themedSelectChevron}>▾</Text>
                </Pressable>

                <Text style={styles.sectionLabel}>PENALTY TYPE</Text>
                <View style={styles.goalTypeRow}>
                  {PENALTY_TYPE_OPTIONS.map((option) => {
                    const selected =
                      normalizePenaltyType(penaltyModal.penaltyType) ===
                      option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={[
                          styles.goalTypeButton,
                          selected && styles.goalTypeButtonActive,
                        ]}
                        onPress={() =>
                          setPenaltyModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  penaltyType: option.value,
                                  durationMinutes: getPenaltyDurationMinutes(
                                    option.value,
                                  ),
                                }
                              : prev,
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.goalTypeButtonText,
                            selected && styles.goalTypeButtonTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.sectionLabel}>DURATION (MINUTES)</Text>
                <View style={styles.themedSelectTrigger}>
                  <Text style={styles.themedSelectValue}>
                    {getPenaltyDurationMinutes(penaltyModal.penaltyType)} min
                  </Text>
                  <Text style={styles.themedSelectChevron}>•</Text>
                </View>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closePenaltyModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={savePenaltyEvent}
                  >
                    <Text style={styles.primaryButtonText}>Save Penalty</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {activeDropdown ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
          >
            <View style={styles.dropdownOverlay}>
              <View style={styles.dropdownCard}>
                <Text style={styles.dropdownTitle}>{activeDropdown.title}</Text>
                <ScrollView
                  style={styles.dropdownList}
                  contentContainerStyle={styles.dropdownListContent}
                  showsVerticalScrollIndicator
                >
                  {activeDropdown.options.map((option) => {
                    const selected =
                      option.value === activeDropdown.selectedValue;
                    return (
                      <Pressable
                        key={`${activeDropdown.title}-${option.value || "empty"}`}
                        style={[
                          styles.dropdownOption,
                          selected && styles.dropdownOptionSelected,
                        ]}
                        onPress={() => selectThemedDropdownValue(option.value)}
                      >
                        <Text
                          style={[
                            styles.dropdownOptionText,
                            selected && styles.dropdownOptionTextSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  style={styles.dropdownCloseButton}
                  onPress={closeThemedDropdown}
                >
                  <Text style={styles.dropdownCloseButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {showScoreboardSettingsModal ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={closeScoreboardSettingsModal}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.goalModal}>
                <Text style={styles.goalModalTitle}>Scoreboard Settings</Text>
                <Text style={styles.goalModalSubtitle}>
                  Read-only websocket connection to TipIn Gateway (no clock
                  control).
                </Text>

                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>
                    Connect to Scoreboard:{" "}
                    {scoreboardSettingsDraft.enabled ? "On" : "Off"}
                  </Text>
                  <Switch
                    value={scoreboardSettingsDraft.enabled}
                    onValueChange={(value) =>
                      setScoreboardSettingsDraft((prev) => ({
                        ...prev,
                        enabled: value,
                      }))
                    }
                    trackColor={{ false: "#516273", true: "#2f9fe8" }}
                    thumbColor={
                      scoreboardSettingsDraft.enabled ? "#dff2ff" : "#d4dbe3"
                    }
                  />
                </View>

                <Text style={styles.sectionLabel}>GATEWAY IP ADDRESS</Text>
                <TextInput
                  style={styles.inputCompact}
                  value={scoreboardSettingsDraft.host}
                  onChangeText={(value) =>
                    setScoreboardSettingsDraft((prev) => ({
                      ...prev,
                      host: value,
                    }))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="192.168.68.66"
                  placeholderTextColor="#7a8fa8"
                />

                <Text style={styles.sectionLabel}>TCP PORT</Text>
                <TextInput
                  style={styles.inputCompact}
                  value={scoreboardSettingsDraft.port}
                  onChangeText={(value) =>
                    setScoreboardSettingsDraft((prev) => ({
                      ...prev,
                      port: value.replace(/[^0-9]/g, ""),
                    }))
                  }
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="80"
                  placeholderTextColor="#7a8fa8"
                />

                <Text style={styles.sectionLabel}>TOKEN SECRET</Text>
                <TextInput
                  style={styles.inputCompact}
                  value={scoreboardSettingsDraft.tokenSecret}
                  onChangeText={(value) =>
                    setScoreboardSettingsDraft((prev) => ({
                      ...prev,
                      tokenSecret: value,
                    }))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showScoreboardTokenSecret}
                  placeholder="Enter gateway token"
                  placeholderTextColor="#7a8fa8"
                />

                <View style={styles.scoreboardTokenMetaRow}>
                  <Text style={styles.scoreboardTokenMetaText}>
                    Saved token:{" "}
                    {showScoreboardTokenSecret
                      ? scoreboardSettingsDraft.tokenSecret.trim() || "--"
                      : maskTokenForDisplay(
                          scoreboardSettingsDraft.tokenSecret,
                        )}
                  </Text>
                  <Pressable
                    style={styles.scoreboardTokenRevealButton}
                    onPress={() =>
                      setShowScoreboardTokenSecret((prev) => !prev)
                    }
                  >
                    <Text style={styles.scoreboardTokenRevealButtonText}>
                      {showScoreboardTokenSecret ? "Hide" : "Reveal"}
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.footerHint}>
                  Connection status: {scoreboardConnectionMessage}
                </Text>

                <View style={styles.rowButtons}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={closeScoreboardSettingsModal}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={() => void saveScoreboardSettings()}
                  >
                    <Text style={styles.primaryButtonText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {stage === "gameDashboard" && session ? (
          <View style={styles.card}>
            <Text style={styles.title}>Game Dashboard</Text>
            <Text style={styles.note}>{dashboardMatchupSummary}</Text>

            <Text style={styles.sectionLabel}>LIVE SCOREBOARD</Text>

            <View style={styles.scoreboardShell}>
              <View style={styles.scoreboardTopRow}>
                <View style={styles.scoreboardActionCol}>
                  <Pressable
                    style={[
                      styles.scoreboardActionGoal,
                      (!canControlGame(session.role) ||
                        isAnyModalOpen ||
                        isEventEntryLockedByClock) &&
                        styles.disabledButton,
                    ]}
                    disabled={
                      !canControlGame(session.role) ||
                      isAnyModalOpen ||
                      isEventEntryLockedByClock
                    }
                    onPress={() =>
                      homeTeamId && handleGoalButtonPress(homeTeamId)
                    }
                  >
                    <Text style={styles.scoreboardActionText}>+ Goal</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.scoreboardActionPenalty,
                      (!canControlGame(session.role) ||
                        isAnyModalOpen ||
                        isEventEntryLockedByClock) &&
                        styles.disabledButton,
                    ]}
                    disabled={
                      !canControlGame(session.role) ||
                      isAnyModalOpen ||
                      isEventEntryLockedByClock
                    }
                    onPress={() =>
                      homeTeamId && handlePenaltyButtonPress(homeTeamId)
                    }
                  >
                    <Text style={styles.scoreboardActionText}>+ Penalty</Text>
                  </Pressable>
                </View>

                <View style={styles.periodBreakdownCol}>
                  {["1ST", "2ND", "3RD", "OT"].map((label, idx) => (
                    <View
                      key={`home-period-${label}`}
                      style={styles.periodBreakdownRow}
                    >
                      <Text style={styles.periodBreakdownLabel}>{label}</Text>
                      <Text style={styles.periodBreakdownValue}>
                        {idx === 0
                          ? goalsByPeriod.home[1]
                          : idx === 1
                            ? goalsByPeriod.home[2]
                            : idx === 2
                              ? goalsByPeriod.home[3]
                              : goalsByPeriod.home.OT}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={styles.scoreboardTeamCol}>
                  <View style={styles.teamChipHome}>
                    <Text style={styles.teamChipText}>{session.homeTeam}</Text>
                  </View>
                  <Text style={styles.scoreHomeBig}>{session.homeScore}</Text>
                </View>

                <Text style={styles.scoreboardDividerText}>:</Text>

                <View style={styles.scoreboardTeamCol}>
                  <View style={styles.teamChipAway}>
                    <Text style={styles.teamChipText}>{session.awayTeam}</Text>
                  </View>
                  <Text style={styles.scoreAwayBig}>{session.awayScore}</Text>
                </View>

                <View style={styles.periodBreakdownCol}>
                  {["1ST", "2ND", "3RD", "OT"].map((label, idx) => (
                    <View
                      key={`away-period-${label}`}
                      style={styles.periodBreakdownRowRight}
                    >
                      <Text style={styles.periodBreakdownValue}>
                        {idx === 0
                          ? goalsByPeriod.away[1]
                          : idx === 1
                            ? goalsByPeriod.away[2]
                            : idx === 2
                              ? goalsByPeriod.away[3]
                              : goalsByPeriod.away.OT}
                      </Text>
                      <Text style={styles.periodBreakdownLabel}>{label}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.scoreboardActionCol}>
                  <Pressable
                    style={[
                      styles.scoreboardActionGoal,
                      (!canControlGame(session.role) ||
                        isAnyModalOpen ||
                        isEventEntryLockedByClock) &&
                        styles.disabledButton,
                    ]}
                    disabled={
                      !canControlGame(session.role) ||
                      isAnyModalOpen ||
                      isEventEntryLockedByClock
                    }
                    onPress={() =>
                      awayTeamId && handleGoalButtonPress(awayTeamId)
                    }
                  >
                    <Text style={styles.scoreboardActionText}>+ Goal</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.scoreboardActionPenalty,
                      (!canControlGame(session.role) ||
                        isAnyModalOpen ||
                        isEventEntryLockedByClock) &&
                        styles.disabledButton,
                    ]}
                    disabled={
                      !canControlGame(session.role) ||
                      isAnyModalOpen ||
                      isEventEntryLockedByClock
                    }
                    onPress={() =>
                      awayTeamId && handlePenaltyButtonPress(awayTeamId)
                    }
                  >
                    <Text style={styles.scoreboardActionText}>+ Penalty</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.scoreboardStatusRow}>
                <Text style={styles.scoreboardMeta}>
                  {session.gameTime} | {session.venue}
                </Text>
                <View style={styles.scoreboardStatusBadges}>
                  <Pressable
                    style={styles.scoreboardSettingsButton}
                    onPress={openScoreboardSettingsModal}
                  >
                    <Text style={styles.scoreboardSettingsButtonText}>⚙</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.scoreboardConnectionBadge,
                      scoreboardConnectionBadgeStyle,
                    ]}
                    onPress={requestScoreboardReconnect}
                    disabled={!scoreboardGatewaySettings.enabled}
                  >
                    <Text
                      style={[
                        styles.scoreboardConnectionBadgeText,
                        scoreboardConnectionBadgeTextStyle,
                      ]}
                    >
                      {scoreboardConnectionBadgeText}
                    </Text>
                  </Pressable>
                  <Text style={[styles.scoreboardSyncBadge, syncStatusStyle]}>
                    {syncStatusText}
                  </Text>
                  <Pressable
                    style={[
                      styles.scoreboardSyncNowButton,
                      syncState === "syncing" && styles.disabledButton,
                    ]}
                    onPress={() => void handleManualSyncPress()}
                    disabled={syncState === "syncing"}
                  >
                    <Text style={styles.scoreboardSyncNowButtonText}>
                      Sync Now
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>GAME CLOCK</Text>
            <View style={styles.gameClockShell}>
              <View style={styles.gameClockBody}>
                <View style={styles.penaltySide}>
                  <Text style={styles.penaltySideLabel}>
                    {session.homeTeam}
                  </Text>
                  {homeActivePenalties.length === 0 ? (
                    <View style={styles.penaltyEmptyTile}>
                      <Text style={styles.penaltyEmptyText}>No penalties</Text>
                    </View>
                  ) : (
                    homeActivePenalties.map((penalty) => (
                      <View key={penalty.id} style={styles.penaltyActiveTile}>
                        <Text style={styles.penaltyPlayerText}>
                          {penalty.playerName}
                        </Text>
                        <Text style={styles.penaltyInfractionText}>
                          {`${penalty.infraction} - ${penalty.penaltyType}`}
                        </Text>
                        <Text style={styles.penaltyClockText}>
                          {formatSecondsToClock(penalty.remainingSeconds)}
                        </Text>
                        <View style={styles.penaltyAdjustRow}>
                          <Pressable
                            style={[
                              styles.penaltyAdjustBtn,
                              (!canControlGame(session.role) ||
                                isClockRunning) &&
                                styles.disabledButton,
                            ]}
                            disabled={
                              !canControlGame(session.role) || isClockRunning
                            }
                            onPress={() => openPenaltyAdjustModal(penalty)}
                          >
                            <Text style={styles.penaltyAdjustBtnText}>
                              Adjust Time
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  )}
                </View>

                <View style={styles.gameClockCenterStack}>
                  <View style={styles.gameClockCenter}>
                    <Text style={styles.gameClockPeriod}>
                      {periodDotIndicator} {activePeriodLabel} Period
                    </Text>
                    <Text style={styles.gameClockTime}>{session.clock}</Text>
                    <View style={styles.gameClockModeBadge}>
                      <Text style={styles.gameClockModeText}>
                        {isClockRunning ? "Running" : "Stopped"} •{" "}
                        {clockSourceLabel}
                      </Text>
                    </View>
                    <Text style={styles.gameClockManpowerText}>
                      {homeSkatersOnIce}v{awaySkatersOnIce} • {powerPlayLabel}
                    </Text>
                  </View>

                  <View style={styles.clockPrimaryButtons}>
                    <Pressable
                      style={[
                        isClockRunning
                          ? styles.clockToggleRunningButton
                          : styles.clockToggleStoppedButton,
                        (!canControlGame(session.role) || isAnyModalOpen) &&
                          styles.disabledButton,
                      ]}
                      disabled={!canControlGame(session.role) || isAnyModalOpen}
                      onPress={handleClockToggle}
                    >
                      <Text style={styles.clockPrimaryText}>
                        {isClockRunning ? "Stop Clock" : "Start Clock"}
                      </Text>
                    </Pressable>
                  </View>

                  <Pressable
                    style={[
                      periodController.state === "NOT_STARTED"
                        ? styles.periodControlNotStarted
                        : periodController.state === "IN_PROGRESS"
                          ? styles.periodControlInProgress
                          : styles.periodControlIntermission,
                      !canControlGame(session.role) && styles.disabledButton,
                    ]}
                    disabled={!canControlGame(session.role) || isAnyModalOpen}
                    onPress={handlePeriodControlButtonPress}
                  >
                    <Text style={styles.clockStatusText}>
                      {periodController.state === "NOT_STARTED"
                        ? "Period: Not Started"
                        : periodController.state === "IN_PROGRESS"
                          ? "Period: In Progress"
                          : "Intermission: Resume Game"}
                    </Text>
                  </Pressable>

                  <View style={styles.clockSecondaryButtons}>
                    <Pressable
                      style={[
                        styles.clockSecondaryBtn,
                        styles.clockHalfWidthBtn,
                        (isAnyModalOpen || isClockRunning) &&
                          styles.disabledButton,
                      ]}
                      disabled={isAnyModalOpen || isClockRunning}
                      onPress={openSetEditClockModal}
                    >
                      <Text style={styles.clockSecondaryText}>
                        Set/Edit Clock
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.clockSecondaryBtn,
                        styles.clockHalfWidthBtn,
                        (isAnyModalOpen || isEventEntryLockedByClock) &&
                          styles.disabledButton,
                      ]}
                      disabled={isAnyModalOpen || isEventEntryLockedByClock}
                      onPress={openTimeoutModal}
                    >
                      <Text style={styles.clockSecondaryText}>Timeout</Text>
                    </Pressable>
                  </View>

                  <View style={styles.clockGoalieButtons}>
                    <Pressable
                      style={[
                        styles.clockSecondaryBtn,
                        homeGoaliePulled && styles.clockSecondaryBtnAlert,
                        styles.clockHalfWidthBtn,
                        isAnyModalOpen && styles.disabledButton,
                      ]}
                      disabled={isAnyModalOpen}
                      onPress={() => openGoalieChangeModal("home")}
                    >
                      <Text style={styles.clockSecondaryText}>
                        {homeGoaliePulled ? "Goalie Pulled" : "Home Goalie"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.clockSecondaryBtn,
                        awayGoaliePulled && styles.clockSecondaryBtnAlert,
                        styles.clockHalfWidthBtn,
                        isAnyModalOpen && styles.disabledButton,
                      ]}
                      disabled={isAnyModalOpen}
                      onPress={() => openGoalieChangeModal("away")}
                    >
                      <Text style={styles.clockSecondaryText}>
                        {awayGoaliePulled ? "Goalie Pulled" : "Away Goalie"}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.penaltySide}>
                  <Text style={styles.penaltySideLabel}>
                    {session.awayTeam}
                  </Text>
                  {awayActivePenalties.length === 0 ? (
                    <View style={styles.penaltyEmptyTile}>
                      <Text style={styles.penaltyEmptyText}>No penalties</Text>
                    </View>
                  ) : (
                    awayActivePenalties.map((penalty) => (
                      <View key={penalty.id} style={styles.penaltyActiveTile}>
                        <Text style={styles.penaltyPlayerText}>
                          {penalty.playerName}
                        </Text>
                        <Text style={styles.penaltyInfractionText}>
                          {`${penalty.infraction} - ${penalty.penaltyType}`}
                        </Text>
                        <Text style={styles.penaltyClockText}>
                          {formatSecondsToClock(penalty.remainingSeconds)}
                        </Text>
                        <View style={styles.penaltyAdjustRow}>
                          <Pressable
                            style={[
                              styles.penaltyAdjustBtn,
                              (!canControlGame(session.role) ||
                                isClockRunning) &&
                                styles.disabledButton,
                            ]}
                            disabled={
                              !canControlGame(session.role) || isClockRunning
                            }
                            onPress={() => openPenaltyAdjustModal(penalty)}
                          >
                            <Text style={styles.penaltyAdjustBtnText}>
                              Adjust Time
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>

              <Text style={styles.clockPenaltySummaryText}>
                Team penalties: {session.homeTeam}{" "}
                {safeTeamPenaltyCountById[homeTeamId] ?? 0} • {session.awayTeam}{" "}
                {safeTeamPenaltyCountById[awayTeamId] ?? 0}
              </Text>
            </View>

            <Text style={styles.sectionLabel}>SHOT COUNTER</Text>
            <View style={styles.shotsShell}>
              <View style={styles.shotsPeriodCol}>
                {[
                  { label: "1ST", value: safeHomeShotsByPeriod[1] },
                  { label: "2ND", value: safeHomeShotsByPeriod[2] },
                  { label: "3RD", value: safeHomeShotsByPeriod[3] },
                  { label: "OT", value: safeHomeShotsByPeriod.OT },
                ].map((entry) => (
                  <View
                    key={`home-shots-${entry.label}`}
                    style={styles.shotsPeriodRowLeft}
                  >
                    <Text style={styles.shotsPeriodText}>{entry.label}</Text>
                    <Text style={styles.shotsPeriodValue}>{entry.value}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.shotsTeamCol}>
                <Text style={styles.shotsTeamName}>{session.homeTeam}</Text>
                <View style={styles.shotsCountRow}>
                  <Pressable
                    style={[
                      styles.shotsAdjustBtn,
                      !canControlGame(session.role) && styles.disabledButton,
                    ]}
                    disabled={!canControlGame(session.role)}
                    onPress={() => adjustShots("home", -1)}
                  >
                    <Text style={styles.shotsAdjustText}>-</Text>
                  </Pressable>
                  <Text style={styles.shotsBigValue}>
                    {safeHomeShotsByPeriod[1] +
                      safeHomeShotsByPeriod[2] +
                      safeHomeShotsByPeriod[3] +
                      safeHomeShotsByPeriod.OT}
                  </Text>
                  <Pressable
                    style={[
                      styles.shotsAdjustBtnPrimary,
                      !canControlGame(session.role) && styles.disabledButton,
                    ]}
                    disabled={!canControlGame(session.role)}
                    onPress={() => adjustShots("home", 1)}
                  >
                    <Text style={styles.shotsAdjustTextPrimary}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.shotsDividerLine} />

              <View style={styles.shotsTeamCol}>
                <Text style={styles.shotsTeamName}>{session.awayTeam}</Text>
                <View style={styles.shotsCountRow}>
                  <Pressable
                    style={[
                      styles.shotsAdjustBtn,
                      !canControlGame(session.role) && styles.disabledButton,
                    ]}
                    disabled={!canControlGame(session.role)}
                    onPress={() => adjustShots("away", -1)}
                  >
                    <Text style={styles.shotsAdjustText}>-</Text>
                  </Pressable>
                  <Text style={styles.shotsBigValue}>
                    {safeAwayShotsByPeriod[1] +
                      safeAwayShotsByPeriod[2] +
                      safeAwayShotsByPeriod[3] +
                      safeAwayShotsByPeriod.OT}
                  </Text>
                  <Pressable
                    style={[
                      styles.shotsAdjustBtnPrimary,
                      !canControlGame(session.role) && styles.disabledButton,
                    ]}
                    disabled={!canControlGame(session.role)}
                    onPress={() => adjustShots("away", 1)}
                  >
                    <Text style={styles.shotsAdjustTextPrimary}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.shotsPeriodCol}>
                {[
                  { label: "1ST", value: safeAwayShotsByPeriod[1] },
                  { label: "2ND", value: safeAwayShotsByPeriod[2] },
                  { label: "3RD", value: safeAwayShotsByPeriod[3] },
                  { label: "OT", value: safeAwayShotsByPeriod.OT },
                ].map((entry) => (
                  <View
                    key={`away-shots-${entry.label}`}
                    style={styles.shotsPeriodRowRight}
                  >
                    <Text style={styles.shotsPeriodValue}>{entry.value}</Text>
                    <Text style={styles.shotsPeriodText}>{entry.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.eventsHeaderRow}>
              <Text style={styles.sectionLabel}>GAME EVENTS</Text>
              <View style={styles.eventFilterButtons}>
                {(["Shot", "Goal", "Penalty"] as const).map((eventType) => {
                  const isActive = eventTypeFilters[eventType];
                  const label =
                    eventType === "Penalty" ? "Penalties" : `${eventType}s`;
                  return (
                    <Pressable
                      key={eventType}
                      style={[
                        styles.eventFilterButton,
                        isActive && styles.eventFilterButtonActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={`${label} event filter`}
                      onPress={() =>
                        setEventTypeFilters((current) => ({
                          ...current,
                          [eventType]: !current[eventType],
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.eventFilterButtonText,
                          isActive && styles.eventFilterButtonTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.eventsPanel}>
              {safeEventFeed.length === 0 ? (
                <Text style={styles.eventsHint}>
                  No events yet. Tap + Goal or + Penalty to record one.
                </Text>
              ) : visibleEventFeed.length === 0 ? (
                <Text style={styles.eventsHint}>
                  No events match the selected filters.
                </Text>
              ) : (
                <ScrollView
                  style={styles.eventsListViewport}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {visibleEventFeed.map((event) => (
                    <Pressable
                      key={event.localId}
                      style={styles.eventRow}
                      onPress={() => openEventActions(event)}
                    >
                      <Text style={styles.eventTime}>
                        P{event.period} {event.timeInPeriod}
                      </Text>
                      <View style={styles.eventBody}>
                        {event.eventType === "Goal" ? (
                          <>
                            <Text style={styles.eventTitle}>
                              {event.teamName} GOAL - {event.playerName}
                            </Text>
                            <Text style={styles.eventSubtitle}>
                              {event.strength}
                              {event.assist1Name
                                ? ` • A1: ${event.assist1Name}`
                                : ""}
                              {event.assist2Name
                                ? ` • A2: ${event.assist2Name}`
                                : ""}
                            </Text>
                          </>
                        ) : event.eventType === "Penalty" ? (
                          <>
                            <Text style={styles.eventTitle}>
                              {event.teamName} PENALTY - {event.playerName}
                            </Text>
                            <Text style={styles.eventSubtitle}>
                              {event.penaltyType} • {event.infraction} •{" "}
                              {event.durationMinutes} min
                            </Text>
                          </>
                        ) : event.eventType === "Shot" ? (
                          <>
                            <Text style={styles.eventTitle}>
                              {event.teamName} SHOT
                            </Text>
                            <Text style={styles.eventSubtitle}>
                              Shot on goal
                            </Text>
                          </>
                        ) : event.eventType === "Timeout" ? (
                          <>
                            <Text style={styles.eventTitle}>
                              {event.teamName} TIMEOUT
                            </Text>
                            <Text style={styles.eventSubtitle}>
                              Duration:{" "}
                              {formatSecondsToClock(
                                event.timeoutDurationSeconds ?? 60,
                              )}
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.eventTitle}>
                              {event.teamName} GOALIE{" "}
                              {event.goalieChangeKind === "returned"
                                ? "RETURNED"
                                : event.goalieChangeKind === "pulled"
                                  ? "PULLED"
                                  : event.goalieChangeKind?.toUpperCase()}
                            </Text>
                            <Text style={styles.eventSubtitle}>
                              {event.goalieChangeKind === "pulled"
                                ? `${event.goalieOldName ?? "-"} → Pulled`
                                : event.goalieChangeKind === "returned"
                                  ? `Pulled → ${event.goalieNewName ?? "-"}`
                                  : `${event.goalieOldName ?? "-"} → ${event.goalieNewName ?? "-"}`}
                            </Text>
                          </>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>

            <View style={styles.dashboardInfoButtons}>
              <Pressable
                style={[styles.secondaryButton, styles.dashboardInfoButton]}
                onPress={() => setRosterPreviewTeam("home")}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    styles.dashboardInfoButtonText,
                  ]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {session.homeTeam} Roster
                </Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, styles.dashboardInfoButton]}
                onPress={() => setRosterPreviewTeam("away")}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    styles.dashboardInfoButtonText,
                  ]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {session.awayTeam} Roster
                </Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, styles.dashboardInfoButton]}
                onPress={() => setShowStarterInformation(true)}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    styles.dashboardInfoButtonText,
                  ]}
                >
                  Starter Information
                </Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, styles.dashboardInfoButton]}
                onPress={() => setShowOfficialsPreview(true)}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    styles.dashboardInfoButtonText,
                  ]}
                >
                  Officials
                </Text>
              </Pressable>
            </View>

            <Pressable style={styles.endGameButton} onPress={handleEndGame}>
              <Text style={styles.endGameButtonText}>End Game</Text>
              <Text style={styles.endGameSubText}>
                Checks for suspension review notes and finalizes game
              </Text>
            </Pressable>
          </View>
        ) : null}

        {stage === "gameDashboard" &&
        session &&
        periodController.state === "INTERMISSION" ? (
          <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => {}}
          >
            <View style={styles.intermissionOverlay}>
              <View style={styles.intermissionCard}>
                <Text style={styles.intermissionTitle}>Intermission Mode</Text>
                <Text style={styles.intermissionSubtitle}>
                  Game controls are locked until you resume.
                </Text>

                <View style={styles.intermissionTimerShell}>
                  <Text style={styles.intermissionTimerLabel}>
                    TIME IN INTERMISSION
                  </Text>
                  <Text style={styles.intermissionTimerValue}>
                    {formatSecondsToClock(intermissionSeconds)}
                  </Text>
                </View>

                <View style={styles.intermissionScoreRow}>
                  <View style={styles.intermissionTeamScoreCol}>
                    <Text style={styles.intermissionTeamName}>
                      {session.homeTeam}
                    </Text>
                    <Text style={styles.intermissionTeamScore}>
                      {session.homeScore}
                    </Text>
                  </View>
                  <Text style={styles.intermissionScoreDivider}>-</Text>
                  <View style={styles.intermissionTeamScoreCol}>
                    <Text style={styles.intermissionTeamName}>
                      {session.awayTeam}
                    </Text>
                    <Text style={styles.intermissionTeamScore}>
                      {session.awayScore}
                    </Text>
                  </View>
                </View>

                <Text style={styles.intermissionSectionLabel}>
                  SHOTS BY PERIOD
                </Text>
                <View style={styles.intermissionShotsTable}>
                  <View style={styles.intermissionShotsHeaderRow}>
                    <Text style={styles.intermissionShotsHeaderTeam}>TEAM</Text>
                    <Text style={styles.intermissionShotsHeaderCell}>1</Text>
                    <Text style={styles.intermissionShotsHeaderCell}>2</Text>
                    <Text style={styles.intermissionShotsHeaderCell}>3</Text>
                    <Text style={styles.intermissionShotsHeaderCell}>OT</Text>
                    <Text style={styles.intermissionShotsHeaderCell}>TOT</Text>
                  </View>

                  <View style={styles.intermissionShotsDataRow}>
                    <Text style={styles.intermissionShotsTeamCell}>
                      {session.homeTeam.toUpperCase()}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeHomeShotsByPeriod[1]}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeHomeShotsByPeriod[2]}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeHomeShotsByPeriod[3]}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeHomeShotsByPeriod.OT}
                    </Text>
                    <Text style={styles.intermissionShotsDataTotalCell}>
                      {homeShotsTotal}
                    </Text>
                  </View>

                  <View style={styles.intermissionShotsDataRow}>
                    <Text style={styles.intermissionShotsTeamCell}>
                      {session.awayTeam.toUpperCase()}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeAwayShotsByPeriod[1]}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeAwayShotsByPeriod[2]}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeAwayShotsByPeriod[3]}
                    </Text>
                    <Text style={styles.intermissionShotsDataCell}>
                      {safeAwayShotsByPeriod.OT}
                    </Text>
                    <Text style={styles.intermissionShotsDataTotalCell}>
                      {awayShotsTotal}
                    </Text>
                  </View>
                </View>

                <Pressable
                  style={styles.intermissionResumeButton}
                  onPress={() => setShowResumeVerify(true)}
                >
                  <Text style={styles.intermissionResumeButtonText}>
                    Resume Game
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {stage === "gameSummary" && session ? (
          <View style={styles.card}>
            <Text style={styles.title}>Game Summary</Text>
            <Text style={styles.note}>
              Verify the completed score sheet before sending.
            </Text>

            {emailDeliveryStatus !== "idle" ? (
              <View
                style={[
                  styles.emailStatusBadge,
                  emailDeliveryStatus === "sent"
                    ? styles.emailStatusBadgeSent
                    : emailDeliveryStatus === "queued"
                      ? styles.emailStatusBadgeQueued
                      : styles.emailStatusBadgeFailed,
                ]}
              >
                <Text style={styles.emailStatusBadgeTitle}>
                  {emailDeliveryStatus === "sent"
                    ? "Email Sent"
                    : emailDeliveryStatus === "queued"
                      ? "Finalize Queued"
                      : "Email Failed"}
                </Text>
                {emailDeliveryMessage ? (
                  <Text style={styles.emailStatusBadgeText}>
                    {emailDeliveryMessage}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>FINAL SCORE</Text>

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Final</Text>
              <Text style={styles.metaValue}>
                {session.homeTeam} {session.homeScore} - {session.awayScore}{" "}
                {session.awayTeam}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Venue</Text>
              <Text style={styles.metaValue}>
                {session.venue} ({session.rink})
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Completed By</Text>
              <Text style={styles.metaValue}>{ROLE_LABELS[session.role]}</Text>
            </View>

            <Text style={styles.sectionLabel}>TEAM SHOTS BREAKDOWN</Text>
            <View style={styles.summarySectionCard}>
              <View style={styles.summaryBreakdownTable}>
                <View style={styles.summaryBreakdownHeaderRow}>
                  <Text
                    style={[
                      styles.summaryBreakdownCellTeam,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    TEAM
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    1ST
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    2ND
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    3RD
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    OT
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    TOTAL
                  </Text>
                </View>

                <View style={styles.summaryBreakdownDataRow}>
                  <Text style={styles.summaryBreakdownCellTeamValue}>
                    {session.homeTeam.toUpperCase()}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeHomeShotsByPeriod[1]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeHomeShotsByPeriod[2]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeHomeShotsByPeriod[3]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeHomeShotsByPeriod.OT}
                  </Text>
                  <Text style={styles.summaryBreakdownCellTotalValue}>
                    {homeShotsTotal}
                  </Text>
                </View>

                <View style={styles.summaryBreakdownDataRow}>
                  <Text style={styles.summaryBreakdownCellTeamValue}>
                    {session.awayTeam.toUpperCase()}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeAwayShotsByPeriod[1]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeAwayShotsByPeriod[2]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeAwayShotsByPeriod[3]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {safeAwayShotsByPeriod.OT}
                  </Text>
                  <Text style={styles.summaryBreakdownCellTotalValue}>
                    {awayShotsTotal}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>SHOTS BY GOALIE</Text>
            <View style={styles.summarySectionCard}>
              {shotsByGoalie.length === 0 ? (
                <Text style={styles.footerHint}>
                  No goalie shot breakdown recorded yet.
                </Text>
              ) : (
                shotsByGoalie.map((goalie, index) => (
                  <View
                    key={`${goalie.goalieTeamName}-${goalie.goalieName}-${index}`}
                    style={styles.summaryEventCard}
                  >
                    <Text style={styles.summaryEventTitle}>
                      {goalie.goalieTeamName} - {goalie.goalieName}
                    </Text>
                    <Text style={styles.summaryEventMeta}>
                      Shots Against {goalie.totalShotsAgainst} • Time In Net{" "}
                      {formatSecondsToClock(goalie.totalTimeInNetSeconds)}
                    </Text>
                    <Text style={styles.summaryEventMeta}>
                      Period 1 {goalie.totals[1]} • Period 2 {goalie.totals[2]}{" "}
                      • Period 3 {goalie.totals[3]} • OT {goalie.totals.OT}
                    </Text>
                    {goalie.stints.length === 0 ? (
                      <Text style={styles.summaryGoalieStintLine}>
                        No in/out transitions recorded.
                      </Text>
                    ) : (
                      goalie.stints.map((stint, stintIndex) => (
                        <Text
                          key={`${goalie.goalieName}-stint-${stintIndex}`}
                          style={styles.summaryGoalieStintLine}
                        >
                          In{" "}
                          {formatElapsedGameMoment(
                            summaryPeriodLengthSeconds,
                            stint.enteredAtSeconds,
                          )}
                          {formatWallClockFromElapsed(
                            gameStartedAtIso,
                            stint.enteredAtSeconds,
                          )
                            ? ` (${formatWallClockFromElapsed(gameStartedAtIso, stint.enteredAtSeconds)})`
                            : ""}{" "}
                          • Out{" "}
                          {formatElapsedGameMoment(
                            summaryPeriodLengthSeconds,
                            stint.exitedAtSeconds,
                          )}
                          {formatWallClockFromElapsed(
                            gameStartedAtIso,
                            stint.exitedAtSeconds,
                          )
                            ? ` (${formatWallClockFromElapsed(gameStartedAtIso, stint.exitedAtSeconds)})`
                            : ""}{" "}
                          • Net {formatSecondsToClock(stint.durationSeconds)}
                        </Text>
                      ))
                    )}
                  </View>
                ))
              )}
            </View>

            <Text style={styles.sectionLabel}>TEAM GOALS BREAKDOWN</Text>
            <View style={styles.summarySectionCard}>
              <View style={styles.summaryBreakdownTable}>
                <View style={styles.summaryBreakdownHeaderRow}>
                  <Text
                    style={[
                      styles.summaryBreakdownCellTeam,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    TEAM
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    1ST
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    2ND
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    3RD
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    OT
                  </Text>
                  <Text
                    style={[
                      styles.summaryBreakdownCellValue,
                      styles.summaryBreakdownHeaderText,
                    ]}
                  >
                    TOTAL
                  </Text>
                </View>

                <View style={styles.summaryBreakdownDataRow}>
                  <Text style={styles.summaryBreakdownCellTeamValue}>
                    {session.homeTeam.toUpperCase()}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.home[1]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.home[2]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.home[3]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.home.OT}
                  </Text>
                  <Text style={styles.summaryBreakdownCellTotalValue}>
                    {session.homeScore}
                  </Text>
                </View>

                <View style={styles.summaryBreakdownDataRow}>
                  <Text style={styles.summaryBreakdownCellTeamValue}>
                    {session.awayTeam.toUpperCase()}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.away[1]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.away[2]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.away[3]}
                  </Text>
                  <Text style={styles.summaryBreakdownCellValueText}>
                    {goalsByPeriod.away.OT}
                  </Text>
                  <Text style={styles.summaryBreakdownCellTotalValue}>
                    {session.awayScore}
                  </Text>
                </View>
              </View>

              {goalEvents.length === 0 ? (
                <Text style={styles.footerHint}>No goals recorded.</Text>
              ) : (
                goalEvents.map((event) => (
                  <View key={event.localId} style={styles.summaryEventCard}>
                    <Text style={styles.summaryEventTitle}>
                      {event.teamName} - {event.playerName}
                    </Text>
                    <Text style={styles.summaryEventMeta}>
                      P{event.period} {event.timeInPeriod} • {event.strength}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.sectionLabel}>ACTIVE PLAYERS</Text>
            <View style={styles.summarySectionCard}>
              <View style={styles.summaryStatGrid}>
                <View style={styles.summaryStatColumn}>
                  <Text style={styles.summaryStatTeam}>{session.homeTeam}</Text>
                  {activePlayersByTeam.home.length === 0 ? (
                    <Text style={styles.footerHint}>
                      No active players marked.
                    </Text>
                  ) : (
                    activePlayersByTeam.home.map((player) => (
                      <Text
                        key={`active-home-${player.playerId}`}
                        style={styles.summaryActivePlayerLine}
                      >
                        #{player.jerseyNumber ?? "-"} {player.fullName} (
                        {player.isGoalie ? "G" : player.position || "-"})
                      </Text>
                    ))
                  )}
                </View>
                <View style={styles.summaryStatColumn}>
                  <Text style={styles.summaryStatTeam}>{session.awayTeam}</Text>
                  {activePlayersByTeam.away.length === 0 ? (
                    <Text style={styles.footerHint}>
                      No active players marked.
                    </Text>
                  ) : (
                    activePlayersByTeam.away.map((player) => (
                      <Text
                        key={`active-away-${player.playerId}`}
                        style={styles.summaryActivePlayerLine}
                      >
                        #{player.jerseyNumber ?? "-"} {player.fullName} (
                        {player.isGoalie ? "G" : player.position || "-"})
                      </Text>
                    ))
                  )}
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>PENALTIES</Text>
            <View style={styles.summarySectionCard}>
              <View style={styles.summaryStatGrid}>
                <View style={styles.summaryStatColumn}>
                  <Text style={styles.summaryStatTeam}>{session.homeTeam}</Text>
                  <Text style={styles.summaryStatLine}>
                    Total:{" "}
                    {
                      penaltyEvents.filter(
                        (event) => event.teamId === homeTeamId,
                      ).length
                    }
                  </Text>
                </View>
                <View style={styles.summaryStatColumn}>
                  <Text style={styles.summaryStatTeam}>{session.awayTeam}</Text>
                  <Text style={styles.summaryStatLine}>
                    Total:{" "}
                    {
                      penaltyEvents.filter(
                        (event) => event.teamId === awayTeamId,
                      ).length
                    }
                  </Text>
                </View>
              </View>
              {penaltyEvents.length === 0 ? (
                <Text style={styles.footerHint}>No penalties recorded.</Text>
              ) : (
                penaltyEvents.map((event) => (
                  <View key={event.localId} style={styles.summaryEventCard}>
                    <Text style={styles.summaryEventTitle}>
                      {event.teamName} - {event.playerName}
                    </Text>
                    <Text style={styles.summaryEventMeta}>
                      P{event.period} {event.timeInPeriod} • {event.infraction}{" "}
                      - {getPenaltyTypeLabel(event.penaltyType ?? "Minor")} •{" "}
                      {getPenaltyDurationMinutes(event.penaltyType ?? "Minor")}{" "}
                      min
                    </Text>
                  </View>
                ))
              )}
            </View>

            {suspensionFlaggedPenaltyEvents.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>SUSPENSION REVIEW FLAGS</Text>
                <View style={styles.summarySectionCard}>
                  {suspensionFlaggedPenaltyEvents.map((event) => (
                    <View
                      key={`summary-suspension-${event.localId}`}
                      style={styles.summaryEventCard}
                    >
                      <Text style={styles.summaryEventTitle}>
                        {event.teamName} - {event.playerName}
                      </Text>
                      <Text style={styles.summaryEventMeta}>
                        {event.infraction} -{" "}
                        {getPenaltyTypeLabel(event.penaltyType ?? "Minor")} •{" "}
                        {getSuspensionReviewLabel(event.penaltyType ?? "Minor")}
                      </Text>
                      <Text style={styles.summaryEventMeta}>
                        P{event.period} {event.timeInPeriod} •{" "}
                        {suspensionNotesByPenaltyId[event.localId] ??
                          "No notes entered."}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.footerHint}>
              Review all event totals and suspension flags before sending the
              scoresheet.
            </Text>

            <View style={styles.rowButtons}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setStage("gameDashboard")}
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={openSendScoresheet}
              >
                <Text style={styles.primaryButtonText}>Verify & Continue</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {stage === "sendScoresheet" && session ? (
          <View style={styles.card}>
            <Text style={styles.title}>Send Scoresheet</Text>
            <Text style={styles.note}>
              Choose who should receive the final scoresheet email.
            </Text>

            {sendScoresheetError ? (
              <Text style={styles.error}>{sendScoresheetError}</Text>
            ) : null}

            <Text style={styles.sectionLabel}>EMAIL RECIPIENTS</Text>
            <View style={styles.summarySectionCard}>
              {coachEmailRecipients.length === 0 ? (
                <Text style={styles.footerHint}>
                  No coach email addresses are available for this game.
                </Text>
              ) : (
                coachEmailRecipients.map((recipient) => (
                  <View key={recipient.key} style={styles.recipientRow}>
                    <View style={styles.recipientTextWrap}>
                      <Text style={styles.recipientName}>
                        {recipient.coachName}
                      </Text>
                      <Text style={styles.recipientMeta}>
                        {recipient.teamName} • {recipient.roleName} •{" "}
                        {recipient.coachEmail}
                      </Text>
                    </View>
                    <Switch
                      value={Boolean(sendRecipientSelection[recipient.key])}
                      onValueChange={(value) =>
                        setSendRecipientSelection((prev) => ({
                          ...prev,
                          [recipient.key]: value,
                        }))
                      }
                      trackColor={{ false: "#516273", true: "#FF7B00" }}
                      thumbColor={
                        sendRecipientSelection[recipient.key]
                          ? "#FFE0BF"
                          : "#d4dbe3"
                      }
                    />
                  </View>
                ))
              )}

              <Text style={styles.sectionLabel}>OFFICIAL RECIPIENTS</Text>
              {officialEmailRecipients.length === 0 ? (
                <Text
                  style={
                    dqEmailPenaltyEvents.length > 0
                      ? styles.error
                      : styles.footerHint
                  }
                >
                  {dqEmailPenaltyEvents.length > 0
                    ? "DQ detected. No official emails are on file. Add them in Admin Officials or add one below."
                    : "No official emails are on file for this game."}
                </Text>
              ) : (
                officialEmailRecipients.map((recipient) => (
                  <View key={recipient.key} style={styles.recipientRow}>
                    <View style={styles.recipientTextWrap}>
                      <Text style={styles.recipientName}>
                        {recipient.recipientName}
                      </Text>
                      <Text style={styles.recipientMeta}>
                        {recipient.recipientMeta}
                      </Text>
                    </View>
                    <Switch
                      value={Boolean(sendRecipientSelection[recipient.key])}
                      onValueChange={(value) =>
                        setSendRecipientSelection((prev) => ({
                          ...prev,
                          [recipient.key]: value,
                        }))
                      }
                      trackColor={{ false: "#516273", true: "#FF7B00" }}
                      thumbColor={
                        sendRecipientSelection[recipient.key]
                          ? "#FFE0BF"
                          : "#d4dbe3"
                      }
                    />
                  </View>
                ))
              )}

              <Text style={styles.sectionLabel}>MEDIA OUTLET RECIPIENTS</Text>
              {mediaOutletRecipients.length === 0 ? (
                <Text style={styles.footerHint}>
                  No media outlet recipients are configured in Admin Settings.
                </Text>
              ) : (
                mediaOutletRecipients.map((recipient) => (
                  <View key={recipient.key} style={styles.recipientRow}>
                    <View style={styles.recipientTextWrap}>
                      <Text style={styles.recipientName}>
                        {recipient.recipientName}
                      </Text>
                      <Text style={styles.recipientMeta}>
                        {recipient.recipientMeta}
                      </Text>
                    </View>
                    <Switch
                      value={Boolean(sendRecipientSelection[recipient.key])}
                      onValueChange={(value) =>
                        setSendRecipientSelection((prev) => ({
                          ...prev,
                          [recipient.key]: value,
                        }))
                      }
                      trackColor={{ false: "#516273", true: "#FF7B00" }}
                      thumbColor={
                        sendRecipientSelection[recipient.key]
                          ? "#FFE0BF"
                          : "#d4dbe3"
                      }
                    />
                  </View>
                ))
              )}

              <Text style={styles.sectionLabel}>ADDITIONAL EMAILS</Text>
              <View style={styles.addEmailRow}>
                <TextInput
                  style={[styles.input, styles.addEmailInput]}
                  value={customEmailInput}
                  onChangeText={(value) => {
                    setCustomEmailInput(value);
                    if (sendScoresheetError) {
                      setSendScoresheetError("");
                    }
                  }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="name@example.com"
                  placeholderTextColor="#7a8fa8"
                />
                <Pressable
                  style={styles.secondaryButton}
                  onPress={addCustomEmailRecipient}
                >
                  <Text style={styles.secondaryButtonText}>Add Email</Text>
                </Pressable>
              </View>

              {customEmailRecipients.map((recipient) => (
                <View key={recipient.key} style={styles.recipientRow}>
                  <View style={styles.recipientTextWrap}>
                    <Text style={styles.recipientName}>{recipient.email}</Text>
                    <Text style={styles.recipientMeta}>
                      Additional recipient
                    </Text>
                  </View>
                  <View style={styles.addEmailActions}>
                    <Switch
                      value={Boolean(sendRecipientSelection[recipient.key])}
                      onValueChange={(value) =>
                        setSendRecipientSelection((prev) => ({
                          ...prev,
                          [recipient.key]: value,
                        }))
                      }
                      trackColor={{ false: "#516273", true: "#FF7B00" }}
                      thumbColor={
                        sendRecipientSelection[recipient.key]
                          ? "#FFE0BF"
                          : "#d4dbe3"
                      }
                    />
                    <Pressable
                      style={styles.removeEmailButton}
                      onPress={() =>
                        removeCustomEmailRecipient(recipient.email)
                      }
                    >
                      <Text style={styles.removeEmailButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.rowButtons}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setStage("gameSummary")}
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryButton,
                  isFinalizingGame && styles.disabledButton,
                ]}
                onPress={handleSendScoresAndFinalize}
                disabled={isFinalizingGame}
              >
                <Text style={styles.primaryButtonText}>
                  {isFinalizingGame
                    ? "Finalizing..."
                    : "Send Scores & Finalize Game"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B1424",
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#FF7B00",
    backgroundColor: "#0F1A30",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  topBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  headerLogo: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  seasonChip: {
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.22)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  seasonChipLabel: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "700",
  },
  seasonChipValue: {
    color: "#FF7B00",
    fontSize: 11,
    fontWeight: "800",
  },
  brand: {
    fontSize: 19,
    fontWeight: "800",
  },
  headerBrandTip: {
    color: "#E8EDF5",
    fontStyle: "italic",
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerBrandIn: {
    color: "#FF7B00",
    fontStyle: "italic",
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerBrandProduct: {
    color: "#E8EDF5",
    fontStyle: "normal",
    fontWeight: "600",
  },
  subBrand: {
    color: "#7A8FA8",
    fontWeight: "700",
    letterSpacing: 2,
    fontSize: 12,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  loginWrap: {
    width: "100%",
    maxWidth: 700,
    alignSelf: "center",
    paddingTop: 18,
    paddingBottom: 8,
    gap: 14,
  },
  loginBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    marginBottom: 8,
  },
  loginLogo: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },
  loginBrandTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  loginBrandTip: {
    color: "#E8EDF5",
    fontStyle: "italic",
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  loginBrandIn: {
    color: "#FF7B00",
    fontStyle: "italic",
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  loginBrandScoring: {
    color: "#E8EDF5",
    fontStyle: "normal",
    fontWeight: "600",
  },
  loginBrandSubtitle: {
    color: "#7A8FA8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2.8,
    marginTop: 2,
  },
  loginIntroBlock: {
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  loginIntroTitle: {
    color: "#E8EDF5",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  loginIntroBody: {
    color: "#7A8FA8",
    fontSize: 13,
    textAlign: "center",
  },
  loginForm: {
    width: "100%",
    gap: 10,
    marginBottom: 2,
  },
  card: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    borderRadius: 14,
    backgroundColor: "#0F1A30",
    padding: 16,
    gap: 10,
  },
  sectionLabel: {
    color: "#FF7B00",
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: "800",
    marginTop: 4,
  },
  twoColRow: {
    flexDirection: "row",
    gap: 8,
  },
  twoColCell: {
    flex: 1,
    backgroundColor: "#0B1424",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  cellLabel: {
    color: "#7A8FA8",
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.6,
  },
  cellValue: {
    color: "#E8EDF5",
    fontWeight: "800",
    fontSize: 14,
  },
  inputInline: {
    backgroundColor: "#111f31",
    borderColor: "rgba(255,123,0,0.18)",
    borderWidth: 1,
    borderRadius: 8,
    color: "#E8EDF5",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  title: {
    color: "#FF7B00",
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
  },
  note: {
    color: "#7A8FA8",
    textAlign: "center",
    fontSize: 13,
  },
  input: {
    backgroundColor: "#0B1424",
    borderColor: "rgba(255,123,0,0.25)",
    borderWidth: 1,
    borderRadius: 10,
    color: "#E8EDF5",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputCompact: {
    backgroundColor: "#0B1424",
    borderColor: "rgba(255,123,0,0.2)",
    borderWidth: 1,
    borderRadius: 10,
    color: "#E8EDF5",
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12,
  },
  codeInputFigma: {
    backgroundColor: "#0F1A30",
    borderColor: "rgba(255,123,0,0.2)",
    borderWidth: 1,
    borderRadius: 10,
    color: "#E8EDF5",
    paddingHorizontal: 14,
    paddingVertical: 14,
    textAlign: "center",
    fontSize: 22,
    letterSpacing: 3,
    fontWeight: "800",
  },
  codeInput: {
    backgroundColor: "#0B1424",
    borderColor: "rgba(255,123,0,0.6)",
    borderWidth: 1,
    borderRadius: 10,
    color: "#E8EDF5",
    paddingHorizontal: 12,
    paddingVertical: 12,
    textAlign: "center",
    fontSize: 20,
    letterSpacing: 2,
    fontWeight: "700",
  },
  error: {
    color: "#D4183D",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  loginErrorPanel: {
    backgroundColor: "#3A1018",
    borderColor: "#FF496A",
    borderWidth: 2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  loginErrorTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  loginErrorText: {
    color: "#FFD6DE",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.12)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toggleLabel: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: "#FF7B00",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonFigma: {
    backgroundColor: "#FF7B00",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  primaryButtonText: {
    color: "#0B1424",
    fontWeight: "800",
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 13,
  },
  rolesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    marginBottom: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,123,0,0.12)",
  },
  dividerText: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  rolesWrapFigma: {
    flexDirection: "row",
    gap: 6,
    width: "100%",
    marginTop: 2,
  },
  roleCardFigma: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.15)",
    borderRadius: 10,
    backgroundColor: "#0F1A30",
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    minHeight: 110,
  },
  roleIcon: {
    color: "#FF7B00",
    fontSize: 18,
    lineHeight: 18,
    marginBottom: 5,
  },
  roleLabelFigma: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 11,
    textAlign: "center",
    marginBottom: 3,
  },
  roleDescFigma: {
    color: "#7A8FA8",
    fontSize: 10,
    textAlign: "center",
    lineHeight: 13,
  },
  loginFooter: {
    color: "#4A5A70",
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
  },
  restoreStatusText: {
    color: "#FFBE7A",
    fontSize: 12,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 8,
  },
  roleCard: {
    width: "48%",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.18)",
    borderRadius: 10,
    backgroundColor: "#0B1424",
    padding: 8,
    gap: 2,
  },
  roleKey: {
    color: "#FF7B00",
    fontWeight: "800",
    fontSize: 12,
  },
  roleLabel: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 12,
  },
  roleDesc: {
    color: "#7A8FA8",
    fontSize: 11,
  },
  metaRow: {
    backgroundColor: "#0B1424",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  tableRow: {
    backgroundColor: "#0B1424",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tableRowAlt: {
    backgroundColor: "#101c2f",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tableHead: {
    color: "#7A8FA8",
    fontWeight: "800",
    fontSize: 11,
    width: 48,
  },
  tableHeadFlex: {
    color: "#7A8FA8",
    fontWeight: "800",
    fontSize: 11,
    flex: 1,
  },
  tableCell: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 12,
    width: 48,
  },
  tableCellFlex: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 12,
    flex: 1,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tabButton: {
    flex: 1,
    backgroundColor: "#1A2740",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButtonActive: {
    backgroundColor: "#FF7B00",
  },
  tabButtonText: {
    color: "#7A8FA8",
    fontSize: 12,
    fontWeight: "800",
  },
  tabButtonTextActive: {
    color: "#0B1424",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#0d1829",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  tableHeaderStarter: {
    width: 52,
    color: "#FF7B00",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  tableHeaderJersey: {
    width: 52,
    color: "#FF7B00",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  tableHeaderPos: {
    width: 42,
    color: "#FF7B00",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  tableHeaderGrade: {
    width: 52,
    color: "#FF7B00",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  tableHeaderPlayer: {
    flex: 1,
    color: "#FF7B00",
    fontSize: 10,
    fontWeight: "800",
    paddingLeft: 4,
  },
  tableHeaderActive: {
    width: 48,
    color: "#FF7B00",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  tableDataRow: {
    flexDirection: "row",
    backgroundColor: "#0F1A30",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.08)",
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  tableDataRowAlt: {
    flexDirection: "row",
    backgroundColor: "#0b1526",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.08)",
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  tableDataStarter: {
    width: 52,
    color: "#FF7B00",
    textAlign: "center",
    fontWeight: "800",
  },
  starterToggleWrap: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  starterToggle: {
    width: 44,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  starterToggleOn: {
    borderColor: "rgba(255,123,0,0.8)",
    backgroundColor: "rgba(255,123,0,0.35)",
  },
  starterToggleOff: {
    borderColor: "rgba(122, 143, 168, 0.5)",
    backgroundColor: "rgba(38, 54, 75, 0.9)",
  },
  starterToggleKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  starterToggleKnobOn: {
    alignSelf: "flex-end",
    backgroundColor: "#FF9A2E",
  },
  starterToggleKnobOff: {
    alignSelf: "flex-start",
    backgroundColor: "#9BAEC7",
  },
  tableDataJersey: {
    width: 52,
    color: "#FF7B00",
    textAlign: "center",
    fontWeight: "800",
  },
  tableDataPos: {
    width: 42,
    color: "#E8EDF5",
    textAlign: "center",
    fontWeight: "700",
  },
  tableDataGrade: {
    width: 52,
    color: "#7A8FA8",
    textAlign: "center",
    fontWeight: "700",
  },
  tableDataPlayer: {
    flex: 1,
    color: "#E8EDF5",
    paddingLeft: 4,
    fontWeight: "700",
    fontSize: 12,
  },
  tableDataActive: {
    width: 48,
    color: "#E8EDF5",
    textAlign: "center",
    fontWeight: "700",
    fontSize: 11,
  },
  activeToggle: {
    width: 44,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  activeToggleOn: {
    borderColor: "rgba(51, 214, 122, 0.7)",
    backgroundColor: "rgba(28, 95, 57, 0.9)",
  },
  activeToggleOff: {
    borderColor: "rgba(122, 143, 168, 0.5)",
    backgroundColor: "rgba(38, 54, 75, 0.9)",
  },
  activeToggleKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  activeToggleKnobOn: {
    alignSelf: "flex-end",
    backgroundColor: "#4DFF9B",
  },
  activeToggleKnobOff: {
    alignSelf: "flex-start",
    backgroundColor: "#9BAEC7",
  },
  inactiveText: {
    opacity: 0.45,
  },
  footerHint: {
    color: "#4A5A70",
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
  },
  nextGameCard: {
    backgroundColor: "#0B1424",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.15)",
    padding: 12,
    gap: 8,
  },
  nextGameLoadingWrap: {
    paddingVertical: 10,
    alignItems: "center",
    gap: 8,
  },
  nextGameEmptyText: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 4,
  },
  debugPanel: {
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2b3f57",
    backgroundColor: "#0f1f33",
    padding: 10,
    gap: 4,
  },
  debugPanelTitle: {
    color: "#a8c7e6",
    fontSize: 12,
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  debugLine: {
    color: "#d8e7f8",
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  officialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#0F1A30",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.09)",
    borderRadius: 10,
  },
  officialRowAlt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#0b1526",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.09)",
    borderRadius: 10,
  },
  officialRoleCol: {
    width: 80,
  },
  officialRoleSelect: {
    width: 92,
    minHeight: 40,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#40516D",
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    backgroundColor: "#101B2E",
  },
  officialRoleText: {
    color: "#7A8FA8",
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  officialRoleChevron: {
    color: "#FF7B00",
    fontSize: 16,
    fontWeight: "800",
  },
  officialNameCol: {
    width: 120,
  },
  officialNameText: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 12,
  },
  officialSignCol: {
    flex: 1,
    gap: 3,
  },
  officialSignLabel: {
    color: "#7A8FA8",
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  addOfficialButton: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#FF7B00",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,123,0,0.08)",
  },
  addOfficialButtonText: {
    color: "#FF7B00",
    fontSize: 13,
    fontWeight: "800",
  },
  officialSelectButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#40516D",
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#101B2E",
  },
  officialSelectButtonText: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "700",
  },
  officialSelectChevron: {
    color: "#FF7B00",
    fontSize: 18,
    fontWeight: "800",
  },
  addOfficialModal: {
    width: "100%",
    maxWidth: 700,
    maxHeight: "94%",
    borderWidth: 1,
    borderColor: "#40516D",
    borderRadius: 8,
    backgroundColor: "#0B1424",
    overflow: "hidden",
  },
  addOfficialHeader: {
    minHeight: 70,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addOfficialTitle: {
    color: "#FF7B00",
    fontSize: 20,
    fontWeight: "900",
  },
  addOfficialClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  addOfficialCloseText: {
    color: "#E8EDF5",
    fontSize: 24,
    fontWeight: "700",
  },
  addOfficialDivider: {
    height: 1,
    marginHorizontal: 20,
    backgroundColor: "#FF7B00",
  },
  addOfficialBody: {
    padding: 20,
    gap: 14,
  },
  addOfficialSectionTitle: {
    color: "#F2F5FA",
    fontSize: 16,
    fontWeight: "900",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#40516D",
  },
  inputLabel: {
    color: "#AAB7C9",
    fontSize: 12,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  addOfficialFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  addOfficialField: {
    flexBasis: "46%",
    flexGrow: 1,
    minWidth: 190,
    gap: 6,
  },
  addOfficialRolesField: {
    flexBasis: "46%",
    flexGrow: 1,
    minWidth: 190,
    gap: 8,
  },
  addOfficialRoleRow: {
    minHeight: 46,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#40516D",
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0D192B",
  },
  addOfficialRoleText: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "800",
  },
  addOfficialFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#40516D",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  signaturePlaceholderMini: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.3)",
    borderRadius: 8,
    borderStyle: "dashed",
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B1424",
  },
  signatureTextMini: {
    color: "rgba(255,123,0,0.65)",
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  signaturePlaceholderSigned: {
    borderColor: "rgba(77,255,155,0.65)",
    backgroundColor: "rgba(25,95,56,0.35)",
  },
  signatureTextSigned: {
    color: "#4DFF9B",
  },
  signaturePlaceholder: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    borderRadius: 10,
    borderStyle: "dashed",
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B1424",
  },
  signatureText: {
    color: "rgba(255,123,0,0.68)",
    fontWeight: "700",
    fontSize: 12,
  },
  metaLabel: {
    color: "#7A8FA8",
    fontWeight: "700",
    fontSize: 12,
  },
  metaValue: {
    color: "#E8EDF5",
    fontWeight: "700",
    fontSize: 12,
    flexShrink: 1,
    textAlign: "right",
  },
  rowButtons: {
    flexDirection: "row",
    gap: 8,
  },
  dashboardInfoButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  dashboardInfoButton: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 48,
  },
  dashboardInfoButtonText: {
    textAlign: "center",
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  intermissionOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 120,
    backgroundColor: "rgba(5, 10, 18, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  intermissionCard: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FF7B00",
    backgroundColor: "#0F1A30",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  intermissionTitle: {
    color: "#FF7B00",
    fontSize: 23,
    fontWeight: "900",
    textAlign: "center",
  },
  intermissionSubtitle: {
    color: "#7A8FA8",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  intermissionTimerShell: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.3)",
    backgroundColor: "#0B1424",
    paddingVertical: 10,
    alignItems: "center",
    gap: 4,
  },
  intermissionTimerLabel: {
    color: "#7A8FA8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  intermissionTimerValue: {
    color: "#E8EDF5",
    fontSize: 42,
    lineHeight: 44,
    fontWeight: "900",
  },
  intermissionScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 4,
  },
  intermissionTeamScoreCol: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  intermissionTeamName: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    textAlign: "center",
  },
  intermissionTeamScore: {
    color: "#FF7B00",
    fontSize: 40,
    lineHeight: 42,
    fontWeight: "900",
  },
  intermissionScoreDivider: {
    color: "#7A8FA8",
    fontSize: 22,
    fontWeight: "900",
  },
  intermissionSectionLabel: {
    color: "#FF7B00",
    fontSize: 10,
    letterSpacing: 1.3,
    fontWeight: "900",
    textAlign: "center",
  },
  intermissionShotsTable: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.22)",
    backgroundColor: "#0B1424",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 5,
  },
  intermissionShotsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  intermissionShotsHeaderTeam: {
    flex: 1.7,
    color: "#7A8FA8",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "left",
  },
  intermissionShotsHeaderCell: {
    flex: 1,
    color: "#7A8FA8",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
  intermissionShotsDataRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#111f31",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  intermissionShotsTeamCell: {
    flex: 1.7,
    color: "#E8EDF5",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "left",
  },
  intermissionShotsDataCell: {
    flex: 1,
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  intermissionShotsDataTotalCell: {
    flex: 1,
    color: "#FF7B00",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  intermissionResumeButton: {
    backgroundColor: "#FF7B00",
    borderRadius: 11,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  intermissionResumeButtonText: {
    color: "#0B1424",
    fontSize: 14,
    fontWeight: "900",
  },
  confirmModal: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FF7B00",
    backgroundColor: "#0F1A30",
    overflow: "hidden",
  },
  confirmHeader: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 18,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,123,0,0.2)",
    backgroundColor: "#0d1829",
  },
  confirmIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  confirmTitle: {
    color: "#FF7B00",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  confirmSubtitle: {
    color: "#7a8fa8",
    fontSize: 13,
    textAlign: "center",
  },
  confirmBody: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 12,
  },
  confirmWarningCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.3)",
    backgroundColor: "rgba(255,123,0,0.08)",
  },
  confirmWarningIcon: {
    fontSize: 18,
    lineHeight: 22,
  },
  confirmWarningTextWrap: {
    flex: 1,
    gap: 4,
  },
  confirmWarningTitle: {
    color: "#E8EDF5",
    fontSize: 14,
    fontWeight: "800",
  },
  confirmWarningText: {
    color: "#7a8fa8",
    fontSize: 12,
    lineHeight: 17,
  },
  confirmFooterText: {
    color: "#7a8fa8",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    fontWeight: "600",
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,123,0,0.15)",
  },
  confirmSecondaryButton: {
    flex: 1,
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmSecondaryButtonText: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "800",
  },
  confirmPrimaryButton: {
    flex: 2,
    backgroundColor: "#FF7B00",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmPrimaryButtonText: {
    color: "#0B1424",
    fontSize: 13,
    fontWeight: "900",
  },
  scoreboardShell: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    borderRadius: 12,
    backgroundColor: "#0B1424",
    overflow: "hidden",
  },
  scoreboardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  scoreboardActionCol: {
    width: 70,
    gap: 6,
  },
  scoreboardActionGoal: {
    backgroundColor: "#1b5e20",
    borderWidth: 1,
    borderColor: "#4caf50",
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: "center",
  },
  scoreboardActionPenalty: {
    backgroundColor: "#4a3800",
    borderWidth: 1,
    borderColor: "#FFB300",
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: "center",
  },
  scoreboardActionText: {
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "800",
  },
  periodBreakdownCol: {
    width: 36,
    gap: 2,
  },
  periodBreakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  periodBreakdownRowRight: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  periodBreakdownLabel: {
    color: "#7A8FA8",
    fontSize: 9,
    fontWeight: "700",
  },
  periodBreakdownValue: {
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "800",
  },
  scoreboardTeamCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  teamChipHome: {
    borderWidth: 1,
    borderColor: "#FF7B00",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#1A2740",
  },
  teamChipAway: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.45)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#1A2740",
  },
  teamChipText: {
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  scoreHomeBig: {
    color: "#FF7B00",
    fontSize: 50,
    lineHeight: 52,
    fontWeight: "900",
  },
  scoreAwayBig: {
    color: "#E8EDF5",
    fontSize: 50,
    lineHeight: 52,
    fontWeight: "900",
  },
  scoreboardDividerText: {
    color: "#2a3a50",
    fontSize: 20,
    fontWeight: "900",
  },
  scoreboardStatusRow: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,123,0,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scoreboardMeta: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "600",
  },
  scoreboardWarning: {
    backgroundColor: "#4a1414",
    color: "#e53935",
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  scoreboardSettingsButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    backgroundColor: "#162a4a",
    alignItems: "center",
    justifyContent: "center",
  },
  scoreboardSettingsButtonText: {
    color: "#FFB15B",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 14,
  },
  scoreboardConnectionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  scoreboardConnectionBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  scoreboardConnectionManual: {
    backgroundColor: "#3f3110",
  },
  scoreboardConnectionDisconnected: {
    backgroundColor: "#4a1414",
  },
  scoreboardConnectionConnecting: {
    backgroundColor: "#11334f",
  },
  scoreboardConnectionConnected: {
    backgroundColor: "#123c2a",
  },
  scoreboardConnectionBadgeTextManual: {
    color: "#ffbf47",
  },
  scoreboardConnectionBadgeTextDisconnected: {
    color: "#e53935",
  },
  scoreboardConnectionBadgeTextConnecting: {
    color: "#4eb4ff",
  },
  scoreboardConnectionBadgeTextConnected: {
    color: "#43d17d",
  },
  scoreboardStatusBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreboardSyncBadge: {
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  scoreboardSyncOk: {
    backgroundColor: "#123c2a",
    color: "#43d17d",
  },
  scoreboardSyncInfo: {
    backgroundColor: "#11334f",
    color: "#4eb4ff",
  },
  scoreboardSyncQueued: {
    backgroundColor: "#4a3812",
    color: "#ffbf47",
  },
  scoreboardSyncError: {
    backgroundColor: "#4a1414",
    color: "#ff6b6b",
  },
  scoreboardSyncNowButton: {
    backgroundColor: "#193154",
    borderWidth: 1,
    borderColor: "#2f73c8",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scoreboardSyncNowButtonText: {
    color: "#9ed0ff",
    fontSize: 10,
    fontWeight: "800",
  },
  scoreboardTokenMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
  },
  scoreboardTokenMetaText: {
    flex: 1,
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "700",
  },
  scoreboardTokenRevealButton: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    borderRadius: 8,
    backgroundColor: "#162a4a",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scoreboardTokenRevealButtonText: {
    color: "#FFB15B",
    fontSize: 11,
    fontWeight: "800",
  },
  gameClockShell: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    borderRadius: 12,
    backgroundColor: "#0B1424",
    padding: 10,
    gap: 8,
  },
  gameClockTop: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  gameClockBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  gameClockCenterStack: {
    flex: 1,
    gap: 8,
  },
  penaltySide: {
    width: 120,
    alignItems: "stretch",
    gap: 4,
  },
  penaltySideLabel: {
    color: "#FF7B00",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  penaltyEmptyTile: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a3a5b",
    backgroundColor: "#162a4a",
    alignItems: "center",
    paddingVertical: 14,
  },
  penaltyEmptyText: {
    color: "#78909c",
    fontSize: 11,
    fontWeight: "700",
  },
  penaltyActiveTile: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    backgroundColor: "#142742",
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 3,
    minHeight: 52,
  },
  penaltyPlayerText: {
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "700",
  },
  penaltyInfractionText: {
    color: "#7A8FA8",
    fontSize: 10,
    fontWeight: "600",
  },
  penaltyClockText: {
    color: "#FFB26B",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  penaltyAdjustRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 2,
  },
  penaltyAdjustBtn: {
    borderWidth: 1,
    borderColor: "#2f4f79",
    backgroundColor: "#1A2E4F",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  penaltyAdjustBtnText: {
    color: "#D7E6FF",
    fontSize: 10,
    fontWeight: "800",
  },
  penaltyAdjustModalSummary: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    marginBottom: 14,
  },
  penaltyAdjustSummaryCol: {
    flex: 1,
    backgroundColor: "#132540",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  penaltyAdjustSummaryLabel: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "700",
  },
  penaltyAdjustSummaryValue: {
    color: "#E8EDF5",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  penaltyAdjustLayoutRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  penaltyAdjustColumn: {
    flex: 1,
    gap: 8,
  },
  penaltyAdjustPairRow: {
    flexDirection: "row",
    gap: 8,
  },
  penaltyAdjustButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  penaltyAdjustModalBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2f4f79",
    backgroundColor: "#1A2E4F",
  },
  penaltyAdjustModalBtnWide: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2f4f79",
    backgroundColor: "#1A2E4F",
  },
  penaltyAdjustModalBtnText: {
    color: "#D7E6FF",
    fontSize: 12,
    fontWeight: "900",
  },
  gameClockCenter: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  gameClockPeriod: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "800",
  },
  gameClockTime: {
    color: "#E8EDF5",
    fontSize: 56,
    lineHeight: 58,
    fontWeight: "900",
  },
  gameClockModeBadge: {
    borderWidth: 1,
    borderColor: "rgba(122,143,168,0.35)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#1A2740",
  },
  gameClockModeText: {
    color: "#7A8FA8",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  gameClockManpowerText: {
    color: "#FFB26B",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  clockPrimaryButtons: {
    flexDirection: "row",
    width: "100%",
    alignSelf: "stretch",
    justifyContent: "center",
    marginTop: 6,
    gap: 8,
  },
  clockToggleStoppedButton: {
    flex: 1,
    backgroundColor: "#2AAE62",
    borderWidth: 1,
    borderColor: "#5ef79d",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 68,
  },
  clockToggleRunningButton: {
    flex: 1,
    backgroundColor: "#4A1F2A",
    borderWidth: 1,
    borderColor: "#c44b57",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 68,
  },
  clockStartButton: {
    flex: 1,
    backgroundColor: "#2AAE62",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 12,
  },
  clockStopButton: {
    flex: 1,
    backgroundColor: "#4A1F2A",
    borderWidth: 1,
    borderColor: "#b84c60",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 12,
  },
  clockPrimaryText: {
    color: "#E8EDF5",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  clockStatusButton: {
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  clockStatusText: {
    color: "#7A8FA8",
    fontSize: 15,
    fontWeight: "900",
  },
  periodControlNotStarted: {
    backgroundColor: "#2D3A4D",
    borderWidth: 1,
    borderColor: "#5B6F89",
    borderRadius: 10,
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 10,
  },
  periodControlInProgress: {
    backgroundColor: "#1F5A37",
    borderWidth: 1,
    borderColor: "#35C070",
    borderRadius: 10,
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 10,
  },
  periodControlIntermission: {
    backgroundColor: "#5E420D",
    borderWidth: 1,
    borderColor: "#FFB75A",
    borderRadius: 10,
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 10,
  },
  clockSecondaryButtons: {
    flexDirection: "row",
    width: "100%",
    alignSelf: "stretch",
    justifyContent: "center",
    gap: 8,
  },
  clockGoalieButtons: {
    flexDirection: "row",
    width: "100%",
    alignSelf: "stretch",
    gap: 8,
  },
  clockSecondaryBtn: {
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  clockSecondaryBtnAlert: {
    backgroundColor: "rgba(192, 57, 43, 0.26)",
    borderColor: "rgba(231, 76, 60, 0.85)",
  },
  clockSingleWidthBtn: {
    width: "100%",
  },
  clockHalfWidthBtn: {
    flex: 1,
  },
  timeoutTeamRow: {
    flexDirection: "row",
    gap: 8,
  },
  timeoutTeamBtn: {
    flex: 1,
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  timeoutTeamBtnActive: {
    backgroundColor: "rgba(255,123,0,0.2)",
    borderColor: "#FF7B00",
  },
  timeoutTeamBtnText: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  timeoutAdjustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timeoutValueBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    backgroundColor: "#1A2740",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  timeoutValueText: {
    color: "#FF7B00",
    fontSize: 18,
    fontWeight: "800",
  },
  clockSecondaryText: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "700",
  },
  clockPenaltySummaryText: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  shotsShell: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    borderRadius: 12,
    backgroundColor: "#0B1424",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 8,
  },
  shotsPeriodCol: {
    width: 52,
    gap: 6,
  },
  shotsPeriodRowLeft: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shotsPeriodRowRight: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shotsPeriodText: {
    color: "#7A8FA8",
    fontSize: 10,
    fontWeight: "700",
  },
  shotsPeriodValue: {
    color: "#8AA1BD",
    fontSize: 10,
    fontWeight: "800",
    minWidth: 14,
    textAlign: "center",
  },
  shotsTeamCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  shotsTeamName: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    textAlign: "center",
  },
  shotsBigValue: {
    color: "#FF7B00",
    fontSize: 46,
    lineHeight: 48,
    fontWeight: "900",
    minWidth: 64,
    textAlign: "center",
  },
  shotsCountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  shotsAdjustBtn: {
    backgroundColor: "#1A2740",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a3a5b",
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  shotsAdjustBtnPrimary: {
    backgroundColor: "#FF7B00",
    borderRadius: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  shotsAdjustText: {
    color: "#E8EDF5",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 26,
  },
  shotsAdjustTextPrimary: {
    color: "#0B1424",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 26,
  },
  shotsDividerLine: {
    width: 1,
    height: 76,
    backgroundColor: "#2a3a5b",
  },
  eventsHeaderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eventFilterButtons: {
    flexDirection: "row",
    gap: 6,
  },
  eventFilterButton: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#40516D",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101C30",
  },
  eventFilterButtonActive: {
    borderColor: "#FF7B00",
    backgroundColor: "#FF7B00",
  },
  eventFilterButtonText: {
    color: "#AAB7C9",
    fontSize: 11,
    fontWeight: "800",
  },
  eventFilterButtonTextActive: {
    color: "#0B1424",
  },
  eventsPanel: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    borderRadius: 10,
    backgroundColor: "#0B1424",
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  eventsListViewport: {
    maxHeight: 330,
  },
  eventsHint: {
    color: "#7A8FA8",
    fontSize: 12,
    fontWeight: "700",
  },
  eventRow: {
    flexDirection: "row",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,123,0,0.12)",
    paddingVertical: 8,
  },
  eventTime: {
    color: "#FF7B00",
    fontSize: 11,
    fontWeight: "800",
    width: 74,
  },
  eventBody: {
    flex: 1,
    gap: 2,
  },
  eventTitle: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "800",
  },
  eventSubtitle: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "700",
  },
  goalModal: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "92%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FF7B00",
    backgroundColor: "#0D1A2B",
    padding: 14,
    gap: 8,
  },
  goalModalTitle: {
    color: "#FF7B00",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  goalModalSubtitle: {
    color: "#7A8FA8",
    textAlign: "center",
    fontSize: 12,
    marginBottom: 2,
  },
  goalLockedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  goalLockedItem: {
    width: "48%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.2)",
    backgroundColor: "#0B1424",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  goalLockedLabel: {
    color: "#7A8FA8",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  goalLockedValue: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "800",
  },
  themedSelectTrigger: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.75)",
    borderRadius: 8,
    backgroundColor: "#122844",
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  themedSelectValue: {
    flex: 1,
    color: "#F3F7FD",
    fontSize: 14,
    fontWeight: "800",
  },
  themedSelectPlaceholder: {
    color: "#8EA9C9",
  },
  themedSelectChevron: {
    color: "#FF7B00",
    fontSize: 16,
    fontWeight: "900",
  },
  dropdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.86)",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "80%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FF7B00",
    backgroundColor: "#0D1A2B",
    padding: 12,
    gap: 8,
  },
  dropdownTitle: {
    color: "#FF7B00",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  dropdownList: {
    maxHeight: 420,
  },
  dropdownListContent: {
    gap: 6,
    paddingBottom: 2,
  },
  dropdownOption: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.28)",
    borderRadius: 8,
    backgroundColor: "#132848",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownOptionSelected: {
    borderColor: "#FF7B00",
    backgroundColor: "rgba(255,123,0,0.18)",
  },
  dropdownOptionText: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "700",
  },
  dropdownOptionTextSelected: {
    color: "#FFB15B",
    fontWeight: "900",
  },
  dropdownCloseButton: {
    marginTop: 2,
    backgroundColor: "#1A2740",
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.4)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  dropdownCloseButtonText: {
    color: "#E8EDF5",
    fontWeight: "800",
    fontSize: 13,
  },
  clockPresetButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    backgroundColor: "#1A2740",
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  clockPresetButtonText: {
    color: "#FFB15B",
    fontSize: 13,
    fontWeight: "800",
  },
  clockAdjustRow: {
    flexDirection: "row",
    gap: 10,
  },
  clockAdjustColumn: {
    flex: 1,
    gap: 4,
  },
  clockManualPanel: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.65)",
    backgroundColor: "#102446",
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
  },
  clockManualHeaderRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 68,
  },
  clockManualHeaderText: {
    color: "#72A8DE",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  clockManualAdjustRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  clockManualColumn: {
    alignItems: "center",
    gap: 4,
  },
  clockArrowButton: {
    width: 42,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    backgroundColor: "#223D61",
    alignItems: "center",
    justifyContent: "center",
  },
  clockArrowText: {
    color: "#FF9100",
    fontSize: 15,
    fontWeight: "900",
  },
  clockGhostValue: {
    color: "#2F4F77",
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 24,
    minWidth: 34,
    textAlign: "center",
  },
  clockValueBox: {
    minWidth: 62,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FF7B00",
    backgroundColor: "#132848",
    paddingVertical: 8,
    alignItems: "center",
  },
  clockValueText: {
    color: "#F4F8FF",
    fontSize: 37,
    fontWeight: "900",
    lineHeight: 40,
    letterSpacing: 1,
  },
  clockColon: {
    color: "#FF7B00",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 18,
  },
  clockManualFooter: {
    color: "#8AAFD4",
    fontSize: 12,
    textAlign: "center",
  },
  clockManualFooterValue: {
    color: "#FF7B00",
    fontWeight: "900",
  },
  quickPickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickPickPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.35)",
    backgroundColor: "#152542",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quickPickPillActive: {
    borderColor: "#FF7B00",
    backgroundColor: "rgba(255,123,0,0.2)",
  },
  quickPickPillText: {
    color: "#9EB1CC",
    fontSize: 12,
    fontWeight: "800",
  },
  quickPickPillTextActive: {
    color: "#FFB15B",
  },
  goalTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  goalTypeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.25)",
    backgroundColor: "#1A2740",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  goalTypeButtonActive: {
    borderColor: "#FF7B00",
    backgroundColor: "rgba(255,123,0,0.2)",
  },
  goalTypeButtonText: {
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "700",
  },
  goalTypeButtonTextActive: {
    color: "#FFB15B",
  },
  goalTypeButtonDisabled: {
    opacity: 0.45,
  },
  goalTypeButtonTextDisabled: {
    color: "#5F728A",
  },
  powerPlayIndicator: {
    color: "#FF7B00",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 6,
  },
  endGameButton: {
    borderWidth: 1,
    borderColor: "#c0392b",
    backgroundColor: "#1A2740",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 12,
    gap: 2,
  },
  endGameButtonText: {
    color: "#e74c3c",
    fontSize: 18,
    fontWeight: "900",
  },
  endGameSubText: {
    color: "#7A8FA8",
    fontSize: 11,
    fontWeight: "600",
  },
  dqNoteCard: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.18)",
    borderRadius: 10,
    backgroundColor: "#0B1424",
    padding: 10,
    gap: 6,
  },
  dqNoteTitle: {
    color: "#E8EDF5",
    fontSize: 14,
    fontWeight: "800",
  },
  dqNoteMeta: {
    color: "#8AA1BD",
    fontSize: 11,
    fontWeight: "700",
  },
  dqNoteInput: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.18)",
    borderRadius: 8,
    backgroundColor: "#111f31",
    color: "#E8EDF5",
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    textAlignVertical: "top",
  },
  summarySectionCard: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.18)",
    borderRadius: 10,
    backgroundColor: "#0B1424",
    padding: 12,
    gap: 8,
  },
  summaryBreakdownTable: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.16)",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#0d1829",
  },
  summaryBreakdownHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,123,0,0.2)",
    backgroundColor: "#101f35",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  summaryBreakdownDataRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,123,0,0.1)",
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  summaryBreakdownHeaderText: {
    color: "#7A8FA8",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.6,
  },
  summaryBreakdownCellTeam: {
    flex: 1.8,
    textAlign: "left",
  },
  summaryBreakdownCellValue: {
    flex: 1,
  },
  summaryBreakdownCellTeamValue: {
    flex: 1.8,
    color: "#E8EDF5",
    fontSize: 14,
    fontWeight: "900",
  },
  summaryBreakdownCellValueText: {
    flex: 1,
    color: "#8AA1BD",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  summaryBreakdownCellTotalValue: {
    flex: 1,
    color: "#FF7B00",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  summaryStatGrid: {
    flexDirection: "row",
    gap: 10,
  },
  summaryStatColumn: {
    flex: 1,
    gap: 4,
  },
  summaryStatTeam: {
    color: "#FFB26B",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  summaryStatLine: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "700",
  },
  summaryEventCard: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.14)",
    borderRadius: 8,
    backgroundColor: "#132038",
    padding: 10,
    gap: 4,
  },
  summaryEventTitle: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "800",
  },
  summaryEventMeta: {
    color: "#8AA1BD",
    fontSize: 11,
    fontWeight: "700",
  },
  summaryGoalieStintLine: {
    color: "#AFC3DA",
    fontSize: 11,
    fontWeight: "600",
  },
  summaryActivePlayerLine: {
    color: "#E8EDF5",
    fontSize: 12,
    fontWeight: "700",
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.14)",
    borderRadius: 8,
    backgroundColor: "#132038",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  recipientTextWrap: {
    flex: 1,
    gap: 2,
  },
  recipientName: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "800",
  },
  recipientMeta: {
    color: "#8AA1BD",
    fontSize: 11,
    fontWeight: "700",
  },
  rosterPreviewList: {
    maxHeight: 340,
    marginBottom: 10,
  },
  starterInformationModal: {
    width: "100%",
    maxWidth: 860,
    maxHeight: "92%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FF7B00",
    backgroundColor: "#0D1A2B",
    padding: 14,
    gap: 8,
  },
  starterInformationScroll: {
    maxHeight: 520,
    marginBottom: 10,
  },
  starterInformationTeamGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  starterInformationTeamColumn: {
    flex: 1,
    minWidth: 280,
    borderWidth: 1,
    borderColor: "#2A3A5B",
    borderRadius: 10,
    backgroundColor: "#0B1424",
    padding: 10,
  },
  starterInformationTeamTitle: {
    color: "#FFB26B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  starterInformationTeamName: {
    color: "#E8EDF5",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
    marginTop: 2,
  },
  starterInformationPlayerLine: {
    color: "#E8EDF5",
    fontSize: 16,
    fontWeight: "800",
  },
  starterInformationPositionLabel: {
    color: "#FFB26B",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 5,
    marginTop: 2,
  },
  starterInformationOfficials: {
    marginTop: 14,
  },
  rosterPreviewGroupLabel: {
    color: "#8AA1BD",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: 2,
  },
  rosterPreviewRow: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.14)",
    borderRadius: 8,
    backgroundColor: "#132038",
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 2,
  },
  rosterPreviewTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rosterPreviewName: {
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: "800",
  },
  starterBadge: {
    borderWidth: 1,
    borderColor: "rgba(255,123,0,0.9)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(255,123,0,0.18)",
  },
  starterBadgeText: {
    color: "#FFB26B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  rosterPreviewMeta: {
    color: "#8AA1BD",
    fontSize: 11,
    fontWeight: "700",
  },
  eventEditScrollView: {
    flexGrow: 0,
    maxHeight: "78%",
  },
  eventEditScrollContent: {
    gap: 8,
    paddingBottom: 6,
  },
  addEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addEmailInput: {
    flex: 1,
    marginBottom: 0,
  },
  addEmailActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  removeEmailButton: {
    borderWidth: 1,
    borderColor: "rgba(239,83,80,0.7)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(239,83,80,0.12)",
  },
  removeEmailButtonText: {
    color: "#f7a8a6",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  emailStatusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  emailStatusBadgeSent: {
    borderColor: "rgba(60,196,118,0.75)",
    backgroundColor: "rgba(60,196,118,0.16)",
  },
  emailStatusBadgeFailed: {
    borderColor: "rgba(239,83,80,0.75)",
    backgroundColor: "rgba(239,83,80,0.16)",
  },
  emailStatusBadgeQueued: {
    borderColor: "rgba(255,191,71,0.75)",
    backgroundColor: "rgba(255,191,71,0.16)",
  },
  emailStatusBadgeTitle: {
    color: "#E8EDF5",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  emailStatusBadgeText: {
    color: "#BFD0E4",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
  },
  disabledButton: {
    opacity: 0.4,
  },
});
