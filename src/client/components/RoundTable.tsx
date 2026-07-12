import type { CSSProperties } from "react";
import type { PublicPlayer } from "@shared/contracts";
import { CrownIcon } from "../icons";

interface RoundTableProps {
  players: PublicPlayer[];
  playerCount: number;
  variant?: "player" | "board";
  selectedIds?: string[];
  selectedSeats?: number[];
  currentPlayerId?: string;
  leaderSeat?: number | null;
  onToggle?: (playerId: string) => void;
  onEmptySeatSelect?: (seat: number) => void;
  disabled?: boolean;
  label?: string;
}

export function RoundTable({
  players,
  playerCount,
  variant = "player",
  selectedIds = [],
  selectedSeats = [],
  currentPlayerId,
  leaderSeat,
  onToggle,
  onEmptySeatSelect,
  disabled = false,
  label = "圆桌座位",
}: RoundTableProps) {
  const playerOrbits: Record<number, { radiusX: number; radiusY: number }> = {
    5: { radiusX: 38, radiusY: 38 },
    6: { radiusX: 42, radiusY: 39 },
    7: { radiusX: 39, radiusY: 40 },
    8: { radiusX: 41, radiusY: 40 },
    9: { radiusX: 39.5, radiusY: 41 },
    10: { radiusX: 41, radiusY: 41.5 },
  };
  const orbit = variant === "board"
    ? { radiusX: 43, radiusY: 34 }
    : playerOrbits[playerCount] ?? { radiusX: 38, radiusY: 38 };

  return (
    <div
      className="round-table"
      role="group"
      aria-label={label}
      data-player-count={playerCount}
      data-variant={variant}
    >
      <div className="round-table__wood" aria-hidden="true">
        <RoundTableCenter />
      </div>
      <span className="round-table__diamond round-table__diamond--top" aria-hidden="true" />
      <span className="round-table__diamond round-table__diamond--right" aria-hidden="true" />
      <span className="round-table__diamond round-table__diamond--bottom" aria-hidden="true" />
      <span className="round-table__diamond round-table__diamond--left" aria-hidden="true" />
      {Array.from({ length: playerCount }, (_, index) => index + 1).map((seat) => {
        const player = players.find((candidate) => candidate.seat === seat);
        const selected = player ? selectedIds.includes(player.id) : selectedSeats.includes(seat);
        const isCurrent = player?.id === currentPlayerId;
        const isLeader = seat === leaderSeat;
        const angle = ((seat - 1) * (Math.PI * 2)) / playerCount - Math.PI / 2;
        const style = {
          "--seat-left": `${(50 + Math.cos(angle) * orbit.radiusX).toFixed(3)}%`,
          "--seat-top": `${(50 + Math.sin(angle) * orbit.radiusY).toFixed(3)}%`,
        } as CSSProperties;
        const nickname = player?.nickname ?? "空位";
        const nameLength = Array.from(nickname).length;
        const content = (
          <>
            <span className={`seat__number-badge ${isLeader ? "seat__number-badge--leader" : ""}`}>
              <span className="seat__number">{seat}</span>
            </span>
            <span className={`seat__name ${nameLength > 8 ? "seat__name--long" : nameLength > 5 ? "seat__name--medium" : ""}`}>{nickname}</span>
            {(player?.isSimulated || (player && !player.connected)) && (
              <span className={`seat__status ${player && !player.connected ? "seat__status--offline" : ""}`}>
                {player && !player.connected ? "离线" : "模拟"}
              </span>
            )}
            {isLeader && <span className="seat__leader"><CrownIcon />队长</span>}
            {selected && <span className="seat__check" aria-hidden="true">✓</span>}
          </>
        );
        return (onToggle && player) || (onEmptySeatSelect && !player) ? (
          <button
            type="button"
            key={seat}
            className={`seat ${selected ? "seat--selected" : ""} ${isCurrent ? "seat--current" : ""} ${isLeader ? "seat--leader" : ""}`}
            style={style}
            onClick={() => player ? onToggle?.(player.id) : onEmptySeatSelect?.(seat)}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${seat}号 ${nickname}${isCurrent ? "，我的座位" : ""}${selected ? "，已选中" : ""}`}
          >
            {content}
          </button>
        ) : (
          <div
            key={seat}
            className={`seat ${selected ? "seat--selected" : ""} ${isCurrent ? "seat--current" : ""} ${isLeader ? "seat--leader" : ""}`}
            style={style}
            role="group"
            aria-label={`${seat}号 ${nickname}${isCurrent ? "，我的座位" : ""}${selected ? "，已选中" : ""}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function RoundTableCenter() {
  return (
    <svg className="round-table__sigil" viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="34" stroke="currentColor" />
      <circle cx="50" cy="50" r="22" stroke="currentColor" opacity=".55" />
      <path d="M50 12v76M12 50h76M23 23l54 54M77 23 23 77" stroke="currentColor" opacity=".35" />
      <path d="m39 55 4-19 7 10 7-10 4 19-11 7-11-7Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
