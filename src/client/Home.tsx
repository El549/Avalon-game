import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicRoomState, RejectionRule, RolePreset } from "@shared/contracts";
import { ApiError, createExperienceRoom, createRoom, getPublicRoom, getSession, joinRoom } from "./api";
import { PlayerRoster } from "./components/PlayerRoster";
import { SwordCrownEmblem } from "./icons";
import { clearCredentials, loadCredentials, loadLatestCredentials, saveCredentials } from "./session";

type Mode = "create" | "join" | "experience";

export function Home() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialCode = useMemo(() => searchParams.get("room")?.replace(/\D/g, "").slice(0, 6) ?? "", [searchParams]);
  const notice = useMemo(() => {
    const value = searchParams.get("notice");
    if (value === "left") return "你已离开桌局，原座位已经释放。";
    if (value === "dissolved") return "原桌局已解散，可以重新创建。";
    if (value === "unavailable") return "原桌局已经结束或失效，可以重新创建或加入其他桌局。";
    if (value === "removed") return "你已被房主移出原桌局，可以加入其他房间。";
    if (value === "session-invalid") return "原座位已被释放或身份已经失效，请重新选择空座位加入。";
    return null;
  }, [searchParams]);
  const [mode, setMode] = useState<Mode>(initialCode ? "join" : "create");
  const [nickname, setNickname] = useState("");
  const [playerCount, setPlayerCount] = useState(5);
  const [rolePreset, setRolePreset] = useState<RolePreset>("classic");
  const [rejectionRule, setRejectionRule] = useState<RejectionRule>("evil-wins");
  const [roomCode, setRoomCode] = useState(initialCode);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestSession, setLatestSession] = useState(() => initialCode ? null : loadLatestCredentials());
  const [latestRoom, setLatestRoom] = useState<PublicRoomState | null>(null);
  const [latestRoomError, setLatestRoomError] = useState<string | null>(null);
  const existingSession = roomCode.length === 6 ? loadCredentials(roomCode) : null;

  useEffect(() => {
    if (!latestSession) return;
    let cancelled = false;
    void getSession(latestSession).then((snapshot) => {
      if (!cancelled) {
        setLatestRoom(snapshot.public);
        setLatestRoomError(null);
      }
    }).catch((cause: unknown) => {
      const sessionIsInvalid = cause instanceof ApiError
        && (cause.status === 401 || cause.status === 404 || cause.code === "INVALID_SESSION" || cause.code === "ROOM_NOT_FOUND");
      if (sessionIsInvalid) clearCredentials(latestSession.roomCode);
      if (!cancelled) {
        if (sessionIsInvalid) {
          setLatestSession(null);
          setLatestRoom(null);
        } else {
          setLatestRoomError("暂时无法确认房间状态，仍可尝试返回");
        }
      }
    });
    return () => { cancelled = true; };
  }, [latestSession]);

  const lookupRoom = useCallback(async (code = roomCode) => {
    if (code.length !== 6) {
      setError("请输入 6 位房间号");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await getPublicRoom(code);
      setRoom(result);
      const firstOpenSeat = Array.from({ length: result.settings.playerCount }, (_, index) => index + 1).find(
        (candidate) => !result.players.some((player) => player.seat === candidate),
      );
      setSeat(firstOpenSeat ?? null);
    } catch (cause) {
      setRoom(null);
      setSeat(null);
      setError(cause instanceof Error ? cause.message : "找不到房间");
    } finally {
      setBusy(false);
    }
  }, [roomCode]);

  useEffect(() => {
    if (initialCode.length !== 6) return;
    const timer = window.setTimeout(() => void lookupRoom(initialCode), 0);
    return () => window.clearTimeout(timer);
  }, [initialCode, lookupRoom]);

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createRoom({ nickname, playerCount, rolePreset, rejectionRule });
      saveCredentials(result.credentials);
      window.location.assign(`/room/${result.credentials.roomCode}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!room) {
      await lookupRoom();
      return;
    }
    if (!seat) {
      setError("请选择一个空座位");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await joinRoom(room.code, { nickname, seat });
      saveCredentials(result.credentials);
      window.location.assign(`/room/${result.credentials.roomCode}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入失败");
    } finally {
      setBusy(false);
    }
  };

  const submitExperience = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createExperienceRoom(nickname);
      saveCredentials(result.credentials);
      window.location.assign(`/room/${result.credentials.roomCode}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "体验房间创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="editorial-home">
      <header className="entry-hero">
        <SwordCrownEmblem className="entry-hero__emblem" />
        <h1>圆桌助手</h1>
        <p><span>秘密留在手机，推理留在桌上</span></p>
        <div className="entry-hero__landscape" aria-hidden="true" />
      </header>

      <section className="entry-panel">
        <nav className="mode-tabs" aria-label="进入方式">
          <button type="button" className={mode === "create" ? "is-active" : ""} onClick={() => { setMode("create"); setError(null); }}>
            创建房间
          </button>
          <button type="button" className={mode === "join" ? "is-active" : ""} onClick={() => { setMode("join"); setError(null); }}>
            加入房间
          </button>
          <button type="button" className={mode === "experience" ? "is-active" : ""} onClick={() => { setMode("experience"); setError(null); }}>
            流程体验
          </button>
        </nav>

        {notice && <p className="entry-notice" role="status">{notice}</p>}
        {latestSession && (
          <button type="button" className="latest-session-card" onClick={() => window.location.assign(`/room/${latestSession.roomCode}`)}>
            <span>继续上次桌局</span>
            <strong>{latestRoom?.name ?? "上次桌局"}</strong>
            <small>
              房间号 {formatRoomCode(latestSession.roomCode)}
              {latestRoom && ` · ${latestRoom.players.find((player) => player.id === latestSession.playerId)?.seat}号座位`}
              {latestRoomError && ` · ${latestRoomError}`}
            </small>
          </button>
        )}

        {mode === "create" ? (
          <form className="entry-form" onSubmit={submitCreate}>
            <Field label="你的昵称">
              <input aria-label="你的昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="请输入昵称" required />
            </Field>
            <Field label="玩家人数">
              <select aria-label="玩家人数" value={playerCount} onChange={(event) => setPlayerCount(Number(event.target.value))}>
                {[5, 6, 7, 8, 9, 10].map((count) => <option key={count} value={count}>{count} 人</option>)}
              </select>
            </Field>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={busy || nickname.trim().length === 0}>{busy ? "正在创建…" : "创建房间"}</button>
            <details className="entry-rules">
              <summary>规则设置</summary>
              <Field label="角色组合">
                <ChoiceRow
                  groupLabel="角色组合"
                  value={rolePreset}
                  onChange={(value) => setRolePreset(value as RolePreset)}
                  options={[
                    { value: "classic", title: "经典", copy: "梅林、派西维尔、刺客与莫甘娜" },
                    { value: "advanced", title: "进阶", copy: "人数允许时加入莫德雷德与奥伯伦" },
                  ]}
                />
              </Field>
              <Field label="五次否决规则">
                <ChoiceRow
                  groupLabel="五次否决规则"
                  value={rejectionRule}
                  onChange={(value) => setRejectionRule(value as RejectionRule)}
                  options={[
                    { value: "evil-wins", title: "邪恶获胜", copy: "连续五次否决后结束游戏" },
                    { value: "fifth-auto", title: "第五队强制出发", copy: "第四次否决后，下支队伍直接执行任务" },
                  ]}
                />
              </Field>
            </details>
          </form>
        ) : mode === "join" ? (
          <form className="entry-form" onSubmit={submitJoin}>
            <Field label="房间号">
              <div className="room-code-input">
                <input
                  aria-label="房间号"
                  inputMode="numeric"
                  value={roomCode}
                  onChange={(event) => { setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setRoom(null); setSeat(null); }}
                  placeholder="6 位数字"
                  maxLength={6}
                  required
                />
                <button type="button" onClick={() => void lookupRoom()} disabled={busy || roomCode.length !== 6}>查看</button>
              </div>
            </Field>
            {existingSession && <button type="button" className="resume-link" onClick={() => window.location.assign(`/room/${roomCode}`)}>继续上次的桌局</button>}
            {room && (
              <>
                <div className="room-preview"><p>{room.name}</p><span>{room.players.length} / {room.settings.playerCount} 已就座</span></div>
                <PlayerRoster players={room.players} playerCount={room.settings.playerCount} mode="join" selectedSeat={seat} onSeatSelect={setSeat} label="选择空座位" />
                <Field label="你的昵称">
                  <input aria-label="你的昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="请输入昵称" required />
                </Field>
              </>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={busy || !room || !seat || nickname.trim().length === 0}>
              {busy ? "正在加入…" : room ? "确认座位并加入" : "先查看房间"}
            </button>
          </form>
        ) : (
          <form className="entry-form" onSubmit={submitExperience}>
            <div className="experience-intro">
              <h2>两台手机，体验完整一局</h2>
              <p>其余三名玩家由系统代为操作，身份、组队、任务与刺杀流程都会真实保留。</p>
            </div>
            <Field label="第一位体验者昵称">
              <input aria-label="第一位体验者昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="请输入昵称" required />
            </Field>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={busy || nickname.trim().length === 0}>
              {busy ? "正在准备体验…" : "创建完整流程体验"}
            </button>
          </form>
        )}
        <footer className="home-footer">无需注册 · 不保存任务票与个人的对应关系</footer>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><span>{label}</span>{children}</div>;
}

function ChoiceRow({
  groupLabel,
  value,
  onChange,
  options,
}: {
  groupLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; title: string; copy: string }[];
}) {
  return (
    <div className="choice-row" role="group" aria-label={groupLabel}>
      {options.map((option) => (
        <button type="button" key={option.value} className={value === option.value ? "is-selected" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          <strong>{option.title}</strong>
          <small>{option.copy}</small>
        </button>
      ))}
    </div>
  );
}

function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
