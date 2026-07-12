import type { CSSProperties } from "react";
import type { PublicPlayer } from "@shared/contracts";

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
  showStatus?: boolean;
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
  showStatus = true,
  label = "圆桌座位",
}: RoundTableProps) {
  const playerPositions: Record<number, Array<{ left: number; top: number }>> = {
    5: [
      { left: 50, top: 12 },
      { left: 78.5, top: 44 },
      { left: 72, top: 94 },
      { left: 28, top: 94 },
      { left: 21.5, top: 44 },
    ],
    6: [
      { left: 50, top: 10 },
      { left: 78.5, top: 31 },
      { left: 78.5, top: 69 },
      { left: 50, top: 93 },
      { left: 21.5, top: 69 },
      { left: 21.5, top: 31 },
    ],
    7: [
      { left: 50, top: 10 },
      { left: 77, top: 29 },
      { left: 80, top: 57 },
      { left: 72, top: 92 },
      { left: 28, top: 92 },
      { left: 20, top: 57 },
      { left: 23, top: 29 },
    ],
  };

  return (
    <div
      className="round-table"
      role="group"
      aria-label={label}
      data-player-count={playerCount}
      data-variant={variant}
      data-layout={variant === "player" && playerCount >= 8 ? "dense" : "radial"}
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
        const configuredPosition = variant === "player" ? playerPositions[playerCount]?.[seat - 1] : undefined;
        const fallbackOrbit = variant === "board" ? { radiusX: 43, radiusY: 34 } : { radiusX: 38, radiusY: 38 };
        const style = {
          "--seat-left": `${configuredPosition?.left ?? (50 + Math.cos(angle) * fallbackOrbit.radiusX).toFixed(3)}%`,
          "--seat-top": `${configuredPosition?.top ?? (50 + Math.sin(angle) * fallbackOrbit.radiusY).toFixed(3)}%`,
        } as CSSProperties;
        const nickname = player?.nickname ?? "空位";
        const nameLength = Array.from(nickname).length;
        const status = player && showStatus
          ? player.connected
            ? player.isSimulated ? "模拟" : null
            : "离线"
          : null;
        const content = (
          <>
            <span className={`seat__number-badge ${isLeader ? "seat__number-badge--leader" : ""}`}>
              <span className="seat__number">{seat}</span>
            </span>
            <span className="seat__copy">
              <span className={`seat__name ${nameLength > 8 ? "seat__name--long" : nameLength > 5 ? "seat__name--medium" : ""}`}>{nickname}</span>
              {(isLeader || isCurrent || status) && (
                <span className="seat__meta" aria-hidden="true">
                  {isLeader && <span className="seat__leader">队长</span>}
                  {isCurrent && <span className="seat__current">我</span>}
                  {status && <span className={`seat__status ${status === "离线" ? "seat__status--offline" : ""}`}>{status}</span>}
                </span>
              )}
            </span>
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
            data-seat={seat}
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
            data-seat={seat}
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
