import type { ApiResult, PublicRoomState, SessionCredentials, SessionSnapshot } from "@shared/contracts";

interface RoomSessionResponse {
  credentials: SessionCredentials;
  snapshot: SessionSnapshot;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const result = (await response.json()) as ApiResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function createRoom(input: {
  nickname: string;
  playerCount: number;
  rolePreset: "classic" | "advanced";
  rejectionRule: "evil-wins" | "fifth-auto";
}): Promise<RoomSessionResponse> {
  return request("/api/rooms", { method: "POST", body: JSON.stringify(input) });
}

export function joinRoom(code: string, input: { nickname: string; seat: number }): Promise<RoomSessionResponse> {
  return request(`/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify(input) });
}

export function getPublicRoom(code: string): Promise<PublicRoomState> {
  return request(`/api/rooms/${code}/public`);
}

export function getSession(credentials: SessionCredentials): Promise<SessionSnapshot> {
  return request(`/api/rooms/${credentials.roomCode}/session`, {
    headers: { authorization: `Bearer ${credentials.token}` },
  });
}
