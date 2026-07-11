export type Faction = "good" | "evil";

export type Role =
  | "merlin"
  | "percival"
  | "loyal-servant"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "minion";

export type RolePreset = "classic" | "advanced";
export type RejectionRule = "evil-wins" | "fifth-auto";
export type RoomMode = "standard" | "experience";
export type GamePhase =
  | "lobby"
  | "identity"
  | "team-building"
  | "team-voting"
  | "quest-voting"
  | "quest-result"
  | "assassination"
  | "complete";
export type MissionOutcome = "success" | "failure";
export type Winner = Faction;

export interface RoomSettings {
  playerCount: number;
  rolePreset: RolePreset;
  rejectionRule: RejectionRule;
  mode: RoomMode;
}

export interface PublicPlayer {
  id: string;
  nickname: string;
  seat: number;
  isHost: boolean;
  isSimulated: boolean;
  ready: boolean;
  connected: boolean;
  identityConfirmed: boolean;
}

export interface PublicMission {
  number: number;
  teamSize: number;
  requiresTwoFails: boolean;
  outcome: MissionOutcome | null;
  failCount: number | null;
  teamPlayerIds: string[];
}

export interface RevealedRole {
  playerId: string;
  role: Role;
  faction: Faction;
}

export interface PublicRoomState {
  code: string;
  name: string;
  settings: RoomSettings;
  phase: GamePhase;
  players: PublicPlayer[];
  leaderSeat: number | null;
  missionIndex: number;
  missions: PublicMission[];
  rejectionCount: number;
  proposedTeam: string[];
  voteCountdownEndsAt: number | null;
  lastQuestResult: { outcome: MissionOutcome; failCount: number; ballots: MissionOutcome[] } | null;
  winner: Winner | null;
  assassinationTargetId: string | null;
  revealedRoles: RevealedRole[];
  version: number;
}

export interface KnownPlayer {
  playerId: string;
  nickname: string;
  seat: number;
}

export interface PrivatePlayerState {
  playerId: string;
  role: Role | null;
  faction: Faction | null;
  knownPlayers: KnownPlayer[];
  canConfirmIdentity: boolean;
  canProposeTeam: boolean;
  canStartPublicVote: boolean;
  canRecordPublicVote: boolean;
  canSubmitQuest: boolean;
  questVoteSubmitted: boolean;
  canContinueAfterQuest: boolean;
  canAssassinate: boolean;
  canRematch: boolean;
}

export interface SessionSnapshot {
  public: PublicRoomState;
  private: PrivatePlayerState | null;
}

export interface SessionCredentials {
  roomCode: string;
  playerId: string;
  token: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export type CommandAck<T = void> = (result: ApiResult<T>) => void;

export interface ClientToServerEvents {
  "player:ready": (ready: boolean, ack: CommandAck) => void;
  "player:seat": (seat: number, ack: CommandAck) => void;
  "player:leave": (ack: CommandAck) => void;
  "room:dissolve": (ack: CommandAck) => void;
  "game:start": (ack: CommandAck) => void;
  "identity:confirm": (ack: CommandAck) => void;
  "team:propose": (playerIds: string[], ack: CommandAck) => void;
  "team-vote:start": (ack: CommandAck<{ endsAt: number }>) => void;
  "team-vote:record": (rejectCount: number, ack: CommandAck<{ approved: boolean }>) => void;
  "quest:submit": (vote: MissionOutcome, ack: CommandAck) => void;
  "quest:continue": (ack: CommandAck) => void;
  "assassination:select": (targetPlayerId: string, ack: CommandAck) => void;
  "game:rematch": (ack: CommandAck) => void;
}

export interface ServerToClientEvents {
  "room:public": (state: PublicRoomState) => void;
  "player:private": (state: PrivatePlayerState) => void;
  "room:error": (message: string) => void;
  "room:closed": (notice: { reason: "dissolved"; message: string }) => void;
}

export type InterServerEvents = Record<never, never>;

export interface SocketData {
  roomCode: string;
  playerId: string | null;
  token: string | null;
  mode: "player" | "board";
}

export interface RoleDetails {
  name: string;
  faction: Faction;
  summary: string;
  objective: string;
  asset: string;
}

export const ROLE_DETAILS: Record<Role, RoleDetails> = {
  merlin: {
    name: "梅林",
    faction: "good",
    summary: "知道大多数邪恶方，但必须隐藏自己。",
    objective: "带领正义完成三次任务，并躲过刺杀。",
    asset: "/assets/roles/merlin.webp",
  },
  percival: {
    name: "派西维尔",
    faction: "good",
    summary: "能看见梅林和莫甘娜，但无法区分二者。",
    objective: "保护真正的梅林，帮助正义完成任务。",
    asset: "/assets/roles/percival.webp",
  },
  "loyal-servant": {
    name: "忠臣",
    faction: "good",
    summary: "没有额外信息，需要从现场行为中判断阵营。",
    objective: "让正义完成三次任务。",
    asset: "/assets/roles/loyal-servant.webp",
  },
  assassin: {
    name: "刺客",
    faction: "evil",
    summary: "任务结束后拥有刺杀梅林的最后机会。",
    objective: "破坏三次任务，或在最后刺中梅林。",
    asset: "/assets/roles/assassin.webp",
  },
  morgana: {
    name: "莫甘娜",
    faction: "evil",
    summary: "在派西维尔眼中会伪装成梅林。",
    objective: "误导正义并破坏三次任务。",
    asset: "/assets/roles/morgana.webp",
  },
  mordred: {
    name: "莫德雷德",
    faction: "evil",
    summary: "不会被梅林看见。",
    objective: "隐藏自己并帮助邪恶方获胜。",
    asset: "/assets/roles/mordred.webp",
  },
  oberon: {
    name: "奥伯伦",
    faction: "evil",
    summary: "不认识其他邪恶方，其他邪恶方也看不见你。",
    objective: "独自判断同伴并破坏任务。",
    asset: "/assets/roles/oberon.webp",
  },
  minion: {
    name: "爪牙",
    faction: "evil",
    summary: "知道大部分邪恶同伴。",
    objective: "潜入任务队伍并破坏三次任务。",
    asset: "/assets/roles/minion.webp",
  },
};
