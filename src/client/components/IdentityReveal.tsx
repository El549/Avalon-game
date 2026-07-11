import { useState, type KeyboardEvent, type PointerEvent } from "react";
import type { KnownPlayer, Role } from "@shared/contracts";
import { ROLE_DETAILS } from "@shared/contracts";
import { FingerprintIcon } from "../icons";

interface IdentityRevealProps {
  role: Role;
  knownPlayers: KnownPlayer[];
  onConfirm: () => Promise<void>;
}

export function IdentityReveal({ role, knownPlayers, onConfirm }: IdentityRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const [hasViewed, setHasViewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const details = ROLE_DETAILS[role];

  const reveal = () => {
    setRevealed(true);
    setHasViewed(true);
  };
  const hide = () => setRevealed(false);
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
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Some embedded browsers do not allow pointer capture; hold-to-reveal still works without it.
    }
    reveal();
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      // The room-level error banner explains the failure and lets the player retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`identity-screen identity-screen--${details.faction}`}>
      <div className="identity-screen__header">
        <p>你的身份</p>
        <h1 className={revealed ? "" : "identity-screen__blurred-title"}>{revealed ? details.name : "身份已隐藏"}</h1>
      </div>
      <div className={`identity-art ${revealed ? "identity-art--revealed" : ""}`} aria-hidden={!revealed}>
        <img src={details.asset} alt="" draggable={false} />
        <div className="identity-art__arch" />
      </div>
      <section className={`identity-details ${revealed ? "identity-details--revealed" : ""}`} aria-live="polite">
        {revealed ? (
          <>
            <h2>{details.name}</h2>
            <p className="identity-details__faction">你属于{details.faction === "good" ? "正义方" : "邪恶方"}</p>
            <p>{details.summary}</p>
            {knownPlayers.length > 0 && (
              <div className="known-players">
                <span>你知道</span>
                <div>
                  {knownPlayers.map((player) => (
                    <b key={player.playerId}>{player.seat}号 {player.nickname}</b>
                  ))}
                </div>
              </div>
            )}
            <p className="identity-details__objective">{details.objective}</p>
          </>
        ) : (
          <p className="identity-details__hidden-copy">只有按住下方封印时，身份信息才会出现。</p>
        )}
      </section>
      <button
        type="button"
        className={`hold-seal ${revealed ? "hold-seal--active" : ""}`}
        onPointerDown={onPointerDown}
        onPointerUp={hide}
        onPointerCancel={hide}
        onPointerLeave={hide}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="按住查看身份，松手隐藏"
      >
        <FingerprintIcon />
        <span>按住查看，松手隐藏</span>
      </button>
      <button type="button" className="primary-button" disabled={!hasViewed || busy || revealed} onClick={confirm}>
        {busy ? "确认中…" : "我已记住"}
      </button>
    </main>
  );
}
