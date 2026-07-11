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
  const [showHostControls, setShowHostControls] = useState(false);

  useEffect(() => {
    if (!closedNotice) return;
    clearCredentials(roomCode);
    window.location.assign(
      closedNotice === "session-invalid"
        ? `/?room=${roomCode}&notice=session-invalid`
        : `/?notice=${closedNotice}`,
    );
  }, [closedNotice, roomCode]);

  if (!credentials) return <SessionMissing roomCode={roomCode} />;
  if (closedNotice) {
    return (
      <main className="loading-screen">
        <Brand />
        <div className="loading-seal" aria-hidden="true" />
        <p>正在返回首页…</p>
      </main>
    );
  }
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

  const me = publicState.players.find((player) => player.id === privateState.playerId);
  if (!me) {
    return (
      <main className="loading-screen">
        <Brand />
        <div className="loading-seal" aria-hidden="true" />
        <p>正在更新座位状态…</p>
      </main>
    );
  }
  return (
    <div className="player-shell">
      <header className="player-topbar">
        <Brand compact />
        <div className="player-topbar__room">
          <span>{publicState.name}</span>
          <b>{formatRoomCode(publicState.code)}</b>
          {publicState.settings.mode === "experience" && <small>流程体验</small>}
        </div>
        {me.isHost && <button type="button" className="host-controls-trigger" onClick={() => setShowHostControls(true)}>房主管理</button>}
      </header>
      <ConnectionNotice connected={connected} error={error} />
      {error && <button type="button" className="dismiss-error" aria-label="关闭错误提示" onClick={clearError}>×</button>}
      <PlayerPhase
        room={publicState}
        privateState={privateState}
        me={me}
        command={command}
      />
      {me.isHost && showHostControls && (
        <HostControls room={publicState} command={command} onClose={() => setShowHostControls(false)} />
      )}
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
        <QuestBallot
          missionNumber={room.missionIndex + 1}
          faction={privateState.faction}
          orderKey={`${room.code}:${privateState.playerId}:${room.missionIndex}`}
          onSubmit={(vote) => command("quest:submit", vote)}
        />
      ) : (
        <WaitingPanel
          title={privateState.questVoteSubmitted ? "任务票已封存" : "等待任务结果"}
          copy={privateState.questVoteSubmitted ? "你的选择已经匿名提交" : "本轮任务队员正在秘密选择"}
          hint="请放下手机，观察桌上的其他人。"
        />
      );
    case "quest-ready":
      return privateState.canRevealQuest ? (
        <QuestRevealControl room={room} command={command} />
      ) : (
        <WaitingPanel title="任务票已全部封存" copy="等待本轮队长确认揭晓" hint="任务结果仍然保密。" />
      );
    case "quest-revealing":
      return me.seat === room.leaderSeat ? (
        <QuestRevealCountdown room={room} />
      ) : (
        <WaitingPanel title="任务结果即将揭晓" copy="本轮队长正在开启任务票" hint="请观察现场反应。" />
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
          <strong>第二台手机加入 2 号位</strong>
          <span>房主打开“房主管理 → 邀请玩家”让它扫码；两位真人准备后即可开始。</span>
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
          <button type="button" className="text-link" onClick={() => setChangingSeat(false)}>取消换座</button>
        </div>
      )}
      {!isExperience && openSeats.length > 0 && (
        <button type="button" className="text-link" onClick={() => setChangingSeat((value) => !value)}>
          {changingSeat ? "取消换座" : "换一个座位"}
        </button>
      )}
      <button type="button" className={me.ready ? "secondary-button" : "primary-button"} onClick={() => runCommand(command("player:ready", !me.ready))}>
        {me.ready ? "取消准备" : "确认座位并准备"}
      </button>
      {me.isHost && (
        <>
          <button type="button" className="primary-button" disabled={!everyoneReady} onClick={() => runCommand(command("game:start"))}>
            {isExperience ? "开始完整流程体验" : "开始分配身份"}
          </button>
        </>
      )}
      {!exitAction ? (
        <button type="button" className="text-link lobby-exit-trigger" onClick={() => setExitAction(me.isHost ? "dissolve" : "leave")}>
          {me.isHost ? "解散房间并重新创建" : "离开房间"}
        </button>
      ) : (
        <div className="lobby-confirm-overlay">
          <div className="lobby-exit-confirm" role="alertdialog" aria-modal="true" aria-label={exitAction === "dissolve" ? "确认解散房间" : "确认离开房间"}>
            <strong>{exitAction === "dissolve" ? "确定解散这个房间？" : "确定离开这个房间？"}</strong>
            <p>{exitAction === "dissolve" ? "所有人会回到首页，旧房间号立即失效。" : "你的座位会立即释放，之后需要重新选择座位加入。"}</p>
            <button type="button" className="danger-button" disabled={exiting} onClick={() => void confirmExit()}>
              {exiting ? "正在处理…" : exitAction === "dissolve" ? "确认解散并返回首页" : "确认离开并释放座位"}
            </button>
            <button type="button" className="text-link" disabled={exiting} onClick={() => setExitAction(null)}>继续等待</button>
          </div>
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
  const selected = room.draftTeam;
  const mission = room.missions[room.missionIndex];
  const leader = room.players.find((player) => player.seat === room.leaderSeat);
  const toggle = (playerId: string) => {
    if (!selected.includes(playerId) && selected.length >= mission.teamSize) return;
    void command("team:draft-toggle", playerId).catch(() => undefined);
  };
  const visibleSelection = room.draftTeam;
  const selectedPlayers = room.players.filter((player) => visibleSelection.includes(player.id));
  return (
    <main className="phase-screen team-building-screen">
      <PhaseSummary room={room} />
      <header className="phase-heading">
        <p>当前队长 · {leader?.seat}号 {leader?.nickname}</p>
        <h1>{privateState.canProposeTeam ? `选择 ${mission.teamSize} 名任务队员` : "队长正在组队"}</h1>
        <span>{mission.requiresTwoFails ? "本轮需要 2 张失败票才会失败" : "1 张失败票将使任务失败"}</span>
      </header>
      <p className="team-draft-summary" aria-live="polite">
        已选择 {visibleSelection.length} / {mission.teamSize}
        {selectedPlayers.length > 0 && ` · ${selectedPlayers.map((player) => `${player.seat}号 ${player.nickname}`).join("、")}`}
      </p>
      <RoundTable
        players={room.players}
        playerCount={room.settings.playerCount}
        selectedIds={visibleSelection}
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
  const team = room.players.filter((player) => room.proposedTeam.includes(player.id));
  return (
    <main className="phase-screen public-vote-screen">
      <PhaseSummary room={room} />
      <header className="phase-heading">
        <p>本轮队伍</p>
        <h1>{team.map((player) => `${player.seat}号 ${player.nickname}`).join(" · ")}</h1>
        <span>请所有人直接在现场举手表决，手机不参与个人投票。</span>
      </header>
      <div className="show-of-hands-seal" aria-hidden="true"><span>举手</span><small>现场完成</small></div>
      {privateState.canRecordPublicVote && (
        <div className="vote-recorder">
          <p>现场共有多少人反对？</p>
          <div>
            <button type="button" onClick={() => setRejectCount((value) => Math.max(0, value - 1))} aria-label="减少反对人数">−</button>
            <strong>{rejectCount}</strong>
            <button type="button" onClick={() => setRejectCount((value) => Math.min(room.settings.playerCount, value + 1))} aria-label="增加反对人数">＋</button>
          </div>
          <button type="button" className="primary-button" onClick={() => runCommand(command("team-vote:record", rejectCount))}>确认现场结果</button>
        </div>
      )}
      {!privateState.canRecordPublicVote && <p className="put-phone-down">由房主或当前队长记录反对人数。</p>}
    </main>
  );
}

function QuestRevealControl({
  room,
  command,
}: {
  room: PublicRoomState;
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
}) {
  const [busy, setBusy] = useState(false);
  const reveal = async () => {
    setBusy(true);
    try {
      await command("quest:reveal");
    } catch {
      setBusy(false);
    }
  };
  return (
    <main className="phase-screen quest-reveal-control">
      <PhaseSummary room={room} />
      <div className="sealed-votes" aria-hidden="true"><i /><i /><i /></div>
      <header className="phase-heading">
        <p>第 {room.missionIndex + 1} 轮任务</p>
        <h1>任务票已全部封存</h1>
        <span>只有本轮队长可以开启揭晓。</span>
      </header>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void reveal()}>
        {busy ? "正在开启…" : "确认并开始揭晓"}
      </button>
    </main>
  );
}

function QuestRevealCountdown({ room }: { room: PublicRoomState }) {
  const remaining = useCountdown(room.questRevealEndsAt, room.serverTime);
  return (
    <main className="phase-screen quest-reveal-countdown">
      <PhaseSummary room={room} />
      <div className="countdown-seal" role="timer" aria-live="assertive">
        <strong>{remaining > 0 ? remaining : "揭晓"}</strong>
        <span>任务结果即将揭晓</span>
      </div>
      <p className="put-phone-down">倒数结束后，所有设备会同时看到结果。</p>
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

function HostControls({
  room,
  command,
  onClose,
}: {
  room: PublicRoomState;
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
  onClose: () => void;
}) {
  const [qrMode, setQrMode] = useState<"board" | "join">(room.phase === "lobby" ? "join" : "board");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const boardUrl = `${window.location.origin}/room/${room.code}/board`;
  const joinUrl = `${window.location.origin}/?room=${room.code}`;
  const removablePlayers = room.players.filter((player) => !player.isHost && !player.isSimulated);
  const targetPlayer = removablePlayers.find((player) => player.id === removeTarget);

  const removePlayer = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await command("host:remove-player", removeTarget);
      setRemoveTarget(null);
    } catch {
      // The room-level banner reports the reason and keeps the management sheet open.
    } finally {
      setBusy(false);
    }
  };

  const resetGame = async () => {
    setBusy(true);
    try {
      await command("host:reset-game");
      onClose();
    } catch {
      // The room-level banner reports the reason and keeps the management sheet open.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="host-controls-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="host-controls-sheet" role="dialog" aria-modal="true" aria-label="房主管理">
        <header>
          <div><span>房主管理</span><strong>{room.name} · {formatRoomCode(room.code)}</strong></div>
          <button type="button" aria-label="关闭房主管理" onClick={onClose}>×</button>
        </header>

        <div className="host-qr-tabs" role="group" aria-label="二维码类型">
          <button type="button" className={qrMode === "board" ? "is-active" : ""} onClick={() => setQrMode("board")}>公共屏</button>
          {room.phase === "lobby" && <button type="button" className={qrMode === "join" ? "is-active" : ""} onClick={() => setQrMode("join")}>邀请玩家</button>}
        </div>
        {qrMode === "board" || room.phase !== "lobby" ? (
          <div className="host-qr-panel">
            <QrCode value={boardUrl} label="用另一台设备扫码进入公共屏" />
            <a className="secondary-button" href={`/room/${room.code}/board`} target="_blank" rel="noreferrer">在本机预览公共屏</a>
            <p>公共屏只显示公开信息，不占用玩家座位。</p>
          </div>
        ) : (
          <div className="host-qr-panel">
            <QrCode value={joinUrl} label={room.settings.mode === "experience" ? "第二台手机扫码加入 2 号位" : "玩家扫码选择空座位"} />
            <a className="secondary-button" href={`/?room=${room.code}`} target="_blank" rel="noreferrer">在本机打开玩家加入页</a>
          </div>
        )}

        <div className="host-player-status">
          <h2>玩家状态</h2>
          {room.players.map((player) => (
            <div key={player.id}>
              <span>{player.seat}号</span>
              <strong>{player.nickname}</strong>
              <small>{player.connected ? "在线" : "离线"}{room.phase === "lobby" ? ` · ${player.ready ? "已准备" : "未准备"}` : ""}</small>
              {room.phase === "lobby" && !player.isHost && !player.isSimulated && (
                <button type="button" disabled={busy} onClick={() => setRemoveTarget(player.id)}>移出</button>
              )}
            </div>
          ))}
        </div>

        {targetPlayer && (
          <div className="host-danger-confirm" role="alertdialog" aria-label="确认移出玩家">
            <p>确定将 {targetPlayer.seat}号 {targetPlayer.nickname} 移出桌局？该座位会立即释放。</p>
            <button type="button" className="danger-button" disabled={busy} onClick={() => void removePlayer()}>确认移出</button>
            <button type="button" className="text-link" disabled={busy} onClick={() => setRemoveTarget(null)}>取消</button>
          </div>
        )}

        {room.phase !== "lobby" && !confirmReset && (
          <button type="button" className="text-link host-reset-trigger" onClick={() => setConfirmReset(true)}>结束本局并回到候场</button>
        )}
        {room.phase !== "lobby" && confirmReset && (
          <div className="host-danger-confirm" role="alertdialog" aria-label="确认结束本局">
            <p>所有人会保留座位并回到候场，当前身份和任务进度会清空。</p>
            <button type="button" className="danger-button" disabled={busy} onClick={() => void resetGame()}>确认结束本局</button>
            <button type="button" className="text-link" disabled={busy} onClick={() => setConfirmReset(false)}>继续当前游戏</button>
          </div>
        )}
      </section>
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
  return <div className="qr-code"><img src={src} alt={label} /><span>{label}</span></div>;
}

function useCountdown(endsAt: number | null, serverTime: number): number {
  const [localEndsAt] = useState<number | null>(() => (
    endsAt ? Date.now() + Math.max(0, endsAt - serverTime) : null
  ));
  const [remaining, setRemaining] = useState(() => (
    localEndsAt ? Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1_000)) : 0
  ));
  useEffect(() => {
    if (!localEndsAt) return;
    const calculate = () => Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1_000));
    const update = () => setRemaining(calculate());
    const initialTimer = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 100);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [localEndsAt]);
  return localEndsAt ? remaining : 0;
}

function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function runCommand(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}
