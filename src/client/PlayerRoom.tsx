import { useEffect, useMemo, useState } from "react";
import type { PrivatePlayerState, PublicRoomState } from "@shared/contracts";
import { ROLE_DETAILS } from "@shared/contracts";
import { Brand, ConnectionNotice } from "./components/Brand";
import { IdentityReveal } from "./components/IdentityReveal";
import { MissionTrack } from "./components/MissionTrack";
import { QuestBallot } from "./components/QuestBallot";
import { RoundTable } from "./components/RoundTable";
import { clearCredentials, loadCredentials } from "./session";
import { useRoomSocket } from "./useRoomSocket";

export function PlayerRoom({ roomCode }: { roomCode: string }) {
  const credentials = useMemo(() => loadCredentials(roomCode), [roomCode]);
  const { publicState, privateState, connected, error, closedNotice, command, clearError } = useRoomSocket(roomCode, "player", credentials);

  useEffect(() => {
    if (!closedNotice) return;
    clearCredentials(roomCode);
    window.location.assign(`/?notice=${closedNotice}`);
  }, [closedNotice, roomCode]);

  if (!credentials) return <SessionMissing roomCode={roomCode} />;
  if (!publicState || !privateState) {
    return (
      <main className="loading-screen">
        <Brand />
        <div className="loading-seal" aria-hidden="true" />
        <p>{error ?? "正在回到圆桌…"}</p>
        {error && <button className="secondary-button" onClick={() => { clearCredentials(roomCode); window.location.assign(`/?room=${roomCode}`); }}>重新加入</button>}
      </main>
    );
  }

  const me = publicState.players.find((player) => player.id === privateState.playerId)!;
  return (
    <div className="player-shell">
      <header className="player-topbar">
        <Brand compact />
        <div>
          <span>{publicState.name}</span>
          <b>{formatRoomCode(publicState.code)}</b>
        </div>
      </header>
      <ConnectionNotice connected={connected} error={error} />
      {error && <button type="button" className="dismiss-error" aria-label="关闭错误提示" onClick={clearError}>×</button>}
      {publicState.settings.mode === "experience" && (
        <aside className="experience-strip">完整流程体验 · 三名模拟玩家会自动完成其余操作</aside>
      )}
      <PlayerPhase
        room={publicState}
        privateState={privateState}
        me={me}
        command={command}
      />
    </div>
  );
}

function PlayerPhase({
  room,
  privateState,
  me,
  command,
}: {
  room: PublicRoomState;
  privateState: PrivatePlayerState;
  me: PublicRoomState["players"][number];
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
}) {
  switch (room.phase) {
    case "lobby":
      return <Lobby room={room} me={me} command={command} />;
    case "identity":
      return privateState.canConfirmIdentity && privateState.role ? (
        <IdentityReveal role={privateState.role} knownPlayers={privateState.knownPlayers} onConfirm={() => command("identity:confirm")} />
      ) : (
        <WaitingPanel title="身份已封存" copy={`已有 ${room.players.filter((player) => player.identityConfirmed).length} / ${room.settings.playerCount} 人确认身份`} hint="放下手机，等待其他玩家。" />
      );
    case "team-building":
      return <TeamBuilding key={`${room.missionIndex}-${room.leaderSeat}`} room={room} privateState={privateState} command={command} />;
    case "team-voting":
      return <PublicVote room={room} privateState={privateState} command={command} />;
    case "quest-voting":
      return privateState.canSubmitQuest && privateState.faction ? (
        <QuestBallot missionNumber={room.missionIndex + 1} faction={privateState.faction} onSubmit={(vote) => command("quest:submit", vote)} />
      ) : (
        <WaitingPanel
          title={privateState.questVoteSubmitted ? "任务票已封存" : "等待任务结果"}
          copy={privateState.questVoteSubmitted ? "你的选择已经匿名提交" : "本轮任务队员正在秘密选择"}
          hint="请放下手机，观察桌上的其他人。"
        />
      );
    case "quest-result":
      return privateState.canContinueAfterQuest ? (
        <QuestResult room={room} privateState={privateState} command={command} />
      ) : (
        <WaitingPanel title="任务结果已经揭晓" copy="请看向桌面中央的公共屏" hint="观察其他玩家看到结果时的反应。" />
      );
    case "assassination":
      return <Assassination room={room} privateState={privateState} command={command} />;
    case "complete":
      return <GameComplete room={room} privateState={privateState} command={command} />;
  }
}

function Lobby({
  room,
  me,
  command,
}: {
  room: PublicRoomState;
  me: PublicRoomState["players"][number];
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
}) {
  const [changingSeat, setChangingSeat] = useState(false);
  const [exitAction, setExitAction] = useState<"leave" | "dissolve" | null>(null);
  const [exiting, setExiting] = useState(false);
  const everyoneReady = room.players.length === room.settings.playerCount && room.players.every((player) => player.ready && player.connected);
  const joinUrl = `${window.location.origin}/?room=${room.code}`;
  const isExperience = room.settings.mode === "experience";
  const openSeats = Array.from({ length: room.settings.playerCount }, (_, index) => index + 1)
    .filter((seat) => !room.players.some((player) => player.seat === seat));

  const confirmExit = async () => {
    if (!exitAction) return;
    setExiting(true);
    try {
      await command(exitAction === "dissolve" ? "room:dissolve" : "player:leave");
      clearCredentials(room.code);
      window.location.assign(`/?notice=${exitAction === "dissolve" ? "dissolved" : "left"}`);
    } catch {
      setExiting(false);
    }
  };
  return (
    <main className="lobby-screen">
      <header className="phase-heading">
        <h1>{room.name}</h1>
        <p>房间号 {formatRoomCode(room.code)}</p>
        <span>{room.players.length} / {room.settings.playerCount} 已就座</span>
      </header>
      <RoundTable players={room.players} playerCount={room.settings.playerCount} currentPlayerId={me.id} />
      {isExperience && (
        <div className="experience-lobby-note">
          <strong>第二台手机请扫码加入 2 号位</strong>
          <span>两位真人准备后即可开始，模拟玩家已经就位。</span>
        </div>
      )}
      <div className="lobby-status" aria-label="准备状态">
        {room.players.map((player) => (
          <span key={player.id} className={player.ready ? "is-ready" : ""}>{player.seat}号 {player.ready ? "已准备" : "未准备"}</span>
        ))}
      </div>
      {changingSeat && openSeats.length > 0 && (
        <div className="seat-change-panel">
          <p>选择一个空座位</p>
          <div className="number-options" role="group" aria-label="更换座位">
            {openSeats.map((seat) => (
              <button
                type="button"
                key={seat}
                onClick={() => {
                  void command("player:seat", seat).then(() => setChangingSeat(false)).catch(() => undefined);
                }}
              >
                {seat}
              </button>
            ))}
          </div>
          <span>换座后需要重新确认准备。</span>
        </div>
      )}
      {!isExperience && openSeats.length > 0 && (
        <button type="button" className="text-link" onClick={() => setChangingSeat((value) => !value)}>
          {changingSeat ? "取消换座" : "换一个座位"}
        </button>
      )}
      {me.isHost && <QrCode value={joinUrl} label={isExperience ? "第二台手机扫码加入体验" : "扫码加入桌局"} />}
      <button type="button" className={me.ready ? "secondary-button" : "primary-button"} onClick={() => runCommand(command("player:ready", !me.ready))}>
        {me.ready ? "取消准备" : "确认座位并准备"}
      </button>
      {me.isHost && (
        <>
          <button type="button" className="primary-button" disabled={!everyoneReady} onClick={() => runCommand(command("game:start"))}>
            {isExperience ? "开始完整流程体验" : "开始分配身份"}
          </button>
          <a className="text-link" href={`/room/${room.code}/board`} target="_blank" rel="noreferrer">打开桌面公共屏</a>
        </>
      )}
      {!exitAction ? (
        <button type="button" className="text-link lobby-exit-trigger" onClick={() => setExitAction(me.isHost ? "dissolve" : "leave")}>
          {me.isHost ? "解散房间并重新创建" : "离开房间"}
        </button>
      ) : (
        <div className="lobby-exit-confirm" role="alertdialog" aria-label={exitAction === "dissolve" ? "确认解散房间" : "确认离开房间"}>
          <strong>{exitAction === "dissolve" ? "确定解散这个房间？" : "确定离开这个房间？"}</strong>
          <p>{exitAction === "dissolve" ? "所有人会回到首页，旧房间号立即失效。" : "你的座位会立即释放，之后需要重新选择座位加入。"}</p>
          <button type="button" className="danger-button" disabled={exiting} onClick={() => void confirmExit()}>
            {exiting ? "正在处理…" : exitAction === "dissolve" ? "确认解散并返回首页" : "确认离开并释放座位"}
          </button>
          <button type="button" className="text-link" disabled={exiting} onClick={() => setExitAction(null)}>继续等待</button>
        </div>
      )}
    </main>
  );
}

function TeamBuilding({
  room,
  privateState,
  command,
}: {
  room: PublicRoomState;
  privateState: PrivatePlayerState;
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
}) {
  const [selected, setSelected] = useState<string[]>(() => room.settings.mode === "experience"
    ? room.players.filter((player) => !player.isSimulated).map((player) => player.id)
    : []);
  const mission = room.missions[room.missionIndex];
  const leader = room.players.find((player) => player.seat === room.leaderSeat);
  const toggle = (playerId: string) => {
    setSelected((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : current.length < mission.teamSize
          ? [...current, playerId]
          : current,
    );
  };
  return (
    <main className="phase-screen team-building-screen">
      <PhaseSummary room={room} />
      <header className="phase-heading">
        <p>当前队长 · {leader?.seat}号 {leader?.nickname}</p>
        <h1>{privateState.canProposeTeam ? `选择 ${mission.teamSize} 名任务队员` : "队长正在组队"}</h1>
        <span>{mission.requiresTwoFails ? "本轮需要 2 张失败票才会失败" : "1 张失败票将使任务失败"}</span>
      </header>
      <RoundTable
        players={room.players}
        playerCount={room.settings.playerCount}
        selectedIds={selected}
        leaderSeat={room.leaderSeat}
        onToggle={privateState.canProposeTeam ? toggle : undefined}
      />
      {privateState.canProposeTeam ? (
        <button type="button" className="primary-button" disabled={selected.length !== mission.teamSize} onClick={() => runCommand(command("team:propose", selected))}>
          确认本轮队伍
        </button>
      ) : (
        <p className="put-phone-down">放下手机，参与现场讨论。</p>
      )}
    </main>
  );
}

function PublicVote({
  room,
  privateState,
  command,
}: {
  room: PublicRoomState;
  privateState: PrivatePlayerState;
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
}) {
  const [rejectCount, setRejectCount] = useState(0);
  const remaining = useCountdown(room.voteCountdownEndsAt);
  const team = room.players.filter((player) => room.proposedTeam.includes(player.id));
  return (
    <main className="phase-screen public-vote-screen">
      <PhaseSummary room={room} />
      <header className="phase-heading">
        <p>本轮队伍</p>
        <h1>{team.map((player) => `${player.seat}号 ${player.nickname}`).join(" · ")}</h1>
        <span>现场讨论结束后，所有人同时亮出赞成或反对。</span>
      </header>
      {room.voteCountdownEndsAt ? (
        <div className="countdown-seal" role="timer" aria-live="assertive">
          <strong>{remaining > 0 ? remaining : "亮票"}</strong>
          <span>{remaining > 0 ? "准备同时表决" : "请看向桌上的其他人"}</span>
        </div>
      ) : (
        <div className="vote-instruction"><span>3</span><span>2</span><span>1</span></div>
      )}
      {privateState.canStartPublicVote && (
        <button type="button" className="primary-button" onClick={() => runCommand(command("team-vote:start"))}>开始同时亮票</button>
      )}
      {privateState.canRecordPublicVote && (
        <div className="vote-recorder">
          <p>现场共有多少人反对？</p>
          <div>
            <button type="button" onClick={() => setRejectCount((value) => Math.max(0, value - 1))} aria-label="减少反对人数">−</button>
            <strong>{rejectCount}</strong>
            <button type="button" onClick={() => setRejectCount((value) => Math.min(room.settings.playerCount, value + 1))} aria-label="增加反对人数">＋</button>
          </div>
          <button type="button" className="primary-button" disabled={remaining > 0} onClick={() => runCommand(command("team-vote:record", rejectCount))}>记录表决结果</button>
        </div>
      )}
      {!privateState.canStartPublicVote && !privateState.canRecordPublicVote && <p className="put-phone-down">由房主或当前队长记录结果。</p>}
    </main>
  );
}

function QuestResult({ room, privateState, command }: { room: PublicRoomState; privateState: PrivatePlayerState; command: <T>(event: any, ...args: unknown[]) => Promise<T> }) {
  const result = room.lastQuestResult!;
  const successCount = room.missions.filter((mission) => mission.outcome === "success").length;
  const failureCount = room.missions.filter((mission) => mission.outcome === "failure").length;
  const continueLabel = successCount >= 3 ? "进入刺杀阶段" : failureCount >= 3 ? "查看游戏结局" : "进入下一轮";
  return (
    <main className={`phase-screen quest-result quest-result--${result.outcome}`}>
      <PhaseSummary room={room} />
      <div className="result-seal"><span>{result.outcome === "success" ? "✦" : "×"}</span></div>
      <header className="phase-heading">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <h1>任务{result.outcome === "success" ? "成功" : "失败"}</h1>
        <span>共出现 {result.failCount} 张失败票</span>
      </header>
      <div className="revealed-ballots" aria-label="匿名任务票">
        {result.ballots.map((ballot, index) => <i key={`${ballot}-${index}`} className={`revealed-ballot revealed-ballot--${ballot}`}>{ballot === "success" ? "✦" : "×"}</i>)}
      </div>
      {privateState.canContinueAfterQuest ? (
        <button type="button" className="primary-button" onClick={() => runCommand(command("quest:continue"))}>{continueLabel}</button>
      ) : (
        <p className="put-phone-down">继续观察现场反应。</p>
      )}
    </main>
  );
}

function Assassination({ room, privateState, command }: { room: PublicRoomState; privateState: PrivatePlayerState; command: <T>(event: any, ...args: unknown[]) => Promise<T> }) {
  const [target, setTarget] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (!privateState.canAssassinate) {
    return <WaitingPanel title="三次任务已经成功" copy="邪恶方正在现场讨论梅林的身份" hint="请保持安静，等待刺客当面指出目标。" />;
  }
  const candidates = room.players.filter((player) => player.id !== privateState.playerId);
  return (
    <main className="phase-screen assassination-screen">
      <header className="phase-heading">
        <p>最后的机会</p>
        <h1>指出你认为的梅林</h1>
        <span>先在现场明确指出目标，再在这里确认。</span>
      </header>
      <div className="target-list">
        {candidates.map((player) => (
          <button type="button" key={player.id} className={target === player.id ? "is-selected" : ""} onClick={() => { setTarget(player.id); setConfirming(false); }}>
            <span>{player.seat}</span><strong>{player.nickname}</strong>
          </button>
        ))}
      </div>
      {target && !confirming && <button type="button" className="primary-button" onClick={() => setConfirming(true)}>选择这名玩家</button>}
      {target && confirming && (
        <div className="danger-confirm">
          <p>刺杀一旦确认，整局立即结束。</p>
          <button type="button" className="danger-button" onClick={() => runCommand(command("assassination:select", target))}>确认刺杀</button>
          <button type="button" className="text-link" onClick={() => setConfirming(false)}>返回重选</button>
        </div>
      )}
    </main>
  );
}

function GameComplete({ room, privateState, command }: { room: PublicRoomState; privateState: PrivatePlayerState; command: <T>(event: any, ...args: unknown[]) => Promise<T> }) {
  return (
    <main className={`phase-screen complete-screen complete-screen--${room.winner}`}>
      <div className="result-seal"><span>{room.winner === "good" ? "✦" : "×"}</span></div>
      <header className="phase-heading">
        <p>游戏结束</p>
        <h1>{room.winner === "good" ? "正义方获胜" : "邪恶方获胜"}</h1>
        {room.assassinationTargetId && <span>刺客选择了 {room.players.find((player) => player.id === room.assassinationTargetId)?.nickname}</span>}
      </header>
      <div className="role-reveal-list">
        {room.players.map((player) => {
          const revealed = room.revealedRoles.find((item) => item.playerId === player.id)!;
          const details = ROLE_DETAILS[revealed.role];
          return (
            <div key={player.id} className={`role-reveal-row role-reveal-row--${details.faction}`}>
              <span>{player.seat}</span><b>{player.nickname}</b><strong>{details.name}</strong>
            </div>
          );
        })}
      </div>
      {privateState.canRematch && <button type="button" className="primary-button" onClick={() => runCommand(command("game:rematch"))}>原座位再来一局</button>}
      {!privateState.canRematch && <p className="put-phone-down">等待房主决定是否再来一局。</p>}
    </main>
  );
}

function PhaseSummary({ room }: { room: PublicRoomState }) {
  return (
    <div className="phase-summary">
      <MissionTrack missions={room.missions} currentIndex={room.missionIndex} />
      <p>连续否决 <b>{room.rejectionCount}</b> / 5</p>
    </div>
  );
}

function WaitingPanel({ title, copy, hint }: { title: string; copy: string; hint: string }) {
  return (
    <main className="waiting-panel">
      <div className="waiting-panel__orbit" aria-hidden="true"><i /><i /><i /></div>
      <h1>{title}</h1>
      <p>{copy}</p>
      <span>{hint}</span>
    </main>
  );
}

function SessionMissing({ roomCode }: { roomCode: string }) {
  return (
    <main className="loading-screen">
      <Brand />
      <h1>需要重新加入桌局</h1>
      <p>这台设备上没有 {formatRoomCode(roomCode)} 房间的身份凭证。</p>
      <a className="primary-button" href={`/?room=${roomCode}`}>返回选择座位</a>
    </main>
  );
}

function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(value, { width: 240, margin: 1, color: { dark: "#07111e", light: "#f4e8cf" } })).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => { cancelled = true; };
  }, [value]);
  if (!src) return null;
  return <div className="qr-code"><img src={src} alt="加入当前房间的二维码" /><span>{label}</span></div>;
}

function useCountdown(endsAt: number | null): number {
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

function runCommand(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}
