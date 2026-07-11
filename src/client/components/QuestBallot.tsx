import { useState } from "react";
import type { Faction, MissionOutcome } from "@shared/contracts";
import { BrokenCrownIcon, SwordIcon } from "../icons";

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
  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await onSubmit(selected);
    } catch {
      // The room-level error banner explains the failure and keeps the ballot editable.
    } finally {
      setBusy(false);
    }
  };
  const options: MissionOutcome[] = failureComesFirst(orderKey)
    ? ["failure", "success"]
    : ["success", "failure"];
  return (
    <main className="ballot-screen">
      <header>
        <p>第 {missionNumber} 轮任务</p>
        <span>你在任务队伍中</span>
        <h1>秘密选择一张任务票</h1>
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
            onSelect={setSelected}
          />
        ))}
      </div>
      <p className="ballot-warning">选择确认后不能更改</p>
      <button type="button" className="primary-button" disabled={!selected || busy} onClick={submit}>
        {busy ? "封存中…" : "确认任务票"}
      </button>
    </main>
  );
}

function BallotOption({
  value,
  selected,
  title,
  copy,
  disabled,
  onSelect,
}: {
  value: MissionOutcome;
  selected: boolean;
  title: string;
  copy: string;
  disabled: boolean;
  onSelect: (value: MissionOutcome) => void;
}) {
  return (
    <button
      type="button"
      className={`ballot-option ballot-option--${value} ${selected ? "ballot-option--selected" : ""}`}
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(value)}
    >
      <span className="ballot-option__icon">{value === "success" ? <SwordIcon /> : <BrokenCrownIcon />}</span>
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
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
