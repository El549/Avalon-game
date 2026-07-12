import type { PublicPlayer } from "@shared/contracts";

type RosterMode = "lobby" | "team" | "target" | "manage" | "join" | "reveal";

interface PlayerRosterProps {
  players: PublicPlayer[];
  playerCount: number;
  mode: RosterMode;
  selectedIds?: string[];
  selectedSeat?: number | null;
  currentPlayerId?: string;
  leaderSeat?: number | null;
  disabled?: boolean;
  disabledIds?: string[];
  onPlayerSelect?: (playerId: string) => void;
  onSeatSelect?: (seat: number) => void;
  onRemove?: (playerId: string) => void;
  removeDisabled?: boolean;
  label?: string;
}

export function PlayerRoster({
  players,
  playerCount,
  mode,
  selectedIds = [],
  selectedSeat = null,
  currentPlayerId,
  leaderSeat,
  disabled = false,
  disabledIds = [],
  onPlayerSelect,
  onSeatSelect,
  onRemove,
  removeDisabled = false,
  label = "玩家名单",
}: PlayerRosterProps) {
  return (
    <div className={`player-roster player-roster--${mode}`} role="group" aria-label={label} data-player-count={playerCount}>
      {Array.from({ length: playerCount }, (_, index) => index + 1).map((seat) => {
        const player = players.find((candidate) => candidate.seat === seat);
        const selected = player ? selectedIds.includes(player.id) : selectedSeat === seat;
        const isCurrent = player?.id === currentPlayerId;
        const isLeader = seat === leaderSeat;
        const selectable = Boolean((player && onPlayerSelect) || (!player && onSeatSelect));
        const state = mode === "lobby" || mode === "manage" ? (
          player ? <span className={player.ready ? "is-ready" : "is-not-ready"}>{player.ready ? "已准备" : "未准备"}</span> : <span>—</span>
        ) : mode === "target" ? (
          selected ? <span className="player-roster__check" aria-hidden="true">✓</span>
            : isCurrent ? <span>我</span>
              : player?.isSimulated ? <span>模拟</span>
                : null
        ) : selected ? (
          <span className="player-roster__check" aria-hidden="true">✓</span>
        ) : mode === "join" && player ? (
          <span>已占用</span>
        ) : (
          <span className="player-roster__empty-mark" aria-hidden="true" />
        );
        const content = (
          <>
            <span className="player-roster__seat">{seat}<i>号</i></span>
            <span className="player-roster__identity">
              <strong className="player-roster__name">{player?.nickname ?? (mode === "join" ? "空座位" : "等待加入")}</strong>
              {mode !== "target" && player && (player.isHost || player.isSimulated || isCurrent || isLeader) && (
                <small className="player-roster__meta">
                  {player.isHost && <span>房主</span>}
                  {isLeader && <span>队长</span>}
                  {isCurrent && <span>我</span>}
                  {player.isSimulated && <span>模拟</span>}
                </small>
              )}
            </span>
            <span className="player-roster__state">{state}</span>
            {onRemove && player && !player.isHost && !player.isSimulated && mode === "manage" && (
              <button type="button" className="player-roster__remove" disabled={removeDisabled} onClick={(event) => { event.stopPropagation(); onRemove(player.id); }}>移出</button>
            )}
          </>
        );

        return selectable ? (
          <button
            type="button"
            key={seat}
            className={`player-roster__row ${selected ? "is-selected" : ""}`}
            data-seat={seat}
            aria-pressed={selected}
            aria-label={`${seat}号 ${player?.nickname ?? "空座位"}${selected ? "，已选中" : ""}`}
            disabled={disabled || Boolean(player && disabledIds.includes(player.id)) || (mode === "join" && Boolean(player))}
            onClick={() => player ? onPlayerSelect?.(player.id) : onSeatSelect?.(seat)}
          >
            {content}
          </button>
        ) : (
          <div
            key={seat}
            className={`player-roster__row ${selected ? "is-selected" : ""}`}
            data-seat={seat}
            role="group"
            aria-label={`${seat}号 ${player?.nickname ?? "等待加入"}${selected ? "，已选中" : ""}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
