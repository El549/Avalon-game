import { describe, expect, it } from "vitest";
import { RoomError } from "@server/room";
import { RoomStore } from "@server/store";

const settings = { playerCount: 5, rolePreset: "classic" as const, rejectionRule: "evil-wins" as const, mode: "standard" as const };

describe("房间存续", () => {
  it("清理超过有效期且没有活动的房间", () => {
    let now = 1_000;
    const store = new RoomStore(100, () => 0.123456, () => now);
    const { room } = store.createRoom("房主", settings);
    expect(store.getRoom(room.code)).toBe(room);
    now += 101;
    store.cleanup();
    expect(() => store.getRoom(room.code)).toThrow("房间不存在或已经过期");
  });

  it("房间号连续冲突时明确拒绝而不是覆盖旧桌局", () => {
    const store = new RoomStore(10_000, () => 0.5, () => 1_000);
    const first = store.createRoom("甲", settings);
    expect(() => store.createRoom("乙", settings)).toThrow(RoomError);
    expect(store.getRoom(first.room.code)).toBe(first.room);
  });

  it("房主可以解散等候中的房间，非房主不能解散", () => {
    const store = new RoomStore(10_000, () => 0.3, () => 1_000);
    const created = store.createRoom("房主", settings);
    const guest = store.joinRoom(created.room.code, "玩家2", 2);
    expect(() => store.dissolveRoom(created.room.code, guest.playerId)).toThrow("只有房主");
    expect(store.getRoom(created.room.code)).toBe(created.room);
    store.dissolveRoom(created.room.code, created.credentials.playerId);
    expect(store.findRoom(created.room.code)).toBeNull();
    expect(() => store.getRoom(created.room.code)).toThrow("房间不存在或已经过期");
  });

  it("体验房间只留下 2 号真人座位并补齐三名模拟玩家", () => {
    const store = new RoomStore(10_000, () => 0.4, () => 1_000);
    const { room } = store.createExperienceRoom("第一台手机");
    expect(room.publicState()).toMatchObject({
      settings: { mode: "experience", playerCount: 5 },
      players: [
        { seat: 1, isSimulated: false },
        { seat: 3, isSimulated: true },
        { seat: 4, isSimulated: true },
        { seat: 5, isSimulated: true },
      ],
    });
  });
});
