import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { createServerApplication, type ServerApplication } from "@server/app";
import { RoomStore } from "@server/store";

let application: ServerApplication | null = null;

afterEach(() => {
  application?.io.close();
  application?.httpServer.close();
  application = null;
});

describe("房间接口与实时连接", () => {
  it("创建、加入和恢复会话", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.123456, () => 1_000));
    const created = await request(application.app).post("/api/rooms").send({
      nickname: "房主",
      playerCount: 5,
      rolePreset: "classic",
      rejectionRule: "evil-wins",
    }).expect(201);
    expect(created.body.ok).toBe(true);
    const { credentials } = created.body.data;
    const joined = await request(application.app).post(`/api/rooms/${credentials.roomCode}/join`).send({ nickname: "阿乔", seat: 2 }).expect(201);
    expect(joined.body.data.snapshot.public.players).toHaveLength(2);
    await request(application.app)
      .get(`/api/rooms/${credentials.roomCode}/session`)
      .set("authorization", `Bearer ${credentials.token}`)
      .expect(200);
    const publicResponse = await request(application.app).get(`/api/rooms/${credentials.roomCode}/public`).expect(200);
    expect(JSON.stringify(publicResponse.body)).not.toContain("token");
  });

  it("拒绝重复座位、错误凭证和不存在的房间", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.222222, () => 1_000));
    const created = await request(application.app).post("/api/rooms").send({ nickname: "房主", playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins" });
    const code = created.body.data.credentials.roomCode;
    await request(application.app).post(`/api/rooms/${code}/join`).send({ nickname: "阿乔", seat: 1 }).expect(409);
    await request(application.app).get(`/api/rooms/${code}/session`).set("authorization", "Bearer wrong").expect(401);
    await request(application.app).get("/api/rooms/999999/public").expect(404);
  });

  it("WebSocket 连接后同步准备状态", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.333333, () => 1_000));
    await new Promise<void>((resolve) => application!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = application.httpServer.address();
    if (!address || typeof address === "string") throw new Error("测试服务未启动");
    const created = await request(application.app).post("/api/rooms").send({ nickname: "房主", playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins" });
    const credentials = created.body.data.credentials;
    const socket: ClientSocket = createClient(`http://127.0.0.1:${address.port}`, {
      auth: { roomCode: credentials.roomCode, token: credentials.token, mode: "player" },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const updated = new Promise<any>((resolve) => {
      socket.on("room:public", (state) => {
        if (state.players[0]?.ready) resolve(state);
      });
    });
    const acknowledgement = await new Promise<any>((resolve) => socket.emit("player:ready", true, resolve));
    expect(acknowledgement.ok).toBe(true);
    expect((await updated).players[0].ready).toBe(true);
    socket.disconnect();
  });

  it("实时操作不带回执时仍能完成，服务保持可用", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.373737, () => 1_000));
    await new Promise<void>((resolve) => application!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = application.httpServer.address();
    if (!address || typeof address === "string") throw new Error("测试服务未启动");
    const origin = `http://127.0.0.1:${address.port}`;
    const created = await request(application.app).post("/api/rooms").send({ nickname: "房主", playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins" });
    const hostCredentials = created.body.data.credentials;
    const joined = await request(application.app).post(`/api/rooms/${hostCredentials.roomCode}/join`).send({ nickname: "玩家2", seat: 2 });
    const guestCredentials = joined.body.data.credentials;
    const connect = async (options: Record<string, unknown>) => {
      const socket = createClient(origin, { ...options, transports: ["websocket"] });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    };
    const emitWithoutAck = (socket: ClientSocket, event: string, ...args: unknown[]) => {
      (socket.emit as unknown as (...emitArgs: unknown[]) => void)(event, ...args);
    };
    const host = await connect({ auth: { roomCode: hostCredentials.roomCode, token: hostCredentials.token, mode: "player" } });
    const guest = await connect({ auth: { roomCode: hostCredentials.roomCode, token: guestCredentials.token, mode: "player" } });
    const board = await connect({ auth: { roomCode: hostCredentials.roomCode, mode: "board" } });

    const boardSawReady = new Promise<void>((resolve) => {
      board.on("room:public", (state: any) => {
        if (state.players.find((player: any) => player.id === hostCredentials.playerId)?.ready) resolve();
      });
    });
    emitWithoutAck(host, "player:ready", true);
    await boardSawReady;

    const hostError = new Promise<string>((resolve) => host.once("room:error", resolve));
    emitWithoutAck(host, "player:seat", 2);
    await expect(hostError).resolves.toBe("这个座位已经有人");

    const boardError = new Promise<string>((resolve) => board.once("room:error", resolve));
    emitWithoutAck(board, "room:dissolve");
    await expect(boardError).resolves.toBe("公共屏不能解散桌局");

    const boardSawSeatReleased = new Promise<void>((resolve) => {
      board.on("room:public", (state: any) => {
        if (state.players.length === 1) resolve();
      });
    });
    emitWithoutAck(guest, "player:leave");
    await boardSawSeatReleased;

    const boardClosed = new Promise<any>((resolve) => board.once("room:closed", resolve));
    emitWithoutAck(host, "room:dissolve");
    await expect(boardClosed).resolves.toMatchObject({ reason: "dissolved" });
    await request(origin).get("/api/health").expect(200);

    host.disconnect();
    guest.disconnect();
    board.disconnect();
  });

  it("同一身份的新连接接管旧设备，公共屏始终拿不到私密身份", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.444444, () => 1_000));
    await new Promise<void>((resolve) => application!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = application.httpServer.address();
    if (!address || typeof address === "string") throw new Error("测试服务未启动");
    const origin = `http://127.0.0.1:${address.port}`;
    const created = await request(application.app).post("/api/rooms").send({ nickname: "房主", playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins" });
    const credentials = created.body.data.credentials;
    const options = {
      auth: { roomCode: credentials.roomCode, token: credentials.token, mode: "player" },
      transports: ["websocket"] as ["websocket"],
    };
    const first = createClient(origin, options);
    await new Promise<void>((resolve, reject) => {
      first.once("connect", resolve);
      first.once("connect_error", reject);
    });
    const firstDisconnected = new Promise<void>((resolve) => first.once("disconnect", () => resolve()));
    const replacement = createClient(origin, options);
    await new Promise<void>((resolve, reject) => {
      replacement.once("connect", resolve);
      replacement.once("connect_error", reject);
    });
    await firstDisconnected;
    expect(application.store.getRoom(credentials.roomCode).publicState().players[0].connected).toBe(true);

    let privateStateReceived = false;
    const board = createClient(origin, {
      autoConnect: false,
      auth: { roomCode: credentials.roomCode, mode: "board" },
      transports: ["websocket"],
    });
    board.on("player:private", () => { privateStateReceived = true; });
    const boardPublicState = new Promise<void>((resolve) => board.once("room:public", () => resolve()));
    board.connect();
    await boardPublicState;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(privateStateReceived).toBe(false);
    const rejected = await new Promise<any>((resolve) => board.emit("player:ready", true, resolve));
    expect(rejected).toMatchObject({ ok: false });

    replacement.disconnect();
    board.disconnect();
  });

  it("普通玩家离开会释放座位，房主解散会通知玩家和公共屏", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.555555, () => 1_000));
    await new Promise<void>((resolve) => application!.httpServer.listen(0, "127.0.0.1", resolve));
    const address = application.httpServer.address();
    if (!address || typeof address === "string") throw new Error("测试服务未启动");
    const origin = `http://127.0.0.1:${address.port}`;
    const created = await request(application.app).post("/api/rooms").send({ nickname: "房主", playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins" });
    const hostCredentials = created.body.data.credentials;
    const joined = await request(application.app).post(`/api/rooms/${hostCredentials.roomCode}/join`).send({ nickname: "玩家2", seat: 2 });
    const guestCredentials = joined.body.data.credentials;
    const connect = async (options: Record<string, unknown>) => {
      const socket = createClient(origin, { ...options, transports: ["websocket"] });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    };
    const host = await connect({ auth: { roomCode: hostCredentials.roomCode, token: hostCredentials.token, mode: "player" } });
    const guest = await connect({ auth: { roomCode: hostCredentials.roomCode, token: guestCredentials.token, mode: "player" } });
    const board = await connect({ auth: { roomCode: hostCredentials.roomCode, mode: "board" } });

    const hostSawSeatReleased = new Promise<void>((resolve) => {
      host.on("room:public", (state: any) => {
        if (state.players.length === 1) resolve();
      });
    });
    const leaveResult = await new Promise<any>((resolve) => guest.emit("player:leave", resolve));
    expect(leaveResult.ok).toBe(true);
    await hostSawSeatReleased;
    await request(application.app)
      .get(`/api/rooms/${hostCredentials.roomCode}/session`)
      .set("authorization", `Bearer ${guestCredentials.token}`)
      .expect(401);
    await request(application.app)
      .post(`/api/rooms/${hostCredentials.roomCode}/join`)
      .send({ nickname: "新玩家", seat: 2 })
      .expect(201);

    const boardDissolveResult = await new Promise<any>((resolve) => board.emit("room:dissolve", resolve));
    expect(boardDissolveResult).toMatchObject({ ok: false, code: "PLAYER_ONLY" });
    const hostClosed = new Promise<any>((resolve) => host.once("room:closed", resolve));
    const boardClosed = new Promise<any>((resolve) => board.once("room:closed", resolve));
    const dissolveResult = await new Promise<any>((resolve) => host.emit("room:dissolve", resolve));
    expect(dissolveResult.ok).toBe(true);
    await expect(hostClosed).resolves.toMatchObject({ reason: "dissolved" });
    await expect(boardClosed).resolves.toMatchObject({ reason: "dissolved" });
    await request(application.app).get(`/api/rooms/${hostCredentials.roomCode}/public`).expect(404);

    host.disconnect();
    guest.disconnect();
    board.disconnect();
  });

  it("创建流程体验房间时只返回公开的模拟玩家信息", async () => {
    application = createServerApplication(new RoomStore(60_000, () => 0.666666, () => 1_000));
    const created = await request(application.app).post("/api/rooms/experience").send({ nickname: "第一台手机" }).expect(201);
    expect(created.body.data.snapshot.public).toMatchObject({
      settings: { mode: "experience", playerCount: 5 },
      players: [
        { seat: 1, isSimulated: false },
        { seat: 3, isSimulated: true },
        { seat: 4, isSimulated: true },
        { seat: 5, isSimulated: true },
      ],
    });
    expect(JSON.stringify(created.body.data.snapshot.public)).not.toContain("token");
  });
});
