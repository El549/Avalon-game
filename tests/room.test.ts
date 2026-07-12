import { describe, expect, it } from "vitest";
import type { MissionOutcome, SessionCredentials } from "@shared/contracts";
import { GameRoom, RoomError } from "@server/room";

function createReadyRoom(playerCount = 7, rejectionRule: "evil-wins" | "fifth-auto" = "evil-wins") {
  const now = 1_000;
  let randomIndex = 0;
  const randomValues = [0.12, 0.74, 0.31, 0.92, 0.46, 0.68, 0.27, 0.55, 0.83, 0.09];
  const room = new GameRoom(
    "123456",
    "测试圆桌",
    { playerCount, rolePreset: "advanced", rejectionRule, mode: "standard" },
    "玩家1",
    { random: () => randomValues[randomIndex++ % randomValues.length], now: () => now },
  );
  const credentials: SessionCredentials[] = [room.initialHostCredentials()];
  for (let seat = 2; seat <= playerCount; seat += 1) credentials.push(room.addPlayer(`玩家${seat}`, seat));
  for (const session of credentials) {
    room.setConnected(session.playerId, true);
    room.setReady(session.playerId, true);
  }
  room.startGame(credentials[0].playerId);
  for (const session of credentials) room.confirmIdentity(session.playerId);
  return { room, credentials };
}

function leaderId(room: GameRoom): string {
  const state = room.publicState();
  return state.players.find((player) => player.seat === state.leaderSeat)!.id;
}

function proposeCurrentTeam(room: GameRoom): string[] {
  const state = room.publicState();
  const teamSize = state.missions[state.missionIndex].teamSize;
  const team = state.players.slice(0, teamSize).map((player) => player.id);
  room.proposeTeam(leaderId(room), team);
  return team;
}

function approveTeam(room: GameRoom): string[] {
  const team = proposeCurrentTeam(room);
  expect(room.recordPublicVote(leaderId(room), 0)).toBe(true);
  return team;
}

function submitTeamVotes(room: GameRoom, team: string[], voteFor: (playerId: string) => MissionOutcome = () => "success") {
  for (const playerId of team) room.submitQuestVote(playerId, voteFor(playerId));
}

function revealQuest(room: GameRoom): void {
  let state = room.publicState();
  if (state.phase === "quest-ready") room.beginQuestReveal(leaderId(room));
  state = room.publicState();
  expect(state.phase).toBe("quest-revealing");
  expect(state.lastQuestResult).toBeNull();
  expect(room.completeQuestReveal(state.missionIndex)).toBe(true);
  expect(room.publicState().phase).toBe("quest-result");
}

function runMissionWithFailures(room: GameRoom, failCount: number): void {
  const state = room.publicState();
  const teamSize = state.missions[state.missionIndex].teamSize;
  const evil = state.players.filter((player) => room.privateState(player.id).faction === "evil");
  const selected = [
    ...evil.slice(0, failCount),
    ...state.players.filter((player) => !evil.slice(0, failCount).some((chosen) => chosen.id === player.id)),
  ].slice(0, teamSize);
  room.proposeTeam(leaderId(room), selected.map((player) => player.id));
  room.recordPublicVote(leaderId(room), 0);
  const failureVoters = new Set(evil.slice(0, failCount).map((player) => player.id));
  submitTeamVotes(room, selected.map((player) => player.id), (playerId) => failureVoters.has(playerId) ? "failure" : "success");
  revealQuest(room);
}

describe("房间主流程", () => {
  it("开局前可以换到空座位，换座后需要重新准备", () => {
    const room = new GameRoom("123456", "测试圆桌", { playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins", mode: "standard" }, "房主");
    const host = room.initialHostCredentials();
    const guest = room.addPlayer("阿乔", 2);
    room.setReady(guest.playerId, true);
    room.changeSeat(guest.playerId, 4);
    expect(room.publicState().players.find((player) => player.id === guest.playerId)).toMatchObject({ seat: 4, ready: false });
    expect(() => room.changeSeat(host.playerId, 4)).toThrow("这个座位已经有人");
    expect(() => room.changeSeat(host.playerId, 8)).toThrow("座位号无效");
  });

  it("开局前普通玩家可以离开并释放座位，房主只能解散", () => {
    const room = new GameRoom("123456", "测试圆桌", { playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins", mode: "standard" }, "房主");
    const host = room.initialHostCredentials();
    const guest = room.addPlayer("阿乔", 2);
    room.leave(guest.playerId);
    expect(room.publicState().players.map((player) => player.nickname)).toEqual(["房主"]);
    expect(() => room.authenticate(guest.token)).toThrow("身份凭证无效");
    expect(() => room.leave(host.playerId)).toThrow("房主需要解散桌局");
    expect(() => room.assertCanDissolve(guest.playerId)).toThrow("找不到这名玩家");
    expect(() => room.assertCanDissolve(room.addPlayer("新玩家", 2).playerId)).toThrow("只有房主");
    expect(() => room.assertCanDissolve(host.playerId)).not.toThrow();
  });

  it("房主可以在候场移出玩家，但普通玩家不能管理座位", () => {
    const room = new GameRoom("123456", "测试圆桌", { playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins", mode: "standard" }, "房主");
    const host = room.initialHostCredentials();
    const guest = room.addPlayer("阿乔", 2);
    const other = room.addPlayer("林深", 3);
    expect(() => room.removePlayer(guest.playerId, other.playerId)).toThrow("只有房主");
    expect(() => room.removePlayer(host.playerId, host.playerId)).toThrow("房主不能移出自己");
    room.removePlayer(host.playerId, guest.playerId);
    expect(room.publicState().players.map((player) => player.seat)).toEqual([1, 3]);
    expect(() => room.authenticate(guest.token)).toThrow("身份凭证无效");
  });

  it("游戏开始后不能直接离开或解散", () => {
    const { room, credentials } = createReadyRoom();
    expect(() => room.leave(credentials[1].playerId)).toThrow("游戏开始后不能直接离开");
    expect(() => room.assertCanDissolve(credentials[0].playerId)).toThrow("游戏开始后不能直接解散");
  });

  it("房主可以安全结束本局回到候场并保留座位", () => {
    const { room, credentials } = createReadyRoom();
    expect(() => room.resetToLobby(credentials[1].playerId)).toThrow("只有房主");
    room.resetToLobby(credentials[0].playerId);
    expect(room.publicState()).toMatchObject({ phase: "lobby", leaderSeat: null, missionIndex: 0, draftTeam: [], proposedTeam: [] });
    expect(room.publicState().players.every((player) => !player.ready && !player.identityConfirmed)).toBe(true);
    expect(room.privateState(credentials[0].playerId)).toMatchObject({ role: null, faction: null });
  });

  it("开局前不向公共状态泄露身份", () => {
    const { room, credentials } = createReadyRoom();
    const publicState = room.publicState();
    expect(publicState.revealedRoles).toEqual([]);
    for (const player of publicState.players) {
      expect(player).not.toHaveProperty("role");
      expect(player).not.toHaveProperty("faction");
    }
    const ownState = room.privateState(credentials[0].playerId);
    expect(ownState.role).not.toBeNull();
    expect(room.publicState().phase).toBe("team-building");
  });

  it("阻止非队长组队和错误人数", () => {
    const { room, credentials } = createReadyRoom();
    const state = room.publicState();
    const nonLeader = credentials.find((session) => session.playerId !== leaderId(room))!;
    expect(() => room.proposeTeam(nonLeader.playerId, state.players.slice(0, 2).map((player) => player.id))).toThrow(RoomError);
    expect(() => room.proposeTeam(leaderId(room), [state.players[0].id])).toThrow("本轮必须选择 2 人");
  });

  it("队长选择草稿会实时公开，确认前不切换阶段", () => {
    const { room, credentials } = createReadyRoom();
    const state = room.publicState();
    const leader = leaderId(room);
    const nonLeader = credentials.find((session) => session.playerId !== leader)!;
    room.toggleTeamDraft(leader, state.players[0].id);
    expect(room.publicState()).toMatchObject({ phase: "team-building", draftTeam: [state.players[0].id], proposedTeam: [] });
    expect(() => room.toggleTeamDraft(nonLeader.playerId, state.players[1].id)).toThrow("只有当前队长");
    room.toggleTeamDraft(leader, state.players[1].id);
    expect(room.publicState().draftTeam).toEqual([state.players[0].id, state.players[1].id]);
    expect(() => room.toggleTeamDraft(leader, state.players[2].id)).toThrow("最多选择 2 人");
    room.toggleTeamDraft(leader, state.players[1].id);
    expect(room.publicState().draftTeam).toEqual([state.players[0].id]);
    expect(() => room.updateTeamDraft(leader, state.players.slice(0, 3).map((player) => player.id))).toThrow("最多选择 2 人");
    const finalTeam = state.players.slice(0, 2).map((player) => player.id);
    room.updateTeamDraft(leader, finalTeam);
    room.proposeTeam(leader, finalTeam);
    expect(room.publicState()).toMatchObject({ phase: "team-voting", draftTeam: finalTeam, proposedTeam: finalTeam });
  });

  it("进入现场举手表决后可以立即记录结果", () => {
    const { room } = createReadyRoom();
    proposeCurrentTeam(room);
    expect(room.recordPublicVote(leaderId(room), 0)).toBe(true);
  });

  it("真人队长是现场表决的唯一记录人，房主不会获得重复入口", () => {
    const { room, credentials } = createReadyRoom();
    while (leaderId(room) === credentials[0].playerId) {
      proposeCurrentTeam(room);
      expect(room.recordPublicVote(leaderId(room), 4)).toBe(false);
    }
    const team = proposeCurrentTeam(room);
    const leader = leaderId(room);
    const outsider = credentials.find((session) => session.playerId !== leader && session.playerId !== credentials[0].playerId)!;
    expect(room.privateState(credentials[0].playerId).canRecordPublicVote).toBe(false);
    expect(room.privateState(leader).canRecordPublicVote).toBe(true);
    expect(() => room.recordPublicVote(credentials[0].playerId, 0)).toThrow("只有本轮队长");
    expect(() => room.recordPublicVote(outsider.playerId, 0)).toThrow("只有本轮队长");
    expect(() => room.recordPublicVote(leader, 8)).toThrow("反对人数无效");
    room.recordPublicVote(leader, 0);
    const nonMember = credentials.find((session) => !team.includes(session.playerId))!;
    expect(() => room.submitQuestVote(nonMember.playerId, "success")).toThrow("你不在本轮任务队伍中");
  });

  it("正义方不能提交失败票，也不能重复提交", () => {
    const { room } = createReadyRoom();
    const team = approveTeam(room);
    const goodPlayer = team.find((id) => room.privateState(id).faction === "good")!;
    expect(room.publicState().questSubmittedCount).toBe(0);
    expect(() => room.submitQuestVote(goodPlayer, "failure")).toThrow("正义方只能提交任务成功");
    room.submitQuestVote(goodPlayer, "success");
    expect(room.publicState().questSubmittedCount).toBe(1);
    expect(JSON.stringify(room.publicState())).not.toContain("questVotes");
    expect(() => room.submitQuestVote(goodPlayer, "success")).toThrow("已经提交");
  });

  it("最后一票后仍隐藏结果，只有本轮队长能开始三秒揭晓", () => {
    const { room, credentials } = createReadyRoom();
    const team = approveTeam(room);
    submitTeamVotes(room, team);
    expect(room.publicState()).toMatchObject({ phase: "quest-ready", lastQuestResult: null, questRevealEndsAt: null });
    const leader = leaderId(room);
    const nonLeader = credentials.find((session) => session.playerId !== leader)!;
    expect(() => room.beginQuestReveal(nonLeader.playerId)).toThrow("只有本轮队长");
    const schedule = room.beginQuestReveal(leader);
    expect(schedule.durationMs).toBe(3_000);
    expect(room.publicState()).toMatchObject({ phase: "quest-revealing", lastQuestResult: null, questRevealEndsAt: schedule.endsAt });
    expect(() => room.beginQuestReveal(leader)).toThrow("已经开始揭晓");
    expect(room.completeQuestReveal(schedule.missionIndex + 1)).toBe(false);
    expect(room.completeQuestReveal(schedule.missionIndex)).toBe(true);
    expect(room.publicState()).toMatchObject({ phase: "quest-result", questRevealEndsAt: null });
  });

  it("完成三次成功任务后进入刺杀，刺中梅林则邪恶获胜", () => {
    const { room, credentials } = createReadyRoom();
    const hostId = credentials[0].playerId;
    for (let mission = 0; mission < 3; mission += 1) {
      const team = approveTeam(room);
      submitTeamVotes(room, team);
      expect(room.publicState()).toMatchObject({ phase: "quest-ready", lastQuestResult: null });
      revealQuest(room);
      room.continueAfterQuest(hostId);
    }
    expect(room.publicState().phase).toBe("assassination");
    const assassin = credentials.find((session) => room.privateState(session.playerId).role === "assassin")!;
    const merlin = credentials.find((session) => room.privateState(session.playerId).role === "merlin")!;
    room.selectAssassinationTarget(assassin.playerId, merlin.playerId);
    expect(room.publicState().winner).toBe("evil");
    expect(room.publicState().revealedRoles).toHaveLength(7);
  });

  it("刺错目标时正义获胜", () => {
    const { room, credentials } = createReadyRoom();
    const hostId = credentials[0].playerId;
    for (let mission = 0; mission < 3; mission += 1) {
      const team = approveTeam(room);
      submitTeamVotes(room, team);
      revealQuest(room);
      room.continueAfterQuest(hostId);
    }
    const assassin = credentials.find((session) => room.privateState(session.playerId).role === "assassin")!;
    const nonMerlin = credentials.find((session) => session.playerId !== assassin.playerId && room.privateState(session.playerId).role !== "merlin")!;
    room.selectAssassinationTarget(assassin.playerId, nonMerlin.playerId);
    expect(room.publicState().winner).toBe("good");
  });

  it("连续五次否决后邪恶方获胜", () => {
    const { room } = createReadyRoom(7, "evil-wins");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      proposeCurrentTeam(room);
      room.recordPublicVote(leaderId(room), 4);
    }
    expect(room.publicState()).toMatchObject({ phase: "complete", winner: "evil", rejectionCount: 5 });
  });

  it("第五队强制出发模式跳过第五次公开表决", () => {
    const { room } = createReadyRoom(7, "fifth-auto");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      proposeCurrentTeam(room);
      room.recordPublicVote(leaderId(room), 4);
    }
    proposeCurrentTeam(room);
    expect(room.publicState().phase).toBe("quest-voting");
    expect(room.publicState().rejectionCount).toBe(0);
  });

  it("七人局第四轮一张失败票仍成功，两张才失败", () => {
    const first = createReadyRoom(7);
    const firstHost = first.credentials[0].playerId;
    for (const fails of [0, 1, 1]) {
      runMissionWithFailures(first.room, fails);
      first.room.continueAfterQuest(firstHost);
    }
    runMissionWithFailures(first.room, 1);
    expect(first.room.publicState().missions[3]).toMatchObject({ requiresTwoFails: true, outcome: "success", failCount: 1 });

    const second = createReadyRoom(7);
    const secondHost = second.credentials[0].playerId;
    for (const fails of [0, 0, 1]) {
      runMissionWithFailures(second.room, fails);
      second.room.continueAfterQuest(secondHost);
    }
    runMissionWithFailures(second.room, 2);
    expect(second.room.publicState().missions[3]).toMatchObject({ requiresTwoFails: true, outcome: "failure", failCount: 2 });
  });

  it("掉线后状态保留，重连恢复同一个身份", () => {
    const { room, credentials } = createReadyRoom();
    const session = credentials[3];
    const role = room.privateState(session.playerId).role;
    room.setConnected(session.playerId, false);
    expect(room.publicState().players.find((player) => player.id === session.playerId)?.connected).toBe(false);
    const authenticated = room.authenticate(session.token);
    room.setConnected(authenticated.id, true);
    expect(room.privateState(session.playerId).role).toBe(role);
  });

  it("游戏结束后可以保留座位并重新分配身份", () => {
    const { room, credentials } = createReadyRoom();
    const hostId = credentials[0].playerId;
    for (let mission = 0; mission < 3; mission += 1) {
      const team = approveTeam(room);
      const evilOnTeam = team.find((id) => room.privateState(id).faction === "evil");
      submitTeamVotes(room, team, (id) => id === evilOnTeam ? "failure" : "success");
      revealQuest(room);
      room.continueAfterQuest(hostId);
    }
    expect(room.publicState().winner).toBe("evil");
    room.rematch(hostId);
    expect(room.publicState().phase).toBe("identity");
    expect(room.publicState().missions.every((mission) => mission.outcome === null)).toBe(true);
    expect(room.publicState().players.map((player) => player.seat)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("有人离线时不会误触重开", () => {
    const { room, credentials } = createReadyRoom();
    const hostId = credentials[0].playerId;
    for (let mission = 0; mission < 3; mission += 1) {
      runMissionWithFailures(room, 1);
      room.continueAfterQuest(hostId);
    }
    expect(room.publicState().phase).toBe("complete");
    room.setConnected(credentials[2].playerId, false);
    expect(() => room.rematch(hostId)).toThrow("需要所有玩家在线");
  });

  it("两台手机和模拟玩家可以走完整流程体验", () => {
    let now = 1_000;
    const room = new GameRoom(
      "123456",
      "体验圆桌",
      { playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins", mode: "experience" },
      "第一台手机",
      { random: () => 0.2, now: () => now },
    );
    const host = room.initialHostCredentials();
    expect(room.publicState().players).toMatchObject([
      { seat: 1, nickname: "第一台手机", isSimulated: false, ready: false },
      { seat: 3, isSimulated: true, ready: true, connected: true },
      { seat: 4, isSimulated: true, ready: true, connected: true },
      { seat: 5, isSimulated: true, ready: true, connected: true },
    ]);
    expect(() => room.addPlayer("错误座位", 4)).toThrow();
    const second = room.addPlayer("第二台手机", 2);
    for (const credentials of [host, second]) {
      room.setConnected(credentials.playerId, true);
      room.setReady(credentials.playerId, true);
    }
    room.startGame(host.playerId);
    expect(room.privateState(host.playerId).role).toBe("merlin");
    expect(room.privateState(second.playerId).role).toBe("assassin");
    room.confirmIdentity(host.playerId);
    expect(room.publicState().phase).toBe("identity");
    expect(room.publicState().players.filter((player) => player.isSimulated).every((player) => player.identityConfirmed)).toBe(true);
    room.confirmIdentity(second.playerId);

    const humanIds = [host.playerId, second.playerId];
    for (let mission = 0; mission < 3; mission += 1) {
      const state = room.publicState();
      if (state.phase === "team-building") {
        expect(state.draftTeam).toEqual(expect.arrayContaining(humanIds));
        const requiredSize = state.missions[state.missionIndex].teamSize;
        const simulatedIds = state.players.filter((player) => player.isSimulated).map((player) => player.id);
        const team = [...humanIds, ...simulatedIds].slice(0, requiredSize);
        const invalidTeam = [host.playerId, ...simulatedIds].slice(0, requiredSize);
        expect(() => room.proposeTeam(leaderId(room), invalidTeam)).toThrow("两位真人");
        room.proposeTeam(leaderId(room), team);
      }
      const voting = room.publicState();
      expect(voting.phase).toBe("team-voting");
      expect(voting.proposedTeam).toEqual(expect.arrayContaining(humanIds));
      const recorder = voting.leaderSeat === 2 ? second : host;
      const otherHuman = recorder.playerId === host.playerId ? second : host;
      expect(room.privateState(recorder.playerId).canRecordPublicVote).toBe(true);
      expect(room.privateState(otherHuman.playerId).canRecordPublicVote).toBe(false);
      expect(() => room.recordPublicVote(otherHuman.playerId, 0)).toThrow("只有本轮队长");
      room.recordPublicVote(recorder.playerId, 0);
      room.submitQuestVote(host.playerId, "success");
      expect(room.publicState().phase).toBe("quest-voting");
      room.submitQuestVote(second.playerId, "success");
      if (mission === 2) expect(room.publicState().phase).toBe("quest-revealing");
      else expect(room.publicState().phase).toBe("quest-ready");
      now += 3_000;
      revealQuest(room);
      room.continueAfterQuest(host.playerId);
    }

    expect(room.publicState().phase).toBe("assassination");
    room.selectAssassinationTarget(second.playerId, host.playerId);
    expect(room.publicState()).toMatchObject({ phase: "complete", winner: "evil" });
  });
});
