import { describe, expect, it } from "vitest";
import {
  createRoleDeck,
  factionForRole,
  getMissionConfig,
  knownPlayersFor,
  questOutcome,
  shuffle,
  teamIsApproved,
} from "@shared/rules";

describe("阿瓦隆规则", () => {
  it.each([
    [5, 3, 2], [6, 4, 2], [7, 4, 3], [8, 5, 3], [9, 6, 3], [10, 6, 4],
  ])("%i 人角色数量正确", (count, good, evil) => {
    const roles = createRoleDeck(count, "advanced");
    expect(roles).toHaveLength(count);
    expect(roles.filter((role) => factionForRole(role) === "good")).toHaveLength(good);
    expect(roles.filter((role) => factionForRole(role) === "evil")).toHaveLength(evil);
    expect(roles).toContain("merlin");
    expect(roles).toContain("assassin");
  });

  it("进阶十人局包含莫德雷德和奥伯伦", () => {
    expect(createRoleDeck(10, "advanced")).toEqual(expect.arrayContaining(["mordred", "oberon"]));
    expect(createRoleDeck(10, "classic")).not.toContain("mordred");
  });

  it("拒绝非法人数", () => {
    expect(() => createRoleDeck(4, "classic")).toThrow();
    expect(() => getMissionConfig(11)).toThrow();
  });

  it("所有人数的任务队伍和双失败轮次正确", () => {
    expect(getMissionConfig(5).map((mission) => mission.teamSize)).toEqual([2, 3, 2, 3, 3]);
    expect(getMissionConfig(6).map((mission) => mission.teamSize)).toEqual([2, 3, 4, 3, 4]);
    expect(getMissionConfig(7).map((mission) => mission.teamSize)).toEqual([2, 3, 3, 4, 4]);
    expect(getMissionConfig(10)[3]).toEqual({ teamSize: 5, requiresTwoFails: true });
    expect(getMissionConfig(6)[3].requiresTwoFails).toBe(false);
  });

  it("梅林、派西维尔和邪恶方看到正确的人", () => {
    const players = [
      { id: "1", nickname: "梅林", seat: 1, role: "merlin" as const },
      { id: "2", nickname: "派西维尔", seat: 2, role: "percival" as const },
      { id: "3", nickname: "刺客", seat: 3, role: "assassin" as const },
      { id: "4", nickname: "莫甘娜", seat: 4, role: "morgana" as const },
      { id: "5", nickname: "莫德雷德", seat: 5, role: "mordred" as const },
      { id: "6", nickname: "奥伯伦", seat: 6, role: "oberon" as const },
    ];
    expect(knownPlayersFor("1", "merlin", players).map((player) => player.playerId)).toEqual(["3", "4", "6"]);
    expect(knownPlayersFor("2", "percival", players).map((player) => player.playerId)).toEqual(["1", "4"]);
    expect(knownPlayersFor("3", "assassin", players).map((player) => player.playerId)).toEqual(["4", "5"]);
    expect(knownPlayersFor("6", "oberon", players)).toEqual([]);
  });

  it("公开表决平票否决", () => {
    expect(teamIsApproved(2, 5)).toBe(true);
    expect(teamIsApproved(3, 5)).toBe(false);
    expect(teamIsApproved(2, 6)).toBe(true);
    expect(teamIsApproved(3, 6)).toBe(false);
    expect(() => teamIsApproved(8, 7)).toThrow();
  });

  it("双失败任务只在两张失败票时失败", () => {
    expect(questOutcome(1, false)).toBe("failure");
    expect(questOutcome(1, true)).toBe("success");
    expect(questOutcome(2, true)).toBe("failure");
  });

  it("洗牌不修改原数组", () => {
    const source = [1, 2, 3, 4];
    const result = shuffle(source, () => 0);
    expect(source).toEqual([1, 2, 3, 4]);
    expect(result).toEqual([2, 3, 4, 1]);
  });
});
