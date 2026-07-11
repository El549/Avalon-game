import { createServer, type Server as HttpServer } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { Server as SocketServer, type Socket } from "socket.io";
import { z } from "zod";
import type {
  ApiResult,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SessionCredentials,
  SessionSnapshot,
  SocketData,
} from "@shared/contracts";
import { RoomError } from "./room";
import { RoomStore } from "./store";

const nicknameSchema = z.string().trim().min(1, "请输入昵称").max(12, "昵称最多 12 个字");
const roomCodeSchema = z.string().regex(/^\d{6}$/, "房间号应为 6 位数字");
const createRoomSchema = z.object({
  nickname: nicknameSchema,
  playerCount: z.number().int().min(5).max(10),
  rolePreset: z.enum(["classic", "advanced"]),
  rejectionRule: z.enum(["evil-wins", "fifth-auto"]),
});
const joinRoomSchema = z.object({
  nickname: nicknameSchema,
  seat: z.number().int().min(1).max(10),
});

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

function normalizeRoomCode(value: string): string {
  return value.replace(/\s/g, "");
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof RoomError) return { ok: false, error: error.message, code: error.code };
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "输入内容无效", code: "VALIDATION" };
  return { ok: false, error: "操作失败，请稍后重试", code: "INTERNAL" };
}

function acknowledge<T>(ack: unknown, result: ApiResult<T>): void {
  if (typeof ack === "function") {
    (ack as (value: ApiResult<T>) => void)(result);
  }
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof RoomError) {
    res.status(error.status).json(failure(error));
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json(failure(error));
    return;
  }
  console.error(error);
  res.status(500).json(failure(error));
}

export interface ServerApplication {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  store: RoomStore;
}

export function createServerApplication(store = new RoomStore()): ServerApplication {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    transports: ["websocket", "polling"],
  });
  const activePlayerSockets = new Map<string, string>();
  const questRevealTimers = new Map<string, ReturnType<typeof setTimeout>>();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "round-table-assistant" });
  });

  app.post("/api/rooms", (req, res) => {
    try {
      const input = createRoomSchema.parse(req.body);
      const { room, credentials } = store.createRoom(input.nickname, {
        playerCount: input.playerCount,
        rolePreset: input.rolePreset,
        rejectionRule: input.rejectionRule,
        mode: "standard",
      });
      res.status(201).json(ok<{ credentials: SessionCredentials; snapshot: SessionSnapshot }>({
        credentials,
        snapshot: room.snapshotFor(credentials.playerId),
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/rooms/experience", (req, res) => {
    try {
      const input = z.object({ nickname: nicknameSchema }).parse(req.body);
      const { room, credentials } = store.createExperienceRoom(input.nickname);
      res.status(201).json(ok<{ credentials: SessionCredentials; snapshot: SessionSnapshot }>({
        credentials,
        snapshot: room.snapshotFor(credentials.playerId),
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/rooms/:code/join", (req, res) => {
    try {
      const code = roomCodeSchema.parse(normalizeRoomCode(req.params.code));
      const input = joinRoomSchema.parse(req.body);
      const credentials = store.joinRoom(code, input.nickname, input.seat);
      const room = store.getRoom(code);
      res.status(201).json(ok<{ credentials: SessionCredentials; snapshot: SessionSnapshot }>({
        credentials,
        snapshot: room.snapshotFor(credentials.playerId),
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/rooms/:code/public", (req, res) => {
    try {
      const code = roomCodeSchema.parse(normalizeRoomCode(req.params.code));
      res.json(ok(store.getRoom(code).publicState()));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/rooms/:code/session", (req, res) => {
    try {
      const code = roomCodeSchema.parse(normalizeRoomCode(req.params.code));
      const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) throw new RoomError("缺少身份凭证", "INVALID_SESSION", 401);
      const room = store.getRoom(code);
      const player = room.authenticate(token);
      res.json(ok(room.snapshotFor(player.id)));
    } catch (error) {
      sendError(res, error);
    }
  });

  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth as Partial<SocketData>;
      const roomCode = roomCodeSchema.parse(normalizeRoomCode(String(auth.roomCode ?? "")));
      const mode = auth.mode === "board" ? "board" : "player";
      const room = store.getRoom(roomCode);
      if (mode === "board") {
        socket.data = { roomCode, playerId: null, token: null, mode };
      } else {
        const token = String(auth.token ?? "");
        const player = room.authenticate(token);
        socket.data = { roomCode, playerId: player.id, token, mode };
      }
      next();
    } catch (error) {
      const result = failure(error);
      const connectionError = new Error(result.error) as Error & { data?: { code?: string } };
      connectionError.data = { code: result.code };
      next(connectionError);
    }
  });

  async function broadcastRoom(roomCode: string): Promise<void> {
    const room = store.findRoom(roomCode);
    if (!room) return;
    const sockets = await io.in(roomCode).fetchSockets();
    for (const socket of sockets) {
      socket.emit("room:public", room.publicState());
      if (socket.data.playerId && room.hasPlayer(socket.data.playerId)) {
        socket.emit("player:private", room.privateState(socket.data.playerId));
      }
    }
  }

  function clearQuestRevealTimer(roomCode: string): void {
    const current = questRevealTimers.get(roomCode);
    if (current) clearTimeout(current);
    questRevealTimers.delete(roomCode);
  }

  function scheduleQuestReveal(roomCode: string, missionIndex: number, durationMs: number): void {
    clearQuestRevealTimer(roomCode);
    const timer = setTimeout(() => {
      questRevealTimers.delete(roomCode);
      const room = store.findRoom(roomCode);
      if (room?.completeQuestReveal(missionIndex)) void broadcastRoom(roomCode);
    }, durationMs);
    timer.unref();
    questRevealTimers.set(roomCode, timer);
  }

  function handleCommand<T>(
    socket: TypedSocket,
    action: () => T,
    ack: unknown,
  ): void {
    try {
      const data = action();
      acknowledge(ack, ok(data));
      void broadcastRoom(socket.data.roomCode);
    } catch (error) {
      const result = failure(error) as ApiResult<T>;
      acknowledge(ack, result);
      if (!result.ok) socket.emit("room:error", result.error);
    }
  }

  io.on("connection", (socket) => {
    const { roomCode, playerId } = socket.data;
    const room = store.getRoom(roomCode);
    socket.join(roomCode);

    if (playerId) {
      const activeKey = `${roomCode}:${playerId}`;
      const previousSocketId = activePlayerSockets.get(activeKey);
      if (previousSocketId && previousSocketId !== socket.id) io.sockets.sockets.get(previousSocketId)?.disconnect(true);
      activePlayerSockets.set(activeKey, socket.id);
      room.setConnected(playerId, true);
    }
    void broadcastRoom(roomCode);

    socket.on("player:ready", (ready, ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).setReady(playerId!, ready), ack);
    });
    socket.on("player:seat", (seat, ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).changeSeat(playerId!, seat), ack);
    });
    socket.on("player:leave", (ack) => {
      try {
        if (!playerId) throw new RoomError("公共屏不能离开座位", "PLAYER_ONLY", 403);
        store.getRoom(roomCode).leave(playerId);
        activePlayerSockets.delete(`${roomCode}:${playerId}`);
        socket.leave(roomCode);
        acknowledge(ack, ok(undefined));
        void broadcastRoom(roomCode);
      } catch (error) {
        const result = failure(error) as ApiResult<void>;
        acknowledge(ack, result);
        if (!result.ok) socket.emit("room:error", result.error);
      }
    });
    socket.on("room:dissolve", (ack) => {
      try {
        if (!playerId) throw new RoomError("公共屏不能解散桌局", "PLAYER_ONLY", 403);
        store.dissolveRoom(roomCode, playerId);
        clearQuestRevealTimer(roomCode);
        for (const key of activePlayerSockets.keys()) {
          if (key.startsWith(`${roomCode}:`)) activePlayerSockets.delete(key);
        }
        acknowledge(ack, ok(undefined));
        io.to(roomCode).emit("room:closed", { reason: "dissolved", message: "房主已解散桌局" });
      } catch (error) {
        const result = failure(error) as ApiResult<void>;
        acknowledge(ack, result);
        if (!result.ok) socket.emit("room:error", result.error);
      }
    });
    socket.on("game:start", (ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).startGame(playerId!), ack);
    });
    socket.on("identity:confirm", (ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).confirmIdentity(playerId!), ack);
    });
    socket.on("team:draft-toggle", (targetPlayerId, ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).toggleTeamDraft(playerId!, targetPlayerId), ack);
    });
    socket.on("team:draft", (playerIds, ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).updateTeamDraft(playerId!, playerIds), ack);
    });
    socket.on("team:propose", (playerIds, ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).proposeTeam(playerId!, playerIds), ack);
    });
    socket.on("team-vote:record", (rejectCount, ack) => {
      handleCommand(socket, () => ({ approved: store.getRoom(roomCode).recordPublicVote(playerId!, rejectCount) }), ack);
    });
    socket.on("quest:submit", (vote, ack) => {
      handleCommand(socket, () => {
        const schedule = store.getRoom(roomCode).submitQuestVote(playerId!, vote);
        if (schedule) scheduleQuestReveal(roomCode, schedule.missionIndex, schedule.durationMs);
      }, ack);
    });
    socket.on("quest:reveal", (ack) => {
      handleCommand(socket, () => {
        const schedule = store.getRoom(roomCode).beginQuestReveal(playerId!);
        scheduleQuestReveal(roomCode, schedule.missionIndex, schedule.durationMs);
        return { durationMs: schedule.durationMs };
      }, ack);
    });
    socket.on("quest:continue", (ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).continueAfterQuest(playerId!), ack);
    });
    socket.on("assassination:select", (targetPlayerId, ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).selectAssassinationTarget(playerId!, targetPlayerId), ack);
    });
    socket.on("game:rematch", (ack) => {
      handleCommand(socket, () => store.getRoom(roomCode).rematch(playerId!), ack);
    });
    socket.on("host:remove-player", (targetPlayerId, ack) => {
      try {
        if (!playerId) throw new RoomError("公共屏不能管理玩家", "PLAYER_ONLY", 403);
        store.getRoom(roomCode).removePlayer(playerId, targetPlayerId);
        const targetKey = `${roomCode}:${targetPlayerId}`;
        const targetSocketId = activePlayerSockets.get(targetKey);
        activePlayerSockets.delete(targetKey);
        const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
        targetSocket?.emit("player:removed", { message: "房主已将你移出桌局" });
        if (targetSocket) {
          const disconnectTimer = setTimeout(() => targetSocket.disconnect(true), 50);
          disconnectTimer.unref();
        }
        acknowledge(ack, ok(undefined));
        void broadcastRoom(roomCode);
      } catch (error) {
        const result = failure(error) as ApiResult<void>;
        acknowledge(ack, result);
        if (!result.ok) socket.emit("room:error", result.error);
      }
    });
    socket.on("host:reset-game", (ack) => {
      handleCommand(socket, () => {
        store.getRoom(roomCode).resetToLobby(playerId!);
        clearQuestRevealTimer(roomCode);
      }, ack);
    });

    socket.on("disconnect", () => {
      if (!playerId) return;
      const activeKey = `${roomCode}:${playerId}`;
      if (activePlayerSockets.get(activeKey) !== socket.id) return;
      activePlayerSockets.delete(activeKey);
      const currentRoom = store.findRoom(roomCode);
      if (!currentRoom?.hasPlayer(playerId)) return;
      currentRoom.setConnected(playerId, false);
      void broadcastRoom(roomCode);
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, error);
  });

  return { app, httpServer, io, store };
}
