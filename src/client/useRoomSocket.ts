import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ApiResult,
  ClientToServerEvents,
  PrivatePlayerState,
  PublicRoomState,
  ServerToClientEvents,
  SessionCredentials,
} from "@shared/contracts";

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RoomSocketState {
  publicState: PublicRoomState | null;
  privateState: PrivatePlayerState | null;
  connected: boolean;
  error: string | null;
  closedNotice: "dissolved" | "unavailable" | "removed" | "session-invalid" | null;
}

export function useRoomSocket(
  roomCode: string,
  mode: "player" | "board",
  credentials?: SessionCredentials | null,
) {
  const socketRef = useRef<RoomSocket | null>(null);
  const [state, setState] = useState<RoomSocketState>({
    publicState: null,
    privateState: null,
    connected: false,
    error: null,
    closedNotice: null,
  });

  useEffect(() => {
    const socket: RoomSocket = io({
      auth: { roomCode, mode, token: credentials?.token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
    });
    socketRef.current = socket;
    socket.on("connect", () => setState((current) => ({ ...current, connected: true, error: null })));
    socket.on("disconnect", () => setState((current) => ({ ...current, connected: false })));
    socket.on("connect_error", (error) => {
      const code = (error as Error & { data?: { code?: string } }).data?.code;
      setState((current) => ({
        ...current,
        connected: false,
        error: error.message,
        closedNotice:
          code === "ROOM_NOT_FOUND"
            ? "unavailable"
            : code === "INVALID_SESSION"
              ? "session-invalid"
              : current.closedNotice,
      }));
    });
    socket.on("room:error", (error) => setState((current) => ({ ...current, error })));
    socket.on("room:closed", () => setState((current) => ({ ...current, closedNotice: "dissolved" })));
    socket.on("player:removed", () => setState((current) => ({ ...current, closedNotice: "removed" })));
    socket.on("room:public", (publicState) => setState((current) => (
      current.publicState && current.publicState.version > publicState.version
        ? current
        : { ...current, publicState }
    )));
    socket.on("player:private", (privateState) => setState((current) => ({ ...current, privateState })));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, mode, credentials?.token]);

  const command = useCallback(
    <T,>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          reject(new Error("连接已断开，正在重试"));
          return;
        }
        let settled = false;
        const finish = (result: ApiResult<T> | null, fallbackError?: string) => {
          if (settled) return;
          settled = true;
          socket.off("disconnect", onDisconnect);
          if (!result) {
            const message = fallbackError ?? "操作未确认，请检查当前页面后重试";
            setState((current) => ({ ...current, error: message }));
            reject(new Error(message));
            return;
          }
          if (result.ok) {
            setState((current) => ({ ...current, error: null }));
            resolve(result.data);
          } else {
            setState((current) => ({ ...current, error: result.error }));
            reject(new Error(result.error));
          }
        };
        const onDisconnect = () => finish(null, "连接中断，请确认当前状态后重试");
        socket.once("disconnect", onDisconnect);
        const timedSocket = socket.timeout(5_000);
        const ack = (timeoutError: Error | null, result?: ApiResult<T>) => {
          finish(timeoutError ? null : result ?? null);
        };
        try {
          (timedSocket.emit as (...emitArgs: unknown[]) => void)(event, ...args, ack);
        } catch {
          finish(null);
        }
      }),
    [],
  );

  const clearError = useCallback(() => setState((current) => ({ ...current, error: null })), []);
  return { ...state, command, clearError };
}
