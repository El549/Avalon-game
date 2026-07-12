import { useState } from "react";
import type { Faction, MissionOutcome } from "@shared/contracts";
import { ShieldLockIcon } from "../icons";

export function QuestBallot({
  missionNumber,
  faction,
  orderKey,
  onSubmit,
}: {
  missionNumber: number;
  faction: Faction;
  orderKey: string;
  onSubmit: (vote: MissionOutcome) => Promise<void>;
}) {
  const [selected, setSelected] = useState<MissionOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (value: MissionOutcome) => {
    if (busy) return;
    setSelected(value);
    setBusy(true);
    try {
      await onSubmit(value);
    } catch {
      // The room-level error banner explains the failure and keeps the ballot editable.
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };
  const options: MissionOutcome[] = failureComesFirst(orderKey)
    ? ["failure", "success"]
    : ["success", "failure"];
  return (
    <main className="ballot-screen editorial-paper-page">
      <header>
        <p>第 {missionNumber} 轮任务</p>
        <h1>秘密任务票</h1>
        <span>只有你能看到这个选择</span>
      </header>
      <div className="ballot-options" role="radiogroup" aria-label="任务票">
        {options.map((value) => (
          <BallotOption
            key={value}
            value={value}
            selected={selected === value}
            title={value === "success" ? "任务成功" : "任务失败"}
            copy={value === "success" ? "让任务顺利完成" : faction === "good" ? "你的身份不能选择此票" : "破坏本次任务"}
            disabled={value === "failure" && faction === "good"}
            busy={busy}
            onSelect={(vote) => void submit(vote)}
          />
        ))}
      </div>
      <p className="ballot-warning"><ShieldLockIcon />选择后立即封存</p>
    </main>
  );
}

function BallotOption({
  value,
  selected,
  title,
  copy,
  disabled,
  busy,
  onSelect,
}: {
  value: MissionOutcome;
  selected: boolean;
  title: string;
  copy: string;
  disabled: boolean;
  busy: boolean;
  onSelect: (value: MissionOutcome) => void;
}) {
  return (
    <button
      type="button"
      className={`ballot-option ballot-option--${value} ${selected ? "ballot-option--selected" : ""}`}
      role="radio"
      aria-checked={selected}
      disabled={disabled || busy}
      onClick={() => onSelect(value)}
    >
      <span>
        <strong>{title}</strong>
        <small>{disabled ? "正义阵营不可选择" : copy}</small>
      </span>
      <i aria-hidden="true" />
    </button>
  );
}

function failureComesFirst(orderKey: string): boolean {
  let hash = 0;
  for (const character of orderKey) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash & 1) === 1;
}
