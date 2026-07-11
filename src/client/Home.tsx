import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicRoomState, RejectionRule, RolePreset } from "@shared/contracts";
import { createExperienceRoom, createRoom, getPublicRoom, joinRoom } from "./api";
import { Brand } from "./components/Brand";
import { RoundTable } from "./components/RoundTable";
import { loadCredentials, saveCredentials } from "./session";

type Mode = "create" | "join" | "experience";

export function Home() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialCode = useMemo(() => searchParams.get("room")?.replace(/\D/g, "").slice(0, 6) ?? "", [searchParams]);
  const notice = useMemo(() => {
    const value = searchParams.get("notice");
    if (value === "left") return "你已离开桌局，原座位已经释放。";
    if (value === "dissolved") return "原桌局已解散，可以重新创建。";
    if (value === "unavailable") return "原桌局已经结束或失效，可以重新创建或加入其他桌局。";
    return null;
  }, [searchParams]);
  const [mode, setMode] = useState<Mode>(initialCode ? "join" : "create");
  const [nickname, setNickname] = useState("");
  const [playerCount, setPlayerCount] = useState(7);
  const [rolePreset, setRolePreset] = useState<RolePreset>("classic");
  const [rejectionRule, setRejectionRule] = useState<RejectionRule>("evil-wins");
  const [roomCode, setRoomCode] = useState(initialCode);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingSession = roomCode.length === 6 ? loadCredentials(roomCode) : null;

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
    <main className="home-shell">
      <Brand />
      <header className="home-heading">
        <h1>让秘密留在手机里，<br />让推理回到圆桌上。</h1>
        <p>身份、任务票和规则由圆桌助手处理；组队、表决与观察仍然面对面完成。</p>
      </header>
      <nav className="mode-tabs" aria-label="进入方式">
        <button type="button" className={mode === "create" ? "is-active" : ""} onClick={() => { setMode("create"); setError(null); }}>
          创建桌局
        </button>
        <button type="button" className={mode === "join" ? "is-active" : ""} onClick={() => { setMode("join"); setError(null); }}>
          加入桌局
        </button>
        <button type="button" className={mode === "experience" ? "is-active" : ""} onClick={() => { setMode("experience"); setError(null); }}>
          流程体验
        </button>
      </nav>

      {notice && <p className="entry-notice" role="status">{notice}</p>}

      {mode === "create" ? (
        <form className="entry-form" onSubmit={submitCreate}>
          <Field label="你的昵称">
            <input aria-label="你的昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="例如：林深" required />
          </Field>
          <Field label="玩家人数">
            <div className="number-options" role="group" aria-label="玩家人数">
              {[5, 6, 7, 8, 9, 10].map((count) => (
                <button type="button" key={count} className={playerCount === count ? "is-selected" : ""} aria-pressed={playerCount === count} onClick={() => setPlayerCount(count)}>
                  {count}
                </button>
              ))}
            </div>
          </Field>
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
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy || nickname.trim().length === 0}>{busy ? "正在创建…" : "创建桌局"}</button>
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
          {existingSession && (
            <button type="button" className="resume-link" onClick={() => window.location.assign(`/room/${roomCode}`)}>
              继续上次的桌局
            </button>
          )}
          {room && (
            <>
              <div className="room-preview">
                <p>{room.name}</p>
                <span>{room.players.length} / {room.settings.playerCount} 已就座</span>
              </div>
              <RoundTable
                players={room.players}
                playerCount={room.settings.playerCount}
                selectedSeats={seat ? [seat] : []}
                onEmptySeatSelect={setSeat}
                label="选择空座位"
              />
              <Field label="选择空座位">
                <div className="number-options" role="group" aria-label="选择空座位">
                  {Array.from({ length: room.settings.playerCount }, (_, index) => index + 1).map((candidate) => {
                    const occupied = room.players.some((player) => player.seat === candidate);
                    return (
                      <button type="button" key={candidate} disabled={occupied} className={seat === candidate ? "is-selected" : ""} aria-pressed={seat === candidate} onClick={() => setSeat(candidate)}>
                        {candidate}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="你的昵称">
                <input aria-label="你的昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="例如：阿乔" required />
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
            <span>两台手机即可体验</span>
            <h2>从认身份一路走到刺杀</h2>
            <p>第一台手机创建体验房间，第二台手机扫码坐到 2 号位；其余三名模拟玩家会自动完成操作。</p>
            <ol>
              <li>两台手机都能真实查看身份、组队和提交任务票</li>
              <li>公开表决仍在现场完成，由房主记录结果</li>
              <li>想体验刺杀，请让前三次任务成功</li>
            </ol>
          </div>
          <Field label="第一位体验者昵称">
            <input aria-label="第一位体验者昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} placeholder="例如：林深" required />
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy || nickname.trim().length === 0}>
            {busy ? "正在准备体验…" : "创建完整流程体验"}
          </button>
        </form>
      )}
      <footer className="home-footer">无需注册 · 不保存任务票与个人的对应关系</footer>
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
