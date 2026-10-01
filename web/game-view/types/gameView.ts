export type TeamType = "Girls" | "Boys";

export interface GameViewFilters {
  seasonId: string;
  organizationId: string;
  leagueId: string;
  teamLevel: string;
  teamType: TeamType | "";
}

export interface GameViewFilterOption {
  id: string;
  label: string;
}

export interface GameViewFilterData {
  seasons: GameViewFilterOption[];
  currentSeasonId: string;
  organizations: GameViewFilterOption[];
  leagues: GameViewFilterOption[];
  teamLevels: GameViewFilterOption[];
}

export interface NextGameCardModel {
  gameId: string;
  teamId: string;
  teamName: string;
  opponentName: string;
  matchupLabel?: string;
  teamContextLabel?: string;
  startTimeIso: string;
  status: string;
  isLive: boolean;
  homeScore?: number;
  awayScore?: number;
}

export interface UpcomingScheduleItemModel {
  gameId: string;
  startTimeIso: string;
  homeTeamName: string;
  awayTeamName: string;
  matchupLabel?: string;
  teamContextLabel?: string;
  status: string;
}

export interface LastFinalGameItemModel {
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  matchupLabel?: string;
  teamContextLabel?: string;
  gameDateIso: string;
  status: string;
  scoreText: string;
}

export interface ApiSeason {
  seasonId: string;
  seasonName?: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface ApiOrganization {
  organizationId: string;
  leagueId?: string | null;
  leagueName?: string | null;
  name?: string | null;
  abbreviation?: string | null;
  mascot?: string | null;
  organizationType?: string | null;
  isActive: boolean;
}

export interface ApiTeam {
  teamId: string;
  organizationId?: string | null;
  leagueId?: string | null;
  organizationType?: string | null;
  seasonId?: string | null;
  name?: string | null;
  teamType?: string | null;
  levelName?: string | null;
  teamMascot?: string | null;
  isActive?: boolean;
}

export interface ApiGameListItem {
  gameId: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  gameDateTime: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
}

export interface ApiGameDetail {
  gameId: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  gameDateTime: string;
  status: string;
  periodLengthMinutes: number;
}

export interface ApiNextGame {
  gameId: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  opponentName: string;
  startTime: string;
  teamType?: string | null;
  levelName?: string | null;
  homeTeamMascot?: string | null;
  awayTeamMascot?: string | null;
}

export interface ApiSummaryGoal {
  eventId: string;
  period?: number;
  timeInPeriod?: string;
  teamName: string;
  scorerName?: string;
  assist1Name?: string | null;
  assist2Name?: string | null;
  strength?: string | null;
}

export interface ApiSummaryPenalty {
  eventId: string;
  period?: number;
  timeInPeriod?: string;
  teamName: string;
  playerName: string;
  infraction: string;
  durationMinutes: number;
}

export interface ApiSummaryShot {
  eventId: string;
  period?: number;
  timeInPeriod?: string;
  teamName: string;
}

export interface ApiGameSummary {
  gameId: string;
  currentPeriod?: number;
  goals: ApiSummaryGoal[];
  penalties: ApiSummaryPenalty[];
  shots: ApiSummaryShot[];
  homeShotsP1?: number;
  homeShotsP2?: number;
  homeShotsP3?: number;
  homeShotsOT?: number;
  homeShots?: number;
  awayShotsP1?: number;
  awayShotsP2?: number;
  awayShotsP3?: number;
  awayShotsOT?: number;
  awayShots?: number;
  homeOnPowerPlay?: boolean;
  awayOnPowerPlay?: boolean;
  homeSkatersOnIce?: number;
  awaySkatersOnIce?: number;
  homeStarterIds?: string[];
  awayStarterIds?: string[];
}

export interface ApiSummaryPeriodShots {
  p1: number;
  p2: number;
  p3: number;
  ot: number;
  total: number;
}

export interface ApiSummaryReportGoal {
  period: number;
  timeInPeriod: string;
  teamName: string;
  scorerNumber?: number | null;
  scorer: string;
  assist1Number?: number | null;
  assist1?: string | null;
  assist2Number?: number | null;
  assist2?: string | null;
  strength: string;
}

export interface ApiSummaryReportPenalty {
  period: number;
  timeInPeriod: string;
  teamName: string;
  playerNumber?: number | null;
  playerName: string;
  infraction: string;
  durationMinutes: number;
  penaltyType?: string | null;
  notes?: string | null;
}

export interface ApiSummaryReportGoalie {
  teamName: string;
  goalieName: string;
  p1: number;
  p2: number;
  p3: number;
  ot: number;
  total: number;
  timeInNetSeconds: number;
  goalsAgainstEstimate: number;
  savesEstimate: number;
  savePctEstimate: number;
}

export interface ApiSummaryReportOfficial {
  role: string;
  officialName: string;
}

export interface ApiSummaryReportSuspension {
  period: number;
  timeInPeriod: string;
  teamName: string;
  playerNumber?: number | null;
  playerName: string;
  suspensionBehavior?: string | null;
  requiresRefereeNotes: boolean;
  reviewRequired: boolean;
  notes?: string | null;
}

export interface ApiGameSummaryReport {
  gameId: string;
  leagueName: string;
  homeLevelName: string;
  awayLevelName: string;
  seasonName: string;
  gameDateTime: string;
  status: string;
  homeTeamName: string;
  awayTeamName: string;
  teamType: string;
  homeTeamMascot: string;
  awayTeamMascot: string;
  arenaName: string;
  rinkName: string;
  homeHeadCoachName: string;
  homeAssistantCoach1Name: string;
  homeAssistantCoach2Name: string;
  homeAssistantCoach3Name: string;
  homeAssistantCoach4Name: string;
  awayHeadCoachName: string;
  awayAssistantCoach1Name: string;
  awayAssistantCoach2Name: string;
  awayAssistantCoach3Name: string;
  awayAssistantCoach4Name: string;
  homeGoals: number;
  awayGoals: number;
  homeShots: ApiSummaryPeriodShots;
  awayShots: ApiSummaryPeriodShots;
  goals: ApiSummaryReportGoal[];
  penalties: ApiSummaryReportPenalty[];
  goalies: ApiSummaryReportGoalie[];
  officials: ApiSummaryReportOfficial[];
  suspensionReviews: ApiSummaryReportSuspension[];
}

export interface ApiRosterPlayer {
  playerId: string;
  fullName: string;
  jerseyNumber?: number | null;
  position?: string | null;
  grade?: number | string | null;
  isGoalie?: boolean;
  isActive?: boolean;
}

export interface ApiTeamCoach {
  roleName: string;
  coachName: string;
  coachEmail?: string | null;
}

export interface ApiPublicRosterRow {
  playerId: string;
  playerName: string;
  jerseyNumber: string;
  position: string;
  grade: string;
  isGoalie: boolean;
  isStarter: boolean;
  goals: number;
  assists: number;
  penaltyMinutes: number;
  shotsAgainst: number;
  goalsAgainst: number;
  goalsAgainstAverage: number;
  savePercentage: number;
  minutesPlayed: number;
}

export interface ApiPublicRosterBundle {
  homeRoster: ApiPublicRosterRow[];
  awayRoster: ApiPublicRosterRow[];
  goalieStatsNotice?: string | null;
}

export interface ApiPublicCoachBundle {
  homeCoaches: ApiTeamCoach[];
  awayCoaches: ApiTeamCoach[];
}
