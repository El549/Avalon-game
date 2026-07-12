import { randomBytes, randomUUID } from "node:crypto";
import type {
  MissionOutcome,
  PrivatePlayerState,
  PublicMission,
  PublicPlayer,
  PublicRoomState,
  Role,
  RoomSettings,
  SessionCredentials,
  SessionSnapshot,
  Winner,
} from "@shared/contracts";
import {
  createRoleDeck,
  factionForRole,
  getMissionConfig,
  knownPlayersFor,
  questOutcome,
  shuffle,
  teamIsApproved,
} from "@shared/rules";

export class RoomError extends Error {
  constructor(
    message: string,
    public readonly code = "ROOM_ERROR",
    public readonly status = 400,
  ) {
    super(message);
  }
}

interface PlayerRecord extends PublicPlayer {
  token: string;
  role: Role | null;
}

type MissionRecord = PublicMission;

interface RoomDependencies {
  random?: () => number;
  now?: () => number;
}

const EXPERIENCE_ROLES_BY_SEAT: Role[] = ["merlin", "assassin", "percival", "loyal-servant", "morgana"];
const EXPERIENCE_PLAYERS = [
  { nickname: "模拟骑士A", seat: 3 },
  { nickname: "模拟骑士B", seat: 4 },
  { nickname: "模拟骑士C", seat: 5 },
];
const QUEST_REVEAL_DURATION_MS = 3_000;

export interface QuestRevealSchedule {
  missionIndex: number;
  durationMs: number;
  endsAt: number;
}

function createToken(): string {
  return randomBytes(24).toString("base64url");
}

export class GameRoom {
  readonly code: string;
  readonly name: string;
  readonly settings: RoomSettings;
  private readonly random: () => number;
  private readonly now: () => number;
  private players: PlayerRecord[] = [];
  private phase: PublicRoomState["phase"] = "lobby";
  private leaderSeat: number | null = null;
  private missionIndex = 0;
  private missions: MissionRecord[];
  private rejectionCount = 0;
  private draftTeam: string[] = [];
  private proposedTeam: string[] = [];
  private questRevealEndsAt: number | null = null;
  private questVotes: Record<string, MissionOutcome> = {};
  private lastQuestResult: PublicRoomState["lastQuestResult"] = null;
  private winner: Winner | null = null;
  private assassinationTargetId: string | null = null;
  private version = 0;
  private updatedAt: number;
  private readonly hostCredentials: SessionCredentials;

  constructor(
    code: string,
    name: string,
    settings: RoomSettings,
    hostNickname: string,
    dependencies: RoomDependencies = {},
  ) {
    this.code = code;
    this.name = name;
    this.settings = settings;
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.updatedAt = this.now();
    this.missions = getMissionConfig(settings.playerCount).map((config, index) => ({
      number: index + 1,
      ...config,
      outcome: null,
      failCount: null,
      teamPlayerIds: [],
    }));
    this.hostCredentials = this.addPlayer(hostNickname, 1, true);
    if (this.settings.mode === "experience") {
      for (const simulated of EXPERIENCE_PLAYERS) {
        const credentials = this.addPlayer(simulated.nickname, simulated.seat, false, true);
        const player = this.requirePlayer(credentials.playerId);
        player.ready = true;
        player.connected = true;
      }
    }
  }

  get lastUpdatedAt(): number {
    return this.updatedAt;
  }

  get playerCount(): number {
    return this.players.length;
  }

  hasPlayer(playerId: string): boolean {
    return this.players.some((player) => player.id === playerId);
  }

  private touch(): void {
    this.version += 1;
    this.updatedAt = this.now();
  }

  private requirePlayer(playerId: string): PlayerRecord {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new RoomError("找不到这名玩家", "PLAYER_NOT_FOUND", 404);
    return player;
  }

  private requireHost(playerId: string): PlayerRecord {
    const player = this.requirePlayer(playerId);
    if (!player.isHost) throw new RoomError("只有房主可以执行这个操作", "HOST_ONLY", 403);
    return player;
  }

  private canControlPublicFlow(playerId: string): boolean {
    const player = this.requirePlayer(playerId);
    return player.isHost || player.seat === this.leaderSeat;
  }

  private canRecordPublicVote(playerId: string): boolean {
    const player = this.requirePlayer(playerId);
    const leader = this.players.find((candidate) => candidate.seat === this.leaderSeat);
    if (!leader) return false;
    return leader.isSimulated ? player.isHost : player.id === leader.id;
  }

  private nextLeaderSeat(): number {
    if (this.leaderSeat === null) return 1;
    return (this.leaderSeat % this.settings.playerCount) + 1;
  }

  private resetRoundState(): void {
    this.draftTeam = [];
    this.proposedTeam = [];
    this.questRevealEndsAt = null;
    this.questVotes = {};
    this.lastQuestResult = null;
  }

  private assignRoles(): void {
    const seatedPlayers = [...this.players].sort((a, b) => a.seat - b.seat);
    const roles = this.settings.mode === "experience"
      ? EXPERIENCE_ROLES_BY_SEAT
      : shuffle(createRoleDeck(this.settings.playerCount, this.settings.rolePreset), this.random);
    seatedPlayers.forEach((player, index) => {
      player.role = roles[index];
      player.identityConfirmed = false;
    });
  }

  private finish(winner: Winner): void {
    this.winner = winner;
    this.phase = "complete";
    this.questRevealEndsAt = null;
  }

  addPlayer(nickname: string, seat: number, isHost = false, isSimulated = false): SessionCredentials {
    if (this.phase !== "lobby") throw new RoomError("游戏已经开始，不能加入", "GAME_STARTED", 409);
    if (this.players.length >= this.settings.playerCount) throw new RoomError("房间已经坐满", "ROOM_FULL", 409);
    if (!Number.isInteger(seat) || seat < 1 || seat > this.settings.playerCount) {
      throw new RoomError("座位号无效", "INVALID_SEAT");
    }
    if (this.settings.mode === "experience" && !isSimulated && !isHost && seat !== 2) {
      throw new RoomError("流程体验请使用 2 号座位", "EXPERIENCE_SEAT_ONLY", 409);
    }
    if (this.players.some((player) => player.seat === seat)) throw new RoomError("这个座位已经有人", "SEAT_TAKEN", 409);
    if (this.players.some((player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      throw new RoomError("桌上已经有同名玩家", "NICKNAME_TAKEN", 409);
    }
    const player: PlayerRecord = {
      id: randomUUID(),
      token: createToken(),
      nickname,
      seat,
      isHost,
      isSimulated,
      ready: false,
      connected: false,
      identityConfirmed: false,
      role: null,
    };
    this.players.push(player);
    this.touch();
    return { roomCode: this.code, playerId: player.id, token: player.token };
  }

  initialHostCredentials(): SessionCredentials {
    return { ...this.hostCredentials };
  }

  authenticate(token: string): { id: string } {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player) throw new RoomError("身份凭证无效，请重新加入房间", "INVALID_SESSION", 401);
    return { id: player.id };
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.requirePlayer(playerId);
    if (player.connected === connected) return;
    player.connected = connected;
    this.touch();
  }

  setReady(playerId: string, ready: boolean): void {
    if (this.phase !== "lobby") throw new RoomError("现在不能修改准备状态", "INVALID_PHASE");
    const player = this.requirePlayer(playerId);
    player.ready = ready;
    this.touch();
  }

  changeSeat(playerId: string, seat: number): void {
    if (this.phase !== "lobby") throw new RoomError("游戏开始后不能更换座位", "INVALID_PHASE");
    if (this.settings.mode === "experience") throw new RoomError("流程体验的座位已经固定", "EXPERIENCE_SEATS_LOCKED");
    if (!Number.isInteger(seat) || seat < 1 || seat > this.settings.playerCount) {
      throw new RoomError("座位号无效", "INVALID_SEAT");
    }
    const player = this.requirePlayer(playerId);
    if (player.seat === seat) return;
    if (this.players.some((candidate) => candidate.seat === seat)) throw new RoomError("这个座位已经有人", "SEAT_TAKEN", 409);
    player.seat = seat;
    player.ready = false;
    this.touch();
  }

  leave(playerId: string): void {
    if (this.phase !== "lobby") throw new RoomError("游戏开始后不能直接离开，请与全桌确认", "INVALID_PHASE");
    const player = this.requirePlayer(playerId);
    if (player.isHost) throw new RoomError("房主需要解散桌局", "HOST_MUST_DISSOLVE", 403);
    if (player.isSimulated) throw new RoomError("模拟玩家不能离开", "SIMULATED_PLAYER", 403);
    this.players = this.players.filter((candidate) => candidate.id !== playerId);
    this.touch();
  }

  removePlayer(hostId: string, targetPlayerId: string): void {
    if (this.phase !== "lobby") throw new RoomError("游戏开始后不能移出玩家", "INVALID_PHASE");
    this.requireHost(hostId);
    const target = this.requirePlayer(targetPlayerId);
    if (target.isHost) throw new RoomError("房主不能移出自己", "CANNOT_REMOVE_HOST", 403);
    if (target.isSimulated) throw new RoomError("不能移出流程体验的模拟玩家", "SIMULATED_PLAYER", 403);
    this.players = this.players.filter((player) => player.id !== targetPlayerId);
    this.touch();
  }

  assertCanDissolve(playerId: string): void {
    if (this.phase !== "lobby") throw new RoomError("游戏开始后不能直接解散，请与全桌确认", "INVALID_PHASE");
    this.requireHost(playerId);
  }

  resetToLobby(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase === "lobby") throw new RoomError("当前已经在候场阶段", "INVALID_PHASE");
    this.phase = "lobby";
    this.leaderSeat = null;
    this.missionIndex = 0;
    this.missions = getMissionConfig(this.settings.playerCount).map((config, index) => ({
      number: index + 1,
      ...config,
      outcome: null,
      failCount: null,
      teamPlayerIds: [],
    }));
    this.rejectionCount = 0;
    this.winner = null;
    this.assassinationTargetId = null;
    this.resetRoundState();
    this.players.forEach((player) => {
      player.role = null;
      player.identityConfirmed = false;
      player.ready = player.isSimulated;
    });
    this.touch();
  }

  startGame(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase !== "lobby") throw new RoomError("游戏已经开始", "INVALID_PHASE");
    if (this.players.length !== this.settings.playerCount) throw new RoomError("需要所有座位坐满后才能开始", "ROOM_NOT_FULL");
    if (!this.players.every((player) => player.ready && player.connected)) {
      throw new RoomError("需要所有玩家在线并准备", "PLAYERS_NOT_READY");
    }
    this.assignRoles();
    this.leaderSeat = this.settings.mode === "experience"
      ? 1
      : Math.floor(this.random() * this.settings.playerCount) + 1;
    this.phase = "identity";
    this.missionIndex = 0;
    this.rejectionCount = 0;
    this.winner = null;
    this.assassinationTargetId = null;
    this.resetRoundState();
    this.touch();
  }

  confirmIdentity(playerId: string): void {
    if (this.phase !== "identity") throw new RoomError("现在不是身份确认阶段", "INVALID_PHASE");
    const player = this.requirePlayer(playerId);
    if (player.identityConfirmed) return;
    player.identityConfirmed = true;
    if (this.settings.mode === "experience") {
      this.players.filter((candidate) => candidate.isSimulated).forEach((candidate) => {
        candidate.identityConfirmed = true;
      });
    }
    if (this.players.every((candidate) => candidate.identityConfirmed)) {
      this.phase = "team-building";
      this.prepareTeamBuilding();
    }
    this.touch();
  }

  updateTeamDraft(playerId: string, playerIds: string[]): void {
    const uniqueIds = this.validateTeamSelection(playerId, playerIds, false);
    this.draftTeam = uniqueIds;
    this.touch();
  }

  toggleTeamDraft(playerId: string, targetPlayerId: string): void {
    const next = this.draftTeam.includes(targetPlayerId)
      ? this.draftTeam.filter((id) => id !== targetPlayerId)
      : [...this.draftTeam, targetPlayerId];
    this.draftTeam = this.validateTeamSelection(playerId, next, false);
    this.touch();
  }

  proposeTeam(playerId: string, playerIds: string[]): void {
    const uniqueIds = this.validateTeamSelection(playerId, playerIds, true);
    if (this.settings.mode === "experience") {
      const humanPlayerIds = this.players.filter((candidate) => !candidate.isSimulated).map((candidate) => candidate.id);
      if (!humanPlayerIds.every((id) => uniqueIds.includes(id))) {
        throw new RoomError("流程体验需要把两位真人都加入任务队伍", "EXPERIENCE_HUMANS_REQUIRED");
      }
    }
    this.draftTeam = uniqueIds;
    this.proposedTeam = uniqueIds;
    if (this.settings.rejectionRule === "fifth-auto" && this.rejectionCount === 4) {
      this.rejectionCount = 0;
      this.phase = "quest-voting";
      this.submitExperienceVotes();
    } else {
      this.phase = "team-voting";
    }
    this.touch();
  }

  private validateTeamSelection(playerId: string, playerIds: string[], requireFull: boolean): string[] {
    if (this.phase !== "team-building") throw new RoomError("现在不能选择任务队伍", "INVALID_PHASE");
    const leader = this.requirePlayer(playerId);
    if (leader.seat !== this.leaderSeat) throw new RoomError("只有当前队长可以组队", "LEADER_ONLY", 403);
    const uniqueIds = [...new Set(playerIds)];
    if (uniqueIds.length !== playerIds.length) throw new RoomError("任务队伍不能重复选择同一名玩家", "DUPLICATE_TEAM_MEMBER");
    const requiredSize = this.missions[this.missionIndex].teamSize;
    if (requireFull && uniqueIds.length !== requiredSize) throw new RoomError(`本轮必须选择 ${requiredSize} 人`, "WRONG_TEAM_SIZE");
    if (!requireFull && uniqueIds.length > requiredSize) throw new RoomError(`本轮最多选择 ${requiredSize} 人`, "WRONG_TEAM_SIZE");
    uniqueIds.forEach((id) => this.requirePlayer(id));
    return uniqueIds;
  }

  recordPublicVote(playerId: string, rejectCount: number): boolean {
    if (this.phase !== "team-voting") throw new RoomError("现在不是公开表决阶段", "INVALID_PHASE");
    if (!this.canRecordPublicVote(playerId)) throw new RoomError("只有本轮队长可以记录结果，模拟队长由房主代为记录", "PUBLIC_VOTE_RECORDER_ONLY", 403);
    if (!Number.isInteger(rejectCount) || rejectCount < 0 || rejectCount > this.settings.playerCount) {
      throw new RoomError("反对人数无效", "INVALID_REJECT_COUNT");
    }
    const approved = teamIsApproved(rejectCount, this.settings.playerCount);
    if (approved) {
      this.rejectionCount = 0;
      this.questVotes = {};
      this.phase = "quest-voting";
      this.submitExperienceVotes();
    } else {
      this.rejectionCount += 1;
      if (this.settings.rejectionRule === "evil-wins" && this.rejectionCount >= 5) {
        this.finish("evil");
      } else {
        this.leaderSeat = this.nextLeaderSeat();
        this.resetRoundState();
        this.phase = "team-building";
        this.prepareTeamBuilding();
      }
    }
    this.touch();
    return approved;
  }

  submitQuestVote(playerId: string, vote: MissionOutcome): QuestRevealSchedule | null {
    if (this.phase !== "quest-voting") throw new RoomError("现在不是任务投票阶段", "INVALID_PHASE");
    const player = this.requirePlayer(playerId);
    if (!this.proposedTeam.includes(playerId)) throw new RoomError("你不在本轮任务队伍中", "NOT_ON_QUEST", 403);
    if (this.questVotes[playerId]) throw new RoomError("任务票已经提交", "ALREADY_SUBMITTED", 409);
    if (player.role === null) throw new RoomError("身份尚未分配", "ROLE_MISSING");
    if (factionForRole(player.role) === "good" && vote === "failure") {
      throw new RoomError("正义方只能提交任务成功", "ILLEGAL_QUEST_VOTE", 403);
    }
    this.questVotes[playerId] = vote;
    let schedule: QuestRevealSchedule | null = null;
    if (Object.keys(this.questVotes).length === this.proposedTeam.length) {
      this.phase = "quest-ready";
      schedule = this.beginSimulatedQuestRevealIfNeeded();
    }
    this.touch();
    return schedule;
  }

  private submitExperienceVotes(): void {
    if (this.settings.mode !== "experience" || this.phase !== "quest-voting") return;
    for (const player of this.players) {
      if (player.isSimulated && this.proposedTeam.includes(player.id)) this.questVotes[player.id] = "success";
    }
  }

  private prepareTeamBuilding(): void {
    if (this.phase !== "team-building") return;
    if (this.settings.mode !== "experience") {
      this.draftTeam = [];
      return;
    }
    const humanPlayers = this.players.filter((candidate) => !candidate.isSimulated);
    this.draftTeam = humanPlayers.map((candidate) => candidate.id);
    const leader = this.players.find((candidate) => candidate.seat === this.leaderSeat);
    if (!leader?.isSimulated) return;
    const requiredSize = this.missions[this.missionIndex].teamSize;
    const simulatedPlayers = this.players.filter((candidate) => candidate.isSimulated);
    const team = [...humanPlayers, ...simulatedPlayers].slice(0, requiredSize).map((candidate) => candidate.id);
    this.proposeTeam(leader.id, team);
  }

  private beginSimulatedQuestRevealIfNeeded(): QuestRevealSchedule | null {
    if (this.settings.mode !== "experience" || this.phase !== "quest-ready") return null;
    const leader = this.players.find((candidate) => candidate.seat === this.leaderSeat);
    return leader?.isSimulated ? this.startQuestReveal() : null;
  }

  beginQuestReveal(playerId: string): QuestRevealSchedule {
    if (this.phase !== "quest-ready") throw new RoomError("任务票尚未全部封存或已经开始揭晓", "INVALID_PHASE");
    const player = this.requirePlayer(playerId);
    if (player.seat !== this.leaderSeat) throw new RoomError("只有本轮队长可以确认揭晓", "LEADER_ONLY", 403);
    const schedule = this.startQuestReveal();
    this.touch();
    return schedule;
  }

  private startQuestReveal(): QuestRevealSchedule {
    this.phase = "quest-revealing";
    this.questRevealEndsAt = this.now() + QUEST_REVEAL_DURATION_MS;
    return {
      missionIndex: this.missionIndex,
      durationMs: QUEST_REVEAL_DURATION_MS,
      endsAt: this.questRevealEndsAt,
    };
  }

  completeQuestReveal(missionIndex: number): boolean {
    if (this.phase !== "quest-revealing" || this.missionIndex !== missionIndex) return false;
    this.resolveQuest();
    this.touch();
    return true;
  }

  private resolveQuest(): void {
    const ballots = shuffle(Object.values(this.questVotes), this.random);
    const failCount = ballots.filter((vote) => vote === "failure").length;
    const mission = this.missions[this.missionIndex];
    const outcome = questOutcome(failCount, mission.requiresTwoFails);
    mission.outcome = outcome;
    mission.failCount = failCount;
    mission.teamPlayerIds = [...this.proposedTeam];
    this.lastQuestResult = { outcome, failCount, ballots };
    this.questRevealEndsAt = null;
    this.phase = "quest-result";
  }

  continueAfterQuest(playerId: string): void {
    if (this.phase !== "quest-result") throw new RoomError("现在不能进入下一轮", "INVALID_PHASE");
    if (!this.canControlPublicFlow(playerId)) throw new RoomError("只有房主或当前队长可以继续", "CONTROL_ONLY", 403);
    const successes = this.missions.filter((candidate) => candidate.outcome === "success").length;
    const failures = this.missions.filter((candidate) => candidate.outcome === "failure").length;
    if (failures >= 3) {
      this.finish("evil");
    } else if (successes >= 3) {
      this.phase = "assassination";
    } else {
      this.leaderSeat = this.nextLeaderSeat();
      this.missionIndex += 1;
      this.resetRoundState();
      this.phase = "team-building";
      this.prepareTeamBuilding();
    }
    this.touch();
  }

  selectAssassinationTarget(playerId: string, targetPlayerId: string): void {
    if (this.phase !== "assassination") throw new RoomError("现在不是刺杀阶段", "INVALID_PHASE");
    const assassin = this.requirePlayer(playerId);
    if (assassin.role !== "assassin") throw new RoomError("只有刺客可以确认目标", "ASSASSIN_ONLY", 403);
    if (targetPlayerId === playerId) throw new RoomError("刺客不能选择自己", "INVALID_TARGET");
    const target = this.requirePlayer(targetPlayerId);
    this.assassinationTargetId = target.id;
    this.finish(target.role === "merlin" ? "evil" : "good");
    this.touch();
  }

  rematch(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase !== "complete") throw new RoomError("只能在游戏结束后重开", "INVALID_PHASE");
    if (!this.players.every((player) => player.connected)) throw new RoomError("需要所有玩家在线后才能重开", "PLAYERS_DISCONNECTED");
    this.players.forEach((player) => {
      player.ready = true;
      player.identityConfirmed = false;
    });
    this.missions = getMissionConfig(this.settings.playerCount).map((config, index) => ({
      number: index + 1,
      ...config,
      outcome: null,
      failCount: null,
      teamPlayerIds: [],
    }));
    this.assignRoles();
    this.leaderSeat = this.settings.mode === "experience"
      ? 1
      : Math.floor(this.random() * this.settings.playerCount) + 1;
    this.missionIndex = 0;
    this.rejectionCount = 0;
    this.winner = null;
    this.assassinationTargetId = null;
    this.resetRoundState();
    this.phase = "identity";
    this.touch();
  }

  publicState(): PublicRoomState {
    return {
      code: this.code,
      name: this.name,
      settings: this.settings,
      phase: this.phase,
      players: this.players
        .map(({ id, nickname, seat, isHost, isSimulated, ready, connected, identityConfirmed }) => ({
          id,
          nickname,
          seat,
          isHost,
          isSimulated,
          ready,
          connected,
          identityConfirmed,
        }))
        .sort((a, b) => a.seat - b.seat),
      leaderSeat: this.leaderSeat,
      missionIndex: this.missionIndex,
      missions: this.missions.map((mission) => ({ ...mission, teamPlayerIds: [...mission.teamPlayerIds] })),
      rejectionCount: this.rejectionCount,
      draftTeam: [...this.draftTeam],
      proposedTeam: [...this.proposedTeam],
      questRevealEndsAt: this.questRevealEndsAt,
      lastQuestResult: this.lastQuestResult
        ? { ...this.lastQuestResult, ballots: [...this.lastQuestResult.ballots] }
        : null,
      winner: this.winner,
      assassinationTargetId: this.assassinationTargetId,
      revealedRoles:
        this.phase === "complete"
          ? this.players.map((player) => ({
              playerId: player.id,
              role: player.role!,
              faction: factionForRole(player.role!),
            }))
          : [],
      serverTime: this.now(),
      version: this.version,
    };
  }

  privateState(playerId: string): PrivatePlayerState {
    const player = this.requirePlayer(playerId);
    const role = this.phase === "lobby" ? null : player.role;
    const faction = role ? factionForRole(role) : null;
    const knowledgeSource = this.players
      .filter((candidate): candidate is PlayerRecord & { role: Role } => candidate.role !== null)
      .map(({ id, nickname, seat, role: candidateRole }) => ({ id, nickname, seat, role: candidateRole }));
    return {
      playerId,
      role,
      faction,
      knownPlayers: role ? knownPlayersFor(playerId, role, knowledgeSource) : [],
      canConfirmIdentity: this.phase === "identity" && !player.identityConfirmed,
      canProposeTeam: this.phase === "team-building" && player.seat === this.leaderSeat,
      canRecordPublicVote:
        this.phase === "team-voting" && this.canRecordPublicVote(playerId),
      canSubmitQuest:
        this.phase === "quest-voting" && this.proposedTeam.includes(playerId) && !this.questVotes[playerId],
      questVoteSubmitted: Boolean(this.questVotes[playerId]),
      canRevealQuest: this.phase === "quest-ready" && player.seat === this.leaderSeat,
      canContinueAfterQuest: this.phase === "quest-result" && this.canControlPublicFlow(playerId),
      canAssassinate: this.phase === "assassination" && player.role === "assassin",
      canRematch: this.phase === "complete" && player.isHost,
    };
  }

  snapshotFor(playerId: string | null): SessionSnapshot {
    return {
      public: this.publicState(),
      private: playerId ? this.privateState(playerId) : null,
    };
  }
}
