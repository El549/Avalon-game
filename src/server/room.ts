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
  private proposedTeam: string[] = [];
  private voteCountdownEndsAt: number | null = null;
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
  }

  get lastUpdatedAt(): number {
    return this.updatedAt;
  }

  get playerCount(): number {
    return this.players.length;
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

  private nextLeaderSeat(): number {
    if (this.leaderSeat === null) return 1;
    return (this.leaderSeat % this.settings.playerCount) + 1;
  }

  private resetRoundState(): void {
    this.proposedTeam = [];
    this.voteCountdownEndsAt = null;
    this.questVotes = {};
    this.lastQuestResult = null;
  }

  private assignRoles(): void {
    const roles = shuffle(createRoleDeck(this.settings.playerCount, this.settings.rolePreset), this.random);
    const seatedPlayers = [...this.players].sort((a, b) => a.seat - b.seat);
    seatedPlayers.forEach((player, index) => {
      player.role = roles[index];
      player.identityConfirmed = false;
    });
  }

  private finish(winner: Winner): void {
    this.winner = winner;
    this.phase = "complete";
    this.voteCountdownEndsAt = null;
  }

  addPlayer(nickname: string, seat: number, isHost = false): SessionCredentials {
    if (this.phase !== "lobby") throw new RoomError("游戏已经开始，不能加入", "GAME_STARTED", 409);
    if (this.players.length >= this.settings.playerCount) throw new RoomError("房间已经坐满", "ROOM_FULL", 409);
    if (!Number.isInteger(seat) || seat < 1 || seat > this.settings.playerCount) {
      throw new RoomError("座位号无效", "INVALID_SEAT");
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

  startGame(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase !== "lobby") throw new RoomError("游戏已经开始", "INVALID_PHASE");
    if (this.players.length !== this.settings.playerCount) throw new RoomError("需要所有座位坐满后才能开始", "ROOM_NOT_FULL");
    if (!this.players.every((player) => player.ready && player.connected)) {
      throw new RoomError("需要所有玩家在线并准备", "PLAYERS_NOT_READY");
    }
    this.assignRoles();
    this.leaderSeat = Math.floor(this.random() * this.settings.playerCount) + 1;
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
    if (this.players.every((candidate) => candidate.identityConfirmed)) this.phase = "team-building";
    this.touch();
  }

  proposeTeam(playerId: string, playerIds: string[]): void {
    if (this.phase !== "team-building") throw new RoomError("现在不能提交任务队伍", "INVALID_PHASE");
    const leader = this.requirePlayer(playerId);
    if (leader.seat !== this.leaderSeat) throw new RoomError("只有当前队长可以组队", "LEADER_ONLY", 403);
    const requiredSize = this.missions[this.missionIndex].teamSize;
    const uniqueIds = [...new Set(playerIds)];
    if (uniqueIds.length !== requiredSize) throw new RoomError(`本轮必须选择 ${requiredSize} 人`, "WRONG_TEAM_SIZE");
    uniqueIds.forEach((id) => this.requirePlayer(id));
    this.proposedTeam = uniqueIds;
    this.voteCountdownEndsAt = null;
    if (this.settings.rejectionRule === "fifth-auto" && this.rejectionCount === 4) {
      this.rejectionCount = 0;
      this.phase = "quest-voting";
    } else {
      this.phase = "team-voting";
    }
    this.touch();
  }

  startPublicVote(playerId: string): number {
    if (this.phase !== "team-voting") throw new RoomError("现在不是公开表决阶段", "INVALID_PHASE");
    if (!this.canControlPublicFlow(playerId)) throw new RoomError("只有房主或当前队长可以开始表决", "CONTROL_ONLY", 403);
    if (this.voteCountdownEndsAt && this.voteCountdownEndsAt > this.now()) return this.voteCountdownEndsAt;
    this.voteCountdownEndsAt = this.now() + 3_200;
    this.touch();
    return this.voteCountdownEndsAt;
  }

  recordPublicVote(playerId: string, rejectCount: number): boolean {
    if (this.phase !== "team-voting") throw new RoomError("现在不是公开表决阶段", "INVALID_PHASE");
    if (!this.canControlPublicFlow(playerId)) throw new RoomError("只有房主或当前队长可以记录结果", "CONTROL_ONLY", 403);
    if (!this.voteCountdownEndsAt) throw new RoomError("请先进行同时亮票倒计时", "COUNTDOWN_REQUIRED");
    if (this.now() < this.voteCountdownEndsAt) throw new RoomError("请等待倒计时结束", "COUNTDOWN_RUNNING");
    const approved = teamIsApproved(rejectCount, this.settings.playerCount);
    this.voteCountdownEndsAt = null;
    if (approved) {
      this.rejectionCount = 0;
      this.questVotes = {};
      this.phase = "quest-voting";
    } else {
      this.rejectionCount += 1;
      if (this.settings.rejectionRule === "evil-wins" && this.rejectionCount >= 5) {
        this.finish("evil");
      } else {
        this.leaderSeat = this.nextLeaderSeat();
        this.proposedTeam = [];
        this.phase = "team-building";
      }
    }
    this.touch();
    return approved;
  }

  submitQuestVote(playerId: string, vote: MissionOutcome): void {
    if (this.phase !== "quest-voting") throw new RoomError("现在不是任务投票阶段", "INVALID_PHASE");
    const player = this.requirePlayer(playerId);
    if (!this.proposedTeam.includes(playerId)) throw new RoomError("你不在本轮任务队伍中", "NOT_ON_QUEST", 403);
    if (this.questVotes[playerId]) throw new RoomError("任务票已经提交", "ALREADY_SUBMITTED", 409);
    if (player.role === null) throw new RoomError("身份尚未分配", "ROLE_MISSING");
    if (factionForRole(player.role) === "good" && vote === "failure") {
      throw new RoomError("正义方只能提交任务成功", "ILLEGAL_QUEST_VOTE", 403);
    }
    this.questVotes[playerId] = vote;
    if (Object.keys(this.questVotes).length === this.proposedTeam.length) this.resolveQuest();
    this.touch();
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
    this.leaderSeat = Math.floor(this.random() * this.settings.playerCount) + 1;
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
        .map(({ id, nickname, seat, isHost, ready, connected, identityConfirmed }) => ({
          id,
          nickname,
          seat,
          isHost,
          ready,
          connected,
          identityConfirmed,
        }))
        .sort((a, b) => a.seat - b.seat),
      leaderSeat: this.leaderSeat,
      missionIndex: this.missionIndex,
      missions: this.missions.map((mission) => ({ ...mission, teamPlayerIds: [...mission.teamPlayerIds] })),
      rejectionCount: this.rejectionCount,
      proposedTeam: [...this.proposedTeam],
      voteCountdownEndsAt: this.voteCountdownEndsAt,
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
      canStartPublicVote:
        this.phase === "team-voting" && this.canControlPublicFlow(playerId) && !this.voteCountdownEndsAt,
      canRecordPublicVote:
        this.phase === "team-voting" && this.canControlPublicFlow(playerId) && this.voteCountdownEndsAt !== null,
      canSubmitQuest:
        this.phase === "quest-voting" && this.proposedTeam.includes(playerId) && !this.questVotes[playerId],
      questVoteSubmitted: Boolean(this.questVotes[playerId]),
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
