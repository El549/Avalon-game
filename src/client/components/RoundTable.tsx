import type { CSSProperties } from "react";
import type { PublicPlayer } from "@shared/contracts";
import { CrownIcon } from "../icons";

interface RoundTableProps {
  players: PublicPlayer[];
  playerCount: number;
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
  selectedIds = [],
  selectedSeats = [],
  currentPlayerId,
  leaderSeat,
  onToggle,
  onEmptySeatSelect,
  disabled = false,
  label = "圆桌座位",
}: RoundTableProps) {
  return (
    <div className="round-table" role="group" aria-label={label}>
      <div className="round-table__wood" aria-hidden="true">
        <RoundTableCenter />
      </div>
      {Array.from({ length: playerCount }, (_, index) => index + 1).map((seat) => {
        const player = players.find((candidate) => candidate.seat === seat);
        const selected = player ? selectedIds.includes(player.id) : selectedSeats.includes(seat);
        const isCurrent = player?.id === currentPlayerId;
        const isLeader = seat === leaderSeat;
        const style = { "--seat-angle": `${(seat - 1) * (360 / playerCount) - 90}deg` } as CSSProperties;
        const content = (
          <>
            {isLeader && <CrownIcon className="seat__crown" />}
            <span className="seat__number">{seat}</span>
            <span className="seat__name">{player?.nickname ?? "空位"}</span>
            {player?.isSimulated && <span className="seat__simulated">模拟</span>}
            {player && !player.connected && <span className="seat__offline">离线</span>}
          </>
        );
        return (onToggle && player) || (onEmptySeatSelect && !player) ? (
          <button
            type="button"
            key={seat}
            className={`seat ${selected ? "seat--selected" : ""} ${isCurrent ? "seat--current" : ""}`}
            style={style}
            onClick={() => player ? onToggle?.(player.id) : onEmptySeatSelect?.(seat)}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${seat}号 ${player?.nickname ?? "空位"}${selected ? "，已选中" : ""}`}
          >
            {content}
          </button>
        ) : (
          <div
            key={seat}
            className={`seat ${selected ? "seat--selected" : ""} ${isCurrent ? "seat--current" : ""}`}
            style={style}
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
