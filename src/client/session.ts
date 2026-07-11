import type { SessionCredentials } from "@shared/contracts";

const PREFIX = "round-table-session:";

export function saveCredentials(credentials: SessionCredentials): void {
  localStorage.setItem(`${PREFIX}${credentials.roomCode}`, JSON.stringify(credentials));
}

export function loadCredentials(roomCode: string): SessionCredentials | null {
  const value = localStorage.getItem(`${PREFIX}${roomCode}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SessionCredentials;
    if (parsed.roomCode !== roomCode || !parsed.playerId || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCredentials(roomCode: string): void {
  localStorage.removeItem(`${PREFIX}${roomCode}`);
}
