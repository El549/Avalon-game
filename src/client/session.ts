import type { SessionCredentials } from "@shared/contracts";

const PREFIX = "round-table-session:";
const LAST_SESSION_KEY = "round-table-last-session";

function isCredentials(value: unknown): value is SessionCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionCredentials>;
  return /^\d{6}$/.test(candidate.roomCode ?? "") && Boolean(candidate.playerId && candidate.token);
}

export function saveCredentials(credentials: SessionCredentials): void {
  localStorage.setItem(`${PREFIX}${credentials.roomCode}`, JSON.stringify(credentials));
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ version: 1, credentials }));
}

export function loadCredentials(roomCode: string): SessionCredentials | null {
  const value = localStorage.getItem(`${PREFIX}${roomCode}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isCredentials(parsed) || parsed.roomCode !== roomCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadLatestCredentials(): SessionCredentials | null {
  const value = localStorage.getItem(LAST_SESSION_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: number; credentials?: unknown };
    return parsed.version === 1 && isCredentials(parsed.credentials) ? parsed.credentials : null;
  } catch {
    return null;
  }
}

export function clearCredentials(roomCode: string): void {
  localStorage.removeItem(`${PREFIX}${roomCode}`);
  const latest = loadLatestCredentials();
  if (latest?.roomCode === roomCode) localStorage.removeItem(LAST_SESSION_KEY);
}
