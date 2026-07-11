import { useEffect, useState } from "react";
import type { PublicRoomState } from "@shared/contracts";
import { ROLE_DETAILS } from "@shared/contracts";
import { Brand, ConnectionNotice } from "./components/Brand";
import { MissionTrack } from "./components/MissionTrack";
import { RoundTable } from "./components/RoundTable";
import { useRoomSocket } from "./useRoomSocket";

export function BoardRoom({ roomCode }: { roomCode: string }) {
  const { publicState, connected, error } = useRoomSocket(roomCode, "board");
  if (!publicState) {
    return <main className="board-loading"><Brand /><p>{error ?? "正在连接桌局…"}</p></main>;
  }
  return (
    <main className="public-board">
      <header className="public-board__topbar">
        <Brand compact />
        <div><span>{publicState.name}</span><b>{formatRoomCode(publicState.code)}</b></div>
      </header>
      <ConnectionNotice connected={connected} error={error} />
      <section className="public-board__stage">
        <BoardCenter room={publicState} />
        <RoundTable
          players={publicState.players}
          playerCount={publicState.settings.playerCount}
          selectedIds={publicState.proposedTeam}
          leaderSeat={publicState.leaderSeat}
          label="当前圆桌座位与任务队伍"
        />
      </section>
      {publicState.phase !== "lobby" && (
        <div className="public-board__missions">
          <MissionTrack missions={publicState.missions} currentIndex={publicState.missionIndex} />
          <p>连续否决 <b>{publicState.rejectionCount}</b> / 5</p>
        </div>
      )}
    </main>
  );
}

function BoardCenter({ room }: { room: PublicRoomState }) {
  const remaining = useBoardCountdown(room.voteCountdownEndsAt);
  const leader = room.players.find((player) => player.seat === room.leaderSeat);
  const mission = room.missions[Math.min(room.missionIndex, 4)];
  if (room.phase === "lobby") {
    return (
      <div className="board-message board-message--lobby">
        <h1>{room.name}</h1>
        <p>{room.players.length} / {room.settings.playerCount} 已就座</p>
        <BoardQr value={`${window.location.origin}/?room=${room.code}`} />
        <span>扫码加入 · 房间号 {formatRoomCode(room.code)}</span>
      </div>
    );
  }
  if (room.phase === "identity") {
    return (
      <div className="board-message">
        <p>身份确认</p>
        <strong>{room.players.filter((player) => player.identityConfirmed).length}</strong>
        <h1>等待所有人记住身份</h1>
        <span>请各自查看手机，不要观察其他人的屏幕。</span>
      </div>
    );
  }
  if (room.phase === "team-building") {
    return (
      <div className="board-message">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <strong>{mission.teamSize}</strong>
        <h1>{leader?.seat}号 {leader?.nickname} 正在组队</h1>
        <span>本轮需要 {mission.teamSize} 人 · {mission.requiresTwoFails ? "需要 2 张失败票" : "1 张失败票即失败"}</span>
      </div>
    );
  }
  if (room.phase === "team-voting") {
    return (
      <div className="board-message board-message--countdown">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <strong>{room.voteCountdownEndsAt ? (remaining > 0 ? remaining : "亮票") : "—"}</strong>
        <h1>{room.voteCountdownEndsAt ? "请所有人同时亮出赞成或反对" : "讨论本轮任务队伍"}</h1>
        <span>{room.proposedTeam.map((id) => {
          const player = room.players.find((candidate) => candidate.id === id)!;
          return `${player.seat}号 ${player.nickname}`;
        }).join(" · ")}</span>
      </div>
    );
  }
  if (room.phase === "quest-voting") {
    return (
      <div className="board-message">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <div className="board-seal-animation" aria-hidden="true"><i /><i /><i /></div>
        <h1>任务队员正在秘密选择</h1>
        <span>不会显示谁已经提交，也不会保留任务票与个人的对应关系。</span>
      </div>
    );
  }
  if (room.phase === "quest-result") {
    const result = room.lastQuestResult!;
    return (
      <div className={`board-message board-message--result board-message--${result.outcome}`}>
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <strong>{result.outcome === "success" ? "✦" : "×"}</strong>
        <h1>任务{result.outcome === "success" ? "成功" : "失败"}</h1>
        <span>共出现 {result.failCount} 张失败票</span>
        <div className="board-ballots">{result.ballots.map((ballot, index) => <i key={`${ballot}-${index}`} className={ballot}>{ballot === "success" ? "✦" : "×"}</i>)}</div>
      </div>
    );
  }
  if (room.phase === "assassination") {
    return (
      <div className="board-message board-message--danger">
        <p>最后的机会</p>
        <strong>†</strong>
        <h1>刺客，请当面指出梅林</h1>
        <span>邪恶方可以现场讨论，最终由刺客在自己的手机上确认。</span>
      </div>
    );
  }
  const target = room.assassinationTargetId ? room.players.find((player) => player.id === room.assassinationTargetId) : null;
  return (
    <div className={`board-message board-message--complete board-message--${room.winner}`}>
      <p>游戏结束</p>
      <strong>{room.winner === "good" ? "✦" : "×"}</strong>
      <h1>{room.winner === "good" ? "正义方获胜" : "邪恶方获胜"}</h1>
      {target && <span>刺客选择了 {target.seat}号 {target.nickname}</span>}
      <div className="board-role-reveal">
        {room.players.map((player) => {
          const revealed = room.revealedRoles.find((item) => item.playerId === player.id)!;
          return <b key={player.id} className={revealed.faction}>{player.seat}号 {player.nickname} · {ROLE_DETAILS[revealed.role].name}</b>;
        })}
      </div>
    </div>
  );
}

function BoardQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(value, { width: 300, margin: 1, color: { dark: "#07111e", light: "#f4e8cf" } })).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => { cancelled = true; };
  }, [value]);
  return src ? <img className="board-qr" src={src} alt="加入当前房间的二维码" /> : null;
}

function useBoardCountdown(endsAt: number | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000)));
    const initialTimer = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 100);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [endsAt]);
  return endsAt ? remaining : 0;
}

function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
