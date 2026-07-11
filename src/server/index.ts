import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServerApplication } from "./app";
import { RoomStore } from "./store";

const port = Number(process.env.PORT ?? 4173);
const configuredTtlHours = Number(process.env.ROOM_TTL_HOURS ?? 24);
const roomTtlHours = Number.isFinite(configuredTtlHours) && configuredTtlHours > 0 ? configuredTtlHours : 24;
const isProduction = process.env.NODE_ENV === "production";
const { app, httpServer } = createServerApplication(new RoomStore(roomTtlHours * 60 * 60 * 1_000));

if (isProduction) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(root, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/socket.io/")) {
      next();
      return;
    }
    res.sendFile(path.join(root, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`圆桌助手已启动：http://localhost:${port}`);
});

function shutdown(): void {
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
