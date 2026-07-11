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
      });
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
      next(new Error(result.error));
    }
  });

  async function broadcastRoom(roomCode: string): Promise<void> {
    const room = store.getRoom(roomCode);
    const sockets = await io.in(roomCode).fetchSockets();
    for (const socket of sockets) {
      socket.emit("room:public", room.publicState());
      if (socket.data.playerId) socket.emit("player:private", room.privateState(socket.data.playerId));
    }
  }

  function handleCommand<T>(
    socket: TypedSocket,
    action: () => T,
    ack: (result: ApiResult<T>) => void,
  ): void {
    try {
      const data = action();
      ack(ok(data));
      void broadcastRoom(socket.data.roomCode);
    } catch (error) {
      const result = failure(error) as ApiResult<T>;
      ack(result);
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
      handleCommand(socket, () => room.setReady(playerId!, ready), ack);
    });
    socket.on("player:seat", (seat, ack) => {
      handleCommand(socket, () => room.changeSeat(playerId!, seat), ack);
    });
    socket.on("game:start", (ack) => {
      handleCommand(socket, () => room.startGame(playerId!), ack);
    });
    socket.on("identity:confirm", (ack) => {
      handleCommand(socket, () => room.confirmIdentity(playerId!), ack);
    });
    socket.on("team:propose", (playerIds, ack) => {
      handleCommand(socket, () => room.proposeTeam(playerId!, playerIds), ack);
    });
    socket.on("team-vote:start", (ack) => {
      handleCommand(socket, () => ({ endsAt: room.startPublicVote(playerId!) }), ack);
    });
    socket.on("team-vote:record", (rejectCount, ack) => {
      handleCommand(socket, () => ({ approved: room.recordPublicVote(playerId!, rejectCount) }), ack);
    });
    socket.on("quest:submit", (vote, ack) => {
      handleCommand(socket, () => room.submitQuestVote(playerId!, vote), ack);
    });
    socket.on("quest:continue", (ack) => {
      handleCommand(socket, () => room.continueAfterQuest(playerId!), ack);
    });
    socket.on("assassination:select", (targetPlayerId, ack) => {
      handleCommand(socket, () => room.selectAssassinationTarget(playerId!, targetPlayerId), ack);
    });
    socket.on("game:rematch", (ack) => {
      handleCommand(socket, () => room.rematch(playerId!), ack);
    });

    socket.on("disconnect", () => {
      if (!playerId) return;
      const activeKey = `${roomCode}:${playerId}`;
      if (activePlayerSockets.get(activeKey) !== socket.id) return;
      activePlayerSockets.delete(activeKey);
      room.setConnected(playerId, false);
      void broadcastRoom(roomCode);
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, error);
  });

  return { app, httpServer, io, store };
}
