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
});
