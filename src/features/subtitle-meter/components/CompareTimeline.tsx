import { Fragment } from "react";
import type { CueDiff, VersionDiff } from "../diff/diffTypes";
import { formatClock } from "../diff/diffFormat";

interface CompareTimelineProps {
  diff: VersionDiff;
  labelA: string;
  labelB: string;
  activeKey: string | null;
  onSelect: (entry: CueDiff) => void;
}

const blockClass = (entry: CueDiff, side: "a" | "b") =>
  `compare-cue compare-cue-${entry.kind} ${
    side === "a" ? "compare-cue-a" : "compare-cue-b"
  }`;

/** 对比时间轴：双轨展示新旧两侧，漂移块用虚线轮廓标出旧位置 */
export function CompareTimeline({
  diff,
  labelA,
  labelB,
  activeKey,
  onSelect,
}: CompareTimelineProps) {
  const maxTime = Math.max(
    1000,
    ...diff.entries.map((entry) =>
      Math.max(entry.cueA?.endMs ?? 0, entry.cueB?.endMs ?? 0),
    ),
  );
  const position = (cue: NonNullable<CueDiff["cueA"]>) => ({
    left: `${(cue.startMs / maxTime) * 100}%`,
    width: `${Math.max(2.2, ((cue.endMs - cue.startMs) / maxTime) * 100)}%`,
  });

  return (
    <div className="compare-timeline" aria-label="差异时间轴">
      <div className="compare-ruler">
        <span>{formatClock(0)}</span>
        <span>{formatClock(maxTime / 2)}</span>
        <span>{formatClock(maxTime)}</span>
      </div>
      {(["a", "b"] as const).map((side) => (
        <div className="compare-rail-row" key={side}>
          <span className="compare-rail-label">
            {side === "a" ? labelA : labelB}
          </span>
          <div className="compare-rail">
            {diff.entries.map((entry) => {
              const cue = side === "a" ? entry.cueA : entry.cueB;
              const ghost =
                side === "b" && (entry.kind === "time" || entry.kind === "both")
                  ? entry.cueA
                  : null;
              if (!cue) return null;
              return (
                <Fragment key={entry.key}>
                  <button
                    data-diff-key={entry.key}
                    type="button"
                    title={`${side === "a" ? labelA : labelB} · 第 ${cue.index} 条`}
                    className={`${blockClass(entry, side)} ${
                      activeKey === entry.key ? "active" : ""
                    }`}
                    style={position(cue)}
                    onClick={() => onSelect(entry)}
                  >
                    {cue.index}
                  </button>
                  {ghost && (
                    <span
                      className="compare-cue-ghost"
                      style={position(ghost)}
                      aria-hidden
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
      <div className="compare-timeline-legend">
        <span>
          <i className="legend-text" />
          文本改动
        </span>
        <span>
          <i className="legend-time" />
          时间漂移
        </span>
        <span>
          <i className="legend-both" />
          两者都改
        </span>
        <span>
          <i className="legend-added" />
          新增
        </span>
        <span>
          <i className="legend-deleted" />
          删除
        </span>
        <span className="legend-ghost-note">虚线为漂移前位置</span>
      </div>
    </div>
  );
}
