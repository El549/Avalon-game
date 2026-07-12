import { useEffect, useMemo, useState } from "react";
import type { PrivatePlayerState, PublicRoomState } from "@shared/contracts";
import { ROLE_DETAILS } from "@shared/contracts";
import { Brand, ConnectionNotice } from "./components/Brand";
import { IdentityReveal } from "./components/IdentityReveal";
import { MissionTrack } from "./components/MissionTrack";
import { QuestBallot } from "./components/QuestBallot";
import { PlayerRoster } from "./components/PlayerRoster";
import { ChaliceIcon, EyeIcon, ShieldLockIcon } from "./icons";
import { clearCredentials, loadCredentials } from "./session";
import { useRoomSocket } from "./useRoomSocket";

export function PlayerRoom({ roomCode }: { roomCode: string }) {
  const credentials = useMemo(() => loadCredentials(roomCode), [roomCode]);
  const { publicState, privateState, connected, error, closedNotice, command, clearError } = useRoomSocket(roomCode, "player", credentials);
  const [showHostControls, setShowHostControls] = useState(false);
  const [showIdentityReview, setShowIdentityReview] = useState(false);
  const canReviewIdentity = Boolean(
    privateState?.role
    && publicState?.phase !== "complete"
    && !(publicState?.phase === "identity" && privateState.canConfirmIdentity),
  );

  useEffect(() => {
    if (!closedNotice) return;
    clearCredentials(roomCode);
    window.location.assign(
      closedNotice === "session-invalid"
        ? `/?room=${roomCode}&notice=session-invalid`
        : `/?notice=${closedNotice}`,
    );
  }, [closedNotice, roomCode]);

  useEffect(() => {
    if (canReviewIdentity) return;
    const timer = window.setTimeout(() => setShowIdentityReview(false), 0);
    return () => window.clearTimeout(timer);
  }, [canReviewIdentity]);

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
  const useNightTheme = publicState.phase === "lobby"
    || publicState.phase === "quest-ready"
    || publicState.phase === "quest-revealing"
    || publicState.phase === "quest-result"
    || publicState.phase === "complete"
    || (publicState.phase === "quest-voting" && privateState.questVoteSubmitted)
    || (publicState.phase === "identity" && !privateState.canConfirmIdentity);
  return (
    <div className={`player-shell editorial-player editorial-player--${publicState.phase} ${useNightTheme ? "editorial-player--night" : "editorial-player--paper"}`}>
      <header className="player-topbar editorial-topbar">
        <Brand compact />
        <div className="player-topbar__room">
          <span className="player-topbar__room-name">{publicState.name}</span>
          <b className="player-topbar__room-code">{formatRoomCode(publicState.code)}</b>
        </div>
        <div className="player-topbar__actions">
          {!me.isHost && canReviewIdentity && (
            <button type="button" className="identity-review-trigger" aria-label="查看我的身份" onClick={() => setShowIdentityReview(true)}>
              <EyeIcon /><span>身份</span>
            </button>
          )}
          {me.isHost && <button type="button" className="host-controls-trigger" aria-label="房主管理" onClick={() => setShowHostControls(true)}>管理</button>}
        </div>
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
        <HostControls
          room={publicState}
          command={command}
          canReviewIdentity={canReviewIdentity}
          onReviewIdentity={() => { setShowHostControls(false); setShowIdentityReview(true); }}
          onClose={() => setShowHostControls(false)}
        />
      )}
      {showIdentityReview && canReviewIdentity && privateState.role && (
        <IdentityReveal
          role={privateState.role}
          knownPlayers={privateState.knownPlayers}
          mode="review"
          onClose={() => setShowIdentityReview(false)}
        />
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
        <WaitingPanel title="身份已封存" copy="等待其他玩家确认身份" progress={`${room.players.filter((player) => player.identityConfirmed).length} / ${room.settings.playerCount} 已确认`} hint="身份信息不会出现在公共屏。" />
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
          title={privateState.questVoteSubmitted ? "你的选择已封存" : "秘密任务进行中"}
          copy={privateState.questVoteSubmitted ? "等待其他任务队员" : "本轮任务队员正在秘密选择"}
          progress={`${room.questSubmittedCount} / ${room.proposedTeam.length} 已提交`}
          hint={privateState.questVoteSubmitted ? `还差 ${Math.max(0, room.proposedTeam.length - room.questSubmittedCount)} 人提交` : "请放下手机，观察桌上的其他人。"}
        />
      );
    case "quest-ready":
      return privateState.canRevealQuest ? (
        <QuestRevealControl room={room} command={command} />
      ) : (
        <WaitingPanel title="任务票已全部封存" copy="等待本轮队长确认揭晓" progress={`${room.proposedTeam.length} / ${room.proposedTeam.length} 已提交`} hint="任务结果仍然保密。" />
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
    <main className="lobby-screen editorial-night-page">
      <header className="lobby-crest">
        <span className="lobby-crest__icon" aria-hidden="true"><ChaliceIcon /></span>
        <h1>{room.name}</h1>
        <span>房间号</span>
        <b>{formatRoomCode(room.code)}</b>
      </header>
      <div className="lobby-content">
        <header className="lobby-heading">
          <h2>等待玩家</h2>
          <p><b>{room.players.length}</b> / {room.settings.playerCount} 已就座</p>
        </header>
        <PlayerRoster
          players={room.players}
          playerCount={room.settings.playerCount}
          mode="lobby"
          currentPlayerId={me.id}
          label="候场玩家状态"
        />
      </div>
      {isExperience && (
        <p className="experience-lobby-note"><ShieldLockIcon /><span>还差第二台手机，从“管理 → 邀请玩家”扫码加入</span></p>
      )}
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
      <div className="lobby-action-dock">
        {!isExperience && openSeats.length > 0 && (
          <button type="button" className="text-link" onClick={() => setChangingSeat((value) => !value)}>
            {changingSeat ? "取消换座" : "换一个座位"}
          </button>
        )}
        <button type="button" className={me.ready ? "secondary-button" : "primary-button"} onClick={() => runCommand(command("player:ready", !me.ready))}>
          {me.ready ? "取消准备" : "确认准备"}
        </button>
        {me.isHost && (
          <button type="button" className="primary-button" disabled={!everyoneReady} onClick={() => runCommand(command("game:start"))}>
            开始游戏
          </button>
        )}
        {!me.isHost && (!exitAction ? (
          <button type="button" className="text-link lobby-exit-trigger" onClick={() => setExitAction("leave")}>
            离开房间
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
        ))}
      </div>
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
  return (
    <main className="phase-screen team-building-screen editorial-paper-page">
      <header className="team-building-heading">
        <p className="editorial-divider"><span>第 {room.missionIndex + 1} 轮</span></p>
        <h1>{privateState.canProposeTeam ? `选择 ${mission.teamSize} 名队员` : "队长选人中"}</h1>
        <span>队长：{leader?.seat ?? "—"}号 {leader?.nickname ?? "等待确认"}</span>
      </header>
      <div className="team-roster">
        <PlayerRoster
          players={room.players}
          playerCount={room.settings.playerCount}
          mode="team"
          selectedIds={visibleSelection}
          currentPlayerId={privateState.playerId}
          leaderSeat={room.leaderSeat}
          onPlayerSelect={privateState.canProposeTeam ? toggle : undefined}
          label={privateState.canProposeTeam ? "选择任务队员" : "队长正在选择任务队员"}
        />
      </div>
      <div className="phase-action-dock">
        <p className="team-draft-summary" aria-live="polite">已选 <b>{visibleSelection.length}</b> / {mission.teamSize}</p>
        {privateState.canProposeTeam ? (
          <button type="button" className="primary-button" disabled={selected.length !== mission.teamSize} onClick={() => runCommand(command("team:propose", selected))}>
            <span>确认队伍</span>
          </button>
        ) : (
          <p className="put-phone-down">等待本轮队长确认队伍</p>
        )}
      </div>
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
  const leader = room.players.find((player) => player.seat === room.leaderSeat);
  const recorderCopy = leader?.isSimulated
    ? "本轮是模拟队长，由房主代为记录现场结果。"
    : `只由本轮队长${leader ? `（${leader.seat}号 ${leader.nickname}）` : ""}记录现场结果。`;
  return (
    <main className="phase-screen public-vote-screen editorial-paper-page">
      <header className="public-vote-heading">
        <h1>现场表决</h1>
        <p>请大家同时举手反对</p>
      </header>
      {privateState.canRecordPublicVote && (
        <div className="vote-recorder">
          <div className="vote-recorder__count"><strong>{rejectCount}</strong><span>人反对</span></div>
          <div>
            <button type="button" onClick={() => setRejectCount((value) => Math.max(0, value - 1))} aria-label="减少反对人数">−</button>
            <button type="button" onClick={() => setRejectCount((value) => Math.min(room.settings.playerCount, value + 1))} aria-label="增加反对人数">＋</button>
          </div>
          <p className="privacy-hint"><ShieldLockIcon />仅由本轮队长记录</p>
          <button type="button" className="primary-button" onClick={() => runCommand(command("team-vote:record", rejectCount))}>确认现场结果</button>
        </div>
      )}
      {!privateState.canRecordPublicVote && (
        <div className="public-vote-waiting">
          <p>现场举手表决中</p>
          <span>{recorderCopy}</span>
        </div>
      )}
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
    <main className="phase-screen sealed-state editorial-night-page quest-reveal-control">
      <div className="sealed-state__icon" aria-hidden="true"><ChaliceIcon /></div>
      <header>
        <h1>任务票已全部封存</h1>
        <p>等待本轮队长开启结果</p>
      </header>
      <p className="sealed-state__progress"><b>{room.proposedTeam.length}</b> / {room.proposedTeam.length} 已提交</p>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void reveal()}>
        {busy ? "正在开启…" : "开启任务结果"}
      </button>
    </main>
  );
}

function QuestRevealCountdown({ room }: { room: PublicRoomState }) {
  const remaining = useCountdown(room.questRevealEndsAt, room.serverTime);
  return (
    <main className="phase-screen sealed-state editorial-night-page quest-reveal-countdown">
      <div className="sealed-state__icon" aria-hidden="true"><ChaliceIcon /></div>
      <div className="sealed-state__countdown" role="timer" aria-live="assertive">
        <strong>{remaining > 0 ? remaining : "揭晓"}</strong>
        <span>任务结果即将揭晓</span>
      </div>
      <p className="privacy-hint"><ShieldLockIcon />所有设备会同时看到结果</p>
    </main>
  );
}

function QuestResult({ room, privateState, command }: { room: PublicRoomState; privateState: PrivatePlayerState; command: <T>(event: any, ...args: unknown[]) => Promise<T> }) {
  const result = room.lastQuestResult!;
  const successCount = room.missions.filter((mission) => mission.outcome === "success").length;
  const failureCount = room.missions.filter((mission) => mission.outcome === "failure").length;
  const continueLabel = successCount >= 3 ? "进入刺杀阶段" : failureCount >= 3 ? "查看游戏结局" : "进入下一轮";
  return (
    <main className={`phase-screen quest-result editorial-night-page quest-result--${result.outcome}`}>
      <header className="quest-result__heading">
        <p>第 {room.missionIndex + 1} 次任务</p>
        <h1>任务{result.outcome === "success" ? "成功" : "失败"}</h1>
        <span>{result.failCount} 张失败票</span>
      </header>
      <MissionTrack missions={room.missions} currentIndex={room.missionIndex} />
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
  return (
    <main className="phase-screen assassination-screen editorial-paper-page">
      <header className="assassination-heading">
        <h1>刺客行动</h1>
        <p>选择你认为是梅林的玩家</p>
      </header>
      <div className="target-list">
        <PlayerRoster
          players={room.players}
          playerCount={room.settings.playerCount}
          mode="target"
          selectedIds={target ? [target] : []}
          currentPlayerId={privateState.playerId}
          disabledIds={[privateState.playerId]}
          onPlayerSelect={(playerId) => { setTarget(playerId); setConfirming(false); }}
          label="选择刺杀目标"
        />
      </div>
      <div className="assassination-action">
        {!confirming ? (
          <button type="button" className="primary-button" disabled={!target} onClick={() => setConfirming(true)}>确认刺杀目标</button>
        ) : (
          <div className="danger-confirm">
            <button type="button" className="danger-button" onClick={() => target && runCommand(command("assassination:select", target))}>最终确认刺杀</button>
            <button type="button" className="text-link" onClick={() => setConfirming(false)}>返回重选</button>
          </div>
        )}
        <p className="irreversible-hint">刺杀目标确认后不可更改</p>
      </div>
    </main>
  );
}

function GameComplete({ room, privateState, command }: { room: PublicRoomState; privateState: PrivatePlayerState; command: <T>(event: any, ...args: unknown[]) => Promise<T> }) {
  return (
    <main className={`phase-screen complete-screen editorial-night-page complete-screen--${room.winner}`}>
      <header className="complete-heading">
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

function HostControls({
  room,
  command,
  canReviewIdentity,
  onReviewIdentity,
  onClose,
}: {
  room: PublicRoomState;
  command: <T>(event: any, ...args: unknown[]) => Promise<T>;
  canReviewIdentity: boolean;
  onReviewIdentity: () => void;
  onClose: () => void;
}) {
  const [qrMode, setQrMode] = useState<"board" | "join">(room.phase === "lobby" ? "join" : "board");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
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

  const dissolveRoom = async () => {
    setBusy(true);
    try {
      await command("room:dissolve");
      clearCredentials(room.code);
      window.location.assign("/?notice=dissolved");
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="host-controls-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="host-controls-sheet" role="dialog" aria-modal="true" aria-label="房主管理">
        <span className="host-controls-sheet__handle" aria-hidden="true" />
        <header className="host-controls-sheet__header">
          <h1>房主管理</h1>
          <button type="button" aria-label="关闭房主管理" onClick={onClose}>×</button>
        </header>

        <div className="host-qr-tabs" role="group" aria-label="二维码类型">
          {room.phase === "lobby" && <button type="button" className={qrMode === "join" ? "is-active" : ""} onClick={() => setQrMode("join")}>邀请玩家</button>}
          <button type="button" className={qrMode === "board" ? "is-active" : ""} onClick={() => setQrMode("board")}>公共屏</button>
        </div>
        {qrMode === "board" || room.phase !== "lobby" ? (
          <div className="host-qr-panel">
            <QrCode value={boardUrl} label="用另一台设备扫码进入公共屏" />
            <a className="host-qr-panel__link" href={`/room/${room.code}/board`} target="_blank" rel="noreferrer">在本机预览公共屏</a>
          </div>
        ) : (
          <div className="host-qr-panel">
            <QrCode value={joinUrl} label={room.settings.mode === "experience" ? "第二台手机扫码加入 2 号位" : "玩家扫码选择空座位"} />
            <a className="host-qr-panel__link" href={`/?room=${room.code}`} target="_blank" rel="noreferrer">在本机打开加入页</a>
          </div>
        )}

        <div className="host-player-status">
          <h2>玩家状态</h2>
          <PlayerRoster
            players={room.players}
            playerCount={room.settings.playerCount}
            mode="manage"
            currentPlayerId={room.players.find((player) => player.isHost)?.id}
            onRemove={room.phase === "lobby" ? setRemoveTarget : undefined}
            removeDisabled={busy}
            label="管理玩家状态"
          />
        </div>

        {canReviewIdentity && <button type="button" className="host-identity-link" onClick={onReviewIdentity}><EyeIcon />查看我的身份</button>}

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
        {room.phase === "lobby" && !confirmDissolve && (
          <button type="button" className="host-dissolve-trigger" onClick={() => setConfirmDissolve(true)}><ShieldLockIcon />解散房间</button>
        )}
        {room.phase === "lobby" && confirmDissolve && (
          <div className="host-danger-confirm" role="alertdialog" aria-label="确认解散房间">
            <p>所有玩家会返回首页，当前房间号立即失效。</p>
            <button type="button" className="danger-button" disabled={busy} onClick={() => void dissolveRoom()}>确认解散房间</button>
            <button type="button" className="text-link" disabled={busy} onClick={() => setConfirmDissolve(false)}>取消</button>
          </div>
        )}
      </section>
    </div>
  );
}

function WaitingPanel({ title, copy, hint, progress }: { title: string; copy: string; hint: string; progress?: string }) {
  return (
    <main className="waiting-panel sealed-state editorial-night-page">
      <div className="sealed-state__icon" aria-hidden="true"><ChaliceIcon /></div>
      <header>
        <h1>{title}</h1>
        <p>{copy}</p>
      </header>
      {progress && <strong className="sealed-state__progress">{progress}</strong>}
      <span className="privacy-hint"><ShieldLockIcon />{hint}</span>
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
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(value, { width: 300, margin: 1, color: { dark: "#17191c", light: "#fbfaf7" } })).then((url) => {
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
