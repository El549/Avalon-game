import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { KnownPlayer, Role } from "@shared/contracts";
import { ROLE_DETAILS } from "@shared/contracts";
import { EyeIcon } from "../icons";

interface IdentityRevealBaseProps {
  role: Role;
  knownPlayers: KnownPlayer[];
}

type IdentityRevealProps = IdentityRevealBaseProps & (
  | { mode?: "confirm"; onConfirm: () => Promise<void>; onClose?: never }
  | { mode: "review"; onClose: () => void; onConfirm?: never }
);

export function IdentityReveal(props: IdentityRevealProps) {
  const { role, knownPlayers } = props;
  const mode = props.mode ?? "confirm";
  const [revealed, setRevealed] = useState(false);
  const [hasViewed, setHasViewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const details = ROLE_DETAILS[role];
  const isReview = mode === "review";

  const reveal = () => {
    setRevealed(true);
    setHasViewed(true);
  };
  const hide = () => setRevealed(false);

  useEffect(() => {
    if (!revealed) return;
    const hideOnRelease = () => setRevealed(false);
    const hideWhenBackgrounded = () => {
      if (document.visibilityState !== "visible") setRevealed(false);
    };
    window.addEventListener("pointerup", hideOnRelease);
    window.addEventListener("pointercancel", hideOnRelease);
    window.addEventListener("blur", hideOnRelease);
    document.addEventListener("visibilitychange", hideWhenBackgrounded);
    return () => {
      window.removeEventListener("pointerup", hideOnRelease);
      window.removeEventListener("pointercancel", hideOnRelease);
      window.removeEventListener("blur", hideOnRelease);
      document.removeEventListener("visibilitychange", hideWhenBackgrounded);
    };
  }, [revealed]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      reveal();
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") hide();
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Global release listeners still hide the card in embedded browsers without pointer capture.
    }
    reveal();
  };

  const confirm = async () => {
    if (props.mode === "review") return;
    setBusy(true);
    try {
      await props.onConfirm();
    } catch {
      // The room-level error banner explains the failure and lets the player retry.
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <>
      <header className="identity-screen__header">
        <h1>你的身份</h1>
      </header>

      <div className={`identity-vault ${revealed ? "identity-vault--revealed" : ""}`}>
        {revealed ? (
          <div className="identity-details" aria-live="polite">
            <h2>{details.name}</h2>
            <p className="identity-details__faction">{details.faction === "good" ? "正义阵营" : "邪恶阵营"}</p>
            <p>{details.summary}</p>
            {knownPlayers.length > 0 ? (
              <div className="known-players">
                <span className="editorial-divider"><b>你能看到</b></span>
                <div>
                  {knownPlayers.map((player) => (
                    <b key={player.playerId}><i>{player.seat}号</i><span>{player.nickname}</span></b>
                  ))}
                </div>
              </div>
            ) : (
              <div className="known-players known-players--empty">
                <span className="editorial-divider"><b>你能看到</b></span>
                <p className="identity-details__knowledge">没有额外可确认的身份信息</p>
              </div>
            )}
          </div>
        ) : (
          <div className="identity-vault__hidden" aria-hidden="true">
            <strong>身份已隐藏</strong>
            <span>确认周围没有人看屏幕后，按住底部按钮查看。</span>
          </div>
        )}
      </div>

      <div className="identity-action-dock">
        <button
          type="button"
          className={`hold-seal ${revealed ? "hold-seal--active" : ""}`}
          onPointerDown={onPointerDown}
          onPointerUp={hide}
          onPointerCancel={hide}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={hide}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="按住查看身份，松手隐藏"
        >
          <EyeIcon />
          <span>按住查看身份</span>
        </button>
        {isReview ? (
          <button type="button" className="identity-close-button" disabled={revealed} onClick={() => props.mode === "review" && props.onClose()}>关闭</button>
        ) : (
          <button type="button" className="identity-confirm-button" aria-label="我已记住" disabled={!hasViewed || busy || revealed} onClick={() => void confirm()}>
            {busy ? "确认中…" : "我已记住"}
          </button>
        )}
      </div>
    </>
  );

  if (!isReview) {
    return <main className={`identity-screen identity-screen--${details.faction}`}>{content}</main>;
  }
  return (
    <div className="identity-review-overlay" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !revealed && props.mode === "review") props.onClose();
    }}>
      <section
        className={`identity-screen identity-screen--${details.faction} identity-screen--review`}
        role="dialog"
        aria-modal="true"
        aria-label="查看我的身份"
      >
        {content}
      </section>
    </div>
  );
}
