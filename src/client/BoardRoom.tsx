import { useEffect, useState } from "react";
import type { PublicRoomState } from "@shared/contracts";
import { ROLE_DETAILS } from "@shared/contracts";
import { BoardMissionRail } from "./components/BoardMissionRail";
import { BoardTable } from "./components/BoardTable";
import { Brand, ConnectionNotice } from "./components/Brand";
import { useRoomSocket } from "./useRoomSocket";

export function BoardRoom({ roomCode }: { roomCode: string }) {
  const { publicState, connected, error, closedNotice } = useRoomSocket(roomCode, "board");
  useEffect(() => {
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    document.documentElement.classList.add("board-route");
    document.body.classList.add("board-route");
    if (themeColor) themeColor.content = "#ffffff";
    return () => {
      document.documentElement.classList.remove("board-route");
      document.body.classList.remove("board-route");
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
    };
  }, []);
  useEffect(() => {
    if (closedNotice) window.location.assign(`/?notice=${closedNotice}`);
  }, [closedNotice]);
  if (!publicState) {
    return <main className="board-loading"><Brand /><p>{error ?? "正在连接桌局…"}</p></main>;
  }
  return (
    <main className={`public-board public-board--${publicState.phase}`}>
      <header className="public-board__topbar">
        <Brand compact />
        <div className="public-board__room-name"><span>房间</span><strong>{publicState.name}</strong></div>
        <div className="public-board__room-code"><span>房间号</span><b>{formatRoomCode(publicState.code)}</b></div>
      </header>
      <ConnectionNotice connected={connected} error={error} />
      <section className="public-board__main" aria-label="桌局公开信息">
        <div className="public-board__table-stage">
          <BoardTable
            players={publicState.players}
            playerCount={publicState.settings.playerCount}
            selectedIds={publicState.phase === "team-building" ? publicState.draftTeam : publicState.proposedTeam}
            leaderSeat={publicState.leaderSeat}
            label="当前圆桌座位与任务队伍"
          >
            <div className="public-board__info" aria-label="当前游戏阶段">
              <BoardCenter room={publicState} />
            </div>
          </BoardTable>
        </div>
      </section>
      {publicState.phase !== "lobby" && (
        <BoardMissionRail missions={publicState.missions} currentIndex={publicState.missionIndex} rejectionCount={publicState.rejectionCount} />
      )}
    </main>
  );
}

function BoardCenter({ room }: { room: PublicRoomState }) {
  const leader = room.players.find((player) => player.seat === room.leaderSeat);
  const mission = room.missions[Math.min(room.missionIndex, 4)];
  if (room.phase === "lobby") {
    return (
      <div className="board-message board-message--lobby">
        <h1>等待入座</h1>
        <p><b>{room.players.length}</b> / {room.settings.playerCount} 已就座</p>
        {room.settings.mode === "experience" ? (
          <div className="board-experience-ready">
            <strong>完整流程体验</strong>
            <span>三名模拟玩家已就位 · 等待两台手机准备</span>
          </div>
        ) : (
          <BoardQr value={`${window.location.origin}/?room=${room.code}`} />
        )}
        <span>{room.settings.mode === "experience" ? "第二台手机扫描房主页面二维码加入" : "扫码加入"} · 房间号 {formatRoomCode(room.code)}</span>
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
      <div className="board-message board-message--team-building">
        <p>第 <b>{room.missionIndex + 1}</b> 轮任务</p>
        <h1>队长正在选择 <b>{mission.teamSize}</b> 名队员</h1>
        <div className="board-message__ornament" aria-hidden="true"><i /><span>✦</span><i /></div>
        <strong className="board-team-count">已选择 <b>{room.draftTeam.length}</b> / {mission.teamSize}</strong>
        {leader && <span>当前队长 · {leader.seat}号 {leader.nickname}</span>}
      </div>
    );
  }
  if (room.phase === "team-voting") {
    return (
      <div className="board-message">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <strong>举手</strong>
        <h1>请在现场表决这支队伍</h1>
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
  if (room.phase === "quest-ready") {
    return (
      <div className="board-message">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <div className="board-seal-animation" aria-hidden="true"><i /><i /><i /></div>
        <h1>任务票已全部封存</h1>
        <span>等待本轮队长确认揭晓，结果仍然保密。</span>
      </div>
    );
  }
  if (room.phase === "quest-revealing") {
    return (
      <div className="board-message">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <div className="board-seal-animation board-seal-animation--revealing" aria-hidden="true"><i /><i /><i /></div>
        <h1>任务结果即将揭晓</h1>
        <span>请看向现场，观察每个人的反应。</span>
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
          const roleName = ROLE_DETAILS[revealed.role].name;
          return (
            <b key={player.id} className={revealed.faction} aria-label={`${player.seat}号 ${player.nickname}，${roleName}`}>
              <span className="board-role-reveal__seat">{player.seat}</span>
              <span className="board-role-reveal__context">号 {player.nickname} · </span>
              <span className="board-role-reveal__role">{roleName}</span>
            </b>
          );
        })}
      </div>
    </div>
  );
}

function BoardQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(value, { width: 300, margin: 1, color: { dark: "#0f213b", light: "#ffffff" } })).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => { cancelled = true; };
  }, [value]);
  return src ? <img className="board-qr" src={src} alt="加入当前房间的二维码" /> : null;
}

function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
