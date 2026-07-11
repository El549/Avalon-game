import type { Faction, KnownPlayer, MissionOutcome, Role, RolePreset } from "./contracts";

export const PLAYER_COUNTS = [5, 6, 7, 8, 9, 10] as const;

const FACTION_COUNTS: Record<number, { good: number; evil: number }> = {
  5: { good: 3, evil: 2 },
  6: { good: 4, evil: 2 },
  7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 },
  9: { good: 6, evil: 3 },
  10: { good: 6, evil: 4 },
};

const MISSION_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export function isValidPlayerCount(count: number): boolean {
  return PLAYER_COUNTS.includes(count as (typeof PLAYER_COUNTS)[number]);
}

export function factionForRole(role: Role): Faction {
  return ["merlin", "percival", "loyal-servant"].includes(role) ? "good" : "evil";
}

export function getMissionConfig(playerCount: number): { teamSize: number; requiresTwoFails: boolean }[] {
  if (!isValidPlayerCount(playerCount)) throw new Error("玩家人数必须在 5 到 10 人之间");
  return MISSION_SIZES[playerCount].map((teamSize, index) => ({
    teamSize,
    requiresTwoFails: playerCount >= 7 && index === 3,
  }));
}

export function createRoleDeck(playerCount: number, preset: RolePreset): Role[] {
  if (!isValidPlayerCount(playerCount)) throw new Error("玩家人数必须在 5 到 10 人之间");
  const counts = FACTION_COUNTS[playerCount];
  const good: Role[] = ["merlin", "percival"];
  while (good.length < counts.good) good.push("loyal-servant");

  const evil: Role[] = ["assassin", "morgana"];
  if (preset === "advanced" && counts.evil >= 3) evil.push("mordred");
  if (preset === "advanced" && counts.evil >= 4) evil.push("oberon");
  while (evil.length < counts.evil) evil.push("minion");
  return [...good, ...evil];
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export interface KnowledgeSourcePlayer {
  id: string;
  nickname: string;
  seat: number;
  role: Role;
}

export function knownPlayersFor(playerId: string, role: Role, players: KnowledgeSourcePlayer[]): KnownPlayer[] {
  const select = (predicate: (candidate: KnowledgeSourcePlayer) => boolean): KnownPlayer[] =>
    players
      .filter(predicate)
      .sort((a, b) => a.seat - b.seat)
      .map(({ id: playerId, nickname, seat }) => ({ playerId, nickname, seat }));

  if (role === "merlin") {
    return select((candidate) => factionForRole(candidate.role) === "evil" && candidate.role !== "mordred");
  }
  if (role === "percival") {
    return select((candidate) => candidate.role === "merlin" || candidate.role === "morgana");
  }
  if (role === "oberon" || factionForRole(role) === "good") return [];
  return select(
    (candidate) =>
      candidate.id !== playerId && factionForRole(candidate.role) === "evil" && candidate.role !== "oberon",
  );
}

export function teamIsApproved(rejectCount: number, playerCount: number): boolean {
  if (!Number.isInteger(rejectCount) || rejectCount < 0 || rejectCount > playerCount) {
    throw new Error("反对人数无效");
  }
  return rejectCount < playerCount / 2;
}

export function questOutcome(failCount: number, requiresTwoFails: boolean): MissionOutcome {
  return failCount >= (requiresTwoFails ? 2 : 1) ? "failure" : "success";
}
