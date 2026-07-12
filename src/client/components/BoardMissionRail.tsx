import type { PublicMission } from "@shared/contracts";

export interface BoardMissionRailProps {
  missions: PublicMission[];
  currentIndex: number;
  rejectionCount: number;
}

export function BoardMissionRail({ missions, currentIndex, rejectionCount }: BoardMissionRailProps) {
  const safeRejectionCount = Math.max(0, Math.min(5, rejectionCount));

  return (
    <section className="board-mission-rail" aria-label="否决次数与任务进度">
      <div className="board-mission-rail__rejections" aria-label={`连续否决 ${safeRejectionCount} 次，最多 5 次`}>
        <div className="board-mission-rail__rejection-title">
          <BoardRaisedHandIcon />
          <span>连续否决</span>
        </div>
        <p className="board-mission-rail__rejection-count">
          <strong>{safeRejectionCount}</strong>
          <span>/ 5</span>
        </p>
        <ol className="board-mission-rail__rejection-dots" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <li
              key={index}
              className={[
                "board-mission-rail__rejection-dot",
                index < safeRejectionCount ? "board-mission-rail__rejection-dot--filled" : "",
                index === safeRejectionCount && safeRejectionCount < 5 ? "board-mission-rail__rejection-dot--next" : "",
              ].filter(Boolean).join(" ")}
            />
          ))}
        </ol>
      </div>

      <ol className="board-mission-rail__missions" aria-label="五轮任务">
        {missions.slice(0, 5).map((mission, index) => {
          const isCurrent = index === currentIndex;
          const state = mission.outcome ?? (isCurrent ? "current" : index < currentIndex ? "past" : "pending");
          return (
            <li
              key={mission.number}
              className={`board-mission-rail__mission board-mission-rail__mission--${state}${isCurrent ? " board-mission-rail__mission--current" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={getMissionLabel(mission, isCurrent)}
            >
              <div className="board-mission-rail__mission-marker" aria-hidden="true">
                <BoardMissionStar />
                <span className="board-mission-rail__mission-symbol">
                  {mission.outcome === "success" ? "✦" : mission.outcome === "failure" ? "×" : mission.number}
                </span>
              </div>
              <span className="board-mission-rail__mission-title">任务{toChineseNumber(mission.number)}</span>
              <span className="board-mission-rail__mission-state">
                {mission.outcome === "success"
                  ? "成功"
                  : mission.outcome === "failure"
                    ? "失败"
                    : isCurrent
                      ? "当前"
                      : "待进行"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function BoardRaisedHandIcon() {
  return (
    <svg className="board-mission-rail__hand" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M10.4 15.3V6.8a2.1 2.1 0 0 1 4.2 0v6.1-8.1a2.1 2.1 0 0 1 4.2 0v8.1-6.6a2 2 0 1 1 4 0v8.2-4a2 2 0 1 1 4 0v8.4c0 6.1-4.1 10.1-10.1 10.1h-1.4c-3.5 0-6-1.5-8-4.4L3.8 19a2.3 2.3 0 0 1 3.7-2.7l2.9 3.4v-4.4Z" />
      <path d="M5.7 9.2 2.8 6.7M7.5 5.4 6.4 1.8M27.4 5.6l2.2-3" />
    </svg>
  );
}

function BoardMissionStar() {
  return (
    <svg className="board-mission-rail__mission-star" viewBox="0 0 72 72" fill="none">
      <circle className="board-mission-rail__mission-ring board-mission-rail__mission-ring--outer" cx="36" cy="36" r="25.5" />
      <circle className="board-mission-rail__mission-ring board-mission-rail__mission-ring--inner" cx="36" cy="36" r="20" />
      <path className="board-mission-rail__mission-rays" d="M36 2v8M36 62v8M2 36h8M62 36h8M12 12l6 6M54 54l6 6M60 12l-6 6M18 54l-6 6M23 5l3 8M46 59l3 8M5 23l8 3M59 46l8 3M49 5l-3 8M26 59l-3 8M67 23l-8 3M13 46l-8 3" />
      <path className="board-mission-rail__mission-diamond" d="m36 14 5 5-5 5-5-5 5-5ZM36 48l5 5-5 5-5-5 5-5ZM14 36l5-5 5 5-5 5-5-5ZM48 36l5-5 5 5-5 5-5-5Z" />
    </svg>
  );
}

function getMissionLabel(mission: PublicMission, isCurrent: boolean): string {
  const state = mission.outcome === "success"
    ? "成功"
    : mission.outcome === "failure"
      ? "失败"
      : isCurrent
        ? "当前任务"
        : "尚未开始";
  return `任务${toChineseNumber(mission.number)}，${mission.teamSize}人，${state}`;
}

function toChineseNumber(number: number): string {
  return ["", "一", "二", "三", "四", "五"][number] ?? String(number);
}
