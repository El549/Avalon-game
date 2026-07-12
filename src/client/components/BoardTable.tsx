import type { CSSProperties, ReactNode } from "react";
import type { PublicPlayer } from "@shared/contracts";
import { CrownIcon } from "../icons";

export interface BoardTableProps {
  players: PublicPlayer[];
  playerCount: number;
  selectedIds?: string[];
  leaderSeat?: number | null;
  children?: ReactNode;
  label?: string;
}

type BoardSeatStyle = CSSProperties & {
  "--board-seat-left": string;
  "--board-seat-top": string;
  "--board-seat-index": number;
};

/**
 * Public-board-only table. Its wide, fixed-ratio stage and horizontal seat
 * plaques deliberately do not share the mobile round-table DOM.
 */
export function BoardTable({
  players,
  playerCount,
  selectedIds = [],
  leaderSeat = null,
  children,
  label = "当前圆桌座位与任务队伍",
}: BoardTableProps) {
  const playersBySeat = new Map(players.map((player) => [player.seat, player]));
  const selectedPlayerIds = new Set(selectedIds);

  return (
    <div
      className="board-table"
      role="group"
      aria-label={label}
      data-player-count={playerCount}
    >
      <BoardTableSurface />
      <div className="board-table__center" aria-live="polite">
        {children}
      </div>
      <div className="board-table__seats" role="list" aria-label="玩家座位">
        {Array.from({ length: playerCount }, (_, index) => index + 1).map((seat, index) => {
          const player = playersBySeat.get(seat);
          const selected = player ? selectedPlayerIds.has(player.id) : false;
          const isLeader = seat === leaderSeat;
          const position = getBoardSeatPosition(seat, playerCount);
          const style: BoardSeatStyle = {
            "--board-seat-left": `${position.left.toFixed(3)}%`,
            "--board-seat-top": `${position.top.toFixed(3)}%`,
            "--board-seat-index": index,
          };
          const nickname = player?.nickname ?? "空位";
          const nameLength = Array.from(nickname).length;
          const nameSize = nameLength >= 10 ? "xlong" : nameLength >= 7 ? "long" : nameLength >= 5 ? "medium" : "short";

          return (
            <article
              key={seat}
              className={[
                "board-seat",
                selected ? "board-seat--selected" : "",
                isLeader ? "board-seat--leader" : "",
                player ? "" : "board-seat--empty",
                player && !player.connected ? "board-seat--offline" : "",
              ].filter(Boolean).join(" ")}
              style={style}
              role="listitem"
              aria-label={getSeatLabel(seat, player, selected, isLeader)}
              data-seat={seat}
              data-name-length={nameLength}
              data-name-size={nameSize}
              data-selected={selected || undefined}
            >
              <BoardSeatFrame />
              {isLeader && (
                <span className="board-seat__leader-flag">
                  <CrownIcon className="board-seat__leader-icon" />
                  <span>队长</span>
                </span>
              )}
              <span className="board-seat__number" aria-hidden="true">{seat}</span>
              <span className="board-seat__name">{nickname}</span>
              {(player?.isSimulated || (player && !player.connected)) && (
                <span className="board-seat__status" aria-hidden="true">
                  {player.isSimulated && <span className="board-seat__simulated">模拟</span>}
                  {!player.connected && <span className="board-seat__offline">离线</span>}
                </span>
              )}
              {selected && (
                <span className="board-seat__selected-mark" aria-hidden="true">
                  <BoardCheckIcon />
                </span>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function BoardTableSurface() {
  return (
    <div className="board-table__surface" aria-hidden="true">
      <svg className="board-table__rings" viewBox="0 0 1200 496" preserveAspectRatio="none">
        <ellipse className="board-table__ring board-table__ring--outer" cx="600" cy="248" rx="587" ry="235" />
        <ellipse className="board-table__ring board-table__ring--middle" cx="600" cy="248" rx="570" ry="220" />
        <ellipse className="board-table__ring board-table__ring--inner" cx="600" cy="248" rx="530" ry="190" />
      </svg>
      <span className="board-table__diamond board-table__diamond--top" />
      <span className="board-table__diamond board-table__diamond--right" />
      <span className="board-table__diamond board-table__diamond--bottom" />
      <span className="board-table__diamond board-table__diamond--left" />
      <svg className="board-table__sigil" viewBox="0 0 160 160" fill="none">
        <circle cx="80" cy="80" r="59" />
        <circle cx="80" cy="80" r="43" opacity=".72" />
        <circle cx="80" cy="80" r="25" opacity=".45" />
        <path d="M80 8v144M8 80h144M29 29l102 102M131 29 29 131" opacity=".52" />
        <path d="m61 86 7-38 12 19 12-19 7 38-19 13-19-13Z" strokeWidth="3" />
        <path d="m61 86 19 27 19-27M68 48l12-13 12 13" strokeWidth="2" />
      </svg>
    </div>
  );
}

function BoardSeatFrame() {
  return (
    <svg className="board-seat__frame" viewBox="0 0 260 104" preserveAspectRatio="none" aria-hidden="true">
      <path className="board-seat__frame-shadow" d="M28 7h204l21 21v48l-21 21H28L7 76V28L28 7Z" />
      <path className="board-seat__frame-outer" d="M28 4h204l24 24v48l-24 24H28L4 76V28L28 4Z" />
      <path className="board-seat__frame-inner" d="M32 11h196l17 20v42l-17 20H32L15 73V31l17-20Z" />
      <path className="board-seat__frame-corner" d="M15 35h10V18M245 35h-10V18M15 69h10v17M245 69h-10v17" />
    </svg>
  );
}

function BoardCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" />
      <path d="m7.5 12.3 2.8 2.8 6.4-6.5" />
    </svg>
  );
}

function getBoardSeatPosition(seat: number, playerCount: number): { left: number; top: number } {
  const count = Math.max(1, playerCount);
  const angle = ((seat - 1) * Math.PI * 2) / count - Math.PI / 2;
  const radiusX = count >= 9 ? 43.8 : count >= 7 ? 44.6 : 45.2;
  const radiusY = count >= 9 ? 39.8 : count >= 7 ? 40.4 : 41;
  return {
    left: 50 + Math.cos(angle) * radiusX,
    top: 50 + Math.sin(angle) * radiusY,
  };
}

function getSeatLabel(seat: number, player: PublicPlayer | undefined, selected: boolean, leader: boolean): string {
  const details = [
    `${seat}号`,
    player?.nickname ?? "空位",
    leader ? "当前队长" : "",
    selected ? "已选入任务队伍" : "",
    player?.isSimulated ? "模拟玩家" : "",
    player && !player.connected ? "离线" : "",
  ].filter(Boolean);
  return details.join("，");
}
