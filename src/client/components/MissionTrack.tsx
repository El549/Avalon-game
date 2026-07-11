import type { PublicMission } from "@shared/contracts";

export function MissionTrack({ missions, currentIndex }: { missions: PublicMission[]; currentIndex: number }) {
  return (
    <ol className="mission-track" aria-label="任务进度">
      {missions.map((mission, index) => (
        <li
          key={mission.number}
          className={`mission-node ${mission.outcome ? `mission-node--${mission.outcome}` : ""} ${index === currentIndex ? "mission-node--current" : ""}`}
          aria-current={index === currentIndex ? "step" : undefined}
        >
          <span className="mission-node__marker">{mission.outcome === "success" ? "✦" : mission.outcome === "failure" ? "×" : mission.number}</span>
          <span className="mission-node__label">任务{toChineseNumber(mission.number)}</span>
          <span className="mission-node__state">
            {mission.outcome === "success" ? "成功" : mission.outcome === "failure" ? "失败" : index === currentIndex ? "当前" : `${mission.teamSize}人`}
          </span>
        </li>
      ))}
    </ol>
  );
}

function toChineseNumber(number: number): string {
  return ["", "一", "二", "三", "四", "五"][number] ?? String(number);
}
