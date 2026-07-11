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
    socket.on("connect_error", (error) => setState((current) => ({ ...current, connected: false, error: error.message })));
    socket.on("room:error", (error) => setState((current) => ({ ...current, error })));
    socket.on("room:public", (publicState) => setState((current) => ({ ...current, publicState })));
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
        const ack = (result: ApiResult<T>) => {
          if (result.ok) {
            setState((current) => ({ ...current, error: null }));
            resolve(result.data);
          } else {
            setState((current) => ({ ...current, error: result.error }));
            reject(new Error(result.error));
          }
        };
        (socket.emit as (...emitArgs: unknown[]) => void)(event, ...args, ack);
      }),
    [],
  );

  const clearError = useCallback(() => setState((current) => ({ ...current, error: null })), []);
  return { ...state, command, clearError };
}
