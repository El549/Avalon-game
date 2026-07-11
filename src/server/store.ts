import type { RoomSettings, SessionCredentials } from "@shared/contracts";
import { GameRoom, RoomError } from "./room";

const ROOM_NAMES = ["王城之夜", "雾中圣杯", "银月议会", "暮色圆桌", "湖畔誓约"];

export class RoomStore {
  private readonly rooms = new Map<string, GameRoom>();

  constructor(
    private readonly roomTtlMs = 24 * 60 * 60 * 1_000,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = String(Math.floor(100_000 + this.random() * 900_000));
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError("暂时无法创建房间，请稍后重试", "CODE_EXHAUSTED", 503);
  }

  createRoom(hostNickname: string, settings: RoomSettings): { room: GameRoom; credentials: SessionCredentials } {
    this.cleanup();
    const code = this.generateCode();
    const name = ROOM_NAMES[Math.floor(this.random() * ROOM_NAMES.length)];
    const room = new GameRoom(code, name, settings, hostNickname, { random: this.random, now: this.now });
    this.rooms.set(code, room);
    return { room, credentials: room.initialHostCredentials() };
  }

  createExperienceRoom(hostNickname: string): { room: GameRoom; credentials: SessionCredentials } {
    return this.createRoom(hostNickname, {
      playerCount: 5,
      rolePreset: "classic",
      rejectionRule: "evil-wins",
      mode: "experience",
    });
  }

  findRoom(code: string): GameRoom | null {
    return this.rooms.get(code) ?? null;
  }

  getRoom(code: string): GameRoom {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError("房间不存在或已经过期", "ROOM_NOT_FOUND", 404);
    return room;
  }

  joinRoom(code: string, nickname: string, seat: number): SessionCredentials {
    const room = this.getRoom(code);
    return room.addPlayer(nickname, seat);
  }

  dissolveRoom(code: string, playerId: string): void {
    const room = this.getRoom(code);
    room.assertCanDissolve(playerId);
    this.rooms.delete(code);
  }

  cleanup(): void {
    const cutoff = this.now() - this.roomTtlMs;
    for (const [code, room] of this.rooms) {
      if (room.lastUpdatedAt < cutoff) this.rooms.delete(code);
    }
  }
}
