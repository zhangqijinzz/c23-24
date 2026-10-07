import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleCue } from "../models";
import {
  diffCueSets,
  formatCueTime,
  formatDelta,
  TEXT_PAIR_SIMILARITY,
  TIME_DRIFT_NOTE_MS,
  TIME_PAIR_GATE_MS,
  type ChangeKind,
  type CueChange,
  type LineChange,
  type TextSegment,
} from "../comparison/cueDiff";

export interface CompareSide {
  id: string;
  label: string;
  hint: string;
  cues: SubtitleCue[];
}

const filterDefs: Array<{ id: ChangeKind | "all"; label: string }> = [
  { id: "all", label: "全部" },
  { id: "added", label: "新增" },
  { id: "removed", label: "删除" },
  { id: "text", label: "文本改动" },
  { id: "time", label: "时间漂移" },
  { id: "both", label: "文本＋时间" },
];
const kindLabels: Record<ChangeKind, string> = {
  added: "新增",
  removed: "删除",
  text: "文本改动",
  time: "时间漂移",
  both: "文本＋时间",
};

function cueIndex(cue: SubtitleCue | null): number | null {
  return cue?.index ?? null;
}

function Segments({ segments }: { segments: TextSegment[] }) {
  return (
    <>
      {segments.map((segment, i) => (
        <span key={i} className={`diff-seg diff-seg-${segment.kind}`}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

function LineDiff({ line }: { line: LineChange }) {
  const marker =
    line.kind === "removed"
      ? { char: "−", cls: "removed" }
      : line.kind === "added"
        ? { char: "＋", cls: "added" }
        : line.segments
          ? { char: "改", cls: "changed" }
          : { char: " ", cls: "equal" };
  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-gutter">
        <span className="diff-lineno">{line.oldLineNo ?? ""}</span>
        <span className="diff-lineno new">{line.newLineNo ?? ""}</span>
      </span>
      <span className={`diff-marker diff-marker-${marker.cls}`}>
        {marker.char}
      </span>
      <span className="diff-line-text">
        {line.segments ? (
          <Segments segments={line.segments} />
        ) : line.text ? (
          line.text
        ) : (
          " "
        )}
      </span>
    </div>
  );
}

function TimeDrift({ change }: { change: CueChange }) {
  if (!change.time || !change.oldCue || !change.newCue) return null;
  return (
    <div className="diff-time">
      <span className="diff-time-row old">
        <i>旧</i>
        {formatCueTime(change.oldCue)}
      </span>
      <span className="diff-time-delta">
        <em>开始 {formatDelta(change.time.startDeltaMs)}</em>
        <em>结束 {formatDelta(change.time.endDeltaMs)}</em>
      </span>
      <span className="diff-time-row new">
        <i>新</i>
        {formatCueTime(change.newCue)}
      </span>
    </div>
  );
}

export function CompareModule({
  left,
  right,
  onClose,
}: {
  left: CompareSide;
  right: CompareSide;
  onClose: () => void;
}) {
  const diff = useMemo(() => diffCueSets(left.cues, right.cues), [left, right]);
  const [filter, setFilter] = useState<ChangeKind | "all">("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const laneRefs = useRef({
    old: null as HTMLDivElement | null,
    mid: null as HTMLDivElement | null,
    new: null as HTMLDivElement | null,
  });
  const trackScrollRef = useRef(false);
  const setLaneRef =
    (side: "old" | "mid" | "new") => (element: HTMLDivElement | null) => {
      laneRefs.current[side] = element;
    };

  const visibleChanges = useMemo(
    () =>
      filter === "all"
        ? diff.changes
        : diff.changes.filter((change) => change.kind === filter),
    [diff, filter],
  );

  // 切换筛选或重新对比后，保持选中项有效；无效则落到第一条
  useEffect(() => {
    if (activeId && visibleChanges.some((change) => change.id === activeId))
      return;
    setActiveId(visibleChanges[0]?.id ?? null);
  }, [visibleChanges, activeId]);

  const activeChange =
    visibleChanges.find((change) => change.id === activeId) ?? null;
  const activePosition = activeChange
    ? visibleChanges.findIndex((change) => change.id === activeChange.id)
    : -1;

  // 两条时间轴共享同一时间刻度，并排滚动保持对齐
  const maxTime = useMemo(
    () =>
      Math.max(
        1000,
        ...left.cues.map((cue) => cue.endMs),
        ...right.cues.map((cue) => cue.endMs),
      ),
    [left, right],
  );

  const scrollTrackTo = useCallback((timeMs: number, trackMaxTime: number) => {
    const pct = Math.min(100, Math.max(0, (timeMs / trackMaxTime) * 100));
    const syncTo = (other: HTMLDivElement | null) => {
      if (!other) return;
      const target = ((pct - 25) / 100) * other.scrollWidth;
      other.scrollTo({
        left: Math.max(0, Math.min(other.scrollWidth, target)),
        behavior: "smooth",
      });
    };
    trackScrollRef.current = true;
    syncTo(laneRefs.current.old);
    syncTo(laneRefs.current.mid);
    syncTo(laneRefs.current.new);
    window.setTimeout(() => {
      trackScrollRef.current = false;
    }, 450);
  }, []);

  const activate = useCallback(
    (change: CueChange) => {
      setActiveId(change.id);
      rowRefs.current
        .get(change.id)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const cue = change.newCue ?? change.oldCue;
      if (cue) scrollTrackTo(cue.startMs, maxTime);
    },
    [maxTime, scrollTrackTo],
  );

  // 三条轨道（基线、连接线、对比）并排滚动保持对齐
  const syncLanes = (source: "old" | "new") => {
    if (trackScrollRef.current) return;
    const from = laneRefs.current[source];
    if (!from) return;
    const others = [
      laneRefs.current[source === "old" ? "new" : "old"],
      laneRefs.current.mid,
    ];
    others.forEach((other) => {
      if (other) other.scrollLeft = from.scrollLeft;
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT")
      )
        return;
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!visibleChanges.length) return;
        event.preventDefault();
        const current = activePosition >= 0 ? activePosition : -1;
        const next =
          event.key === "ArrowDown"
            ? Math.min(visibleChanges.length - 1, current + 1)
            : Math.max(0, current - 1);
        activate(visibleChanges[next]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, visibleChanges, activePosition, activate]);

  const jumpTo = (step: number) => {
    if (!visibleChanges.length) return;
    const base = activePosition < 0 ? -step : activePosition;
    const clamped = Math.max(
      0,
      Math.min(visibleChanges.length - 1, base + step),
    );
    activate(visibleChanges[clamped]);
  };

  const renderCueBlock = (
    cue: SubtitleCue,
    side: "old" | "new",
    change: CueChange | undefined,
  ) => {
    const isActive = change?.id === activeId;
    return (
      <button
        key={`${side}-${cue.id}`}
        type="button"
        className={[
          "compare-cue",
          change ? `compare-cue-${change.kind}` : "compare-cue-same",
          isActive ? "active" : "",
        ].join(" ")}
        style={{
          left: `${(cue.startMs / maxTime) * 100}%`,
          width: `${Math.max(2, ((cue.endMs - cue.startMs) / maxTime) * 100)}%`,
        }}
        title={`第 ${cue.index} 条 · ${formatCueTime(cue)}`}
        onClick={() => change && activate(change)}
      >
        {cue.index}
      </button>
    );
  };

  const pairChangeById = useMemo(() => {
    const map = new Map<string, CueChange>();
    for (const change of diff.changes) {
      if (change.oldCue) map.set(`old-${change.oldCue.id}`, change);
      if (change.newCue) map.set(`new-${change.newCue.id}`, change);
    }
    return map;
  }, [diff]);

  const connectors = diff.changes.filter(
    (change) => change.oldCue && change.newCue,
  );

  return (
    <div
      className="compare-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="版本对比"
    >
      <div className="compare-dialog">
        <header className="compare-header">
          <div>
            <span className="module-kicker">VERSION COMPARE · 只读视图</span>
            <h2>版本对比</h2>
          </div>
          <div className="compare-nav">
            <button
              type="button"
              onClick={() => jumpTo(-1)}
              disabled={!visibleChanges.length}
            >
              ↑ 上一条
            </button>
            <span className="compare-position">
              {visibleChanges.length
                ? `${activePosition + 1} / ${visibleChanges.length}`
                : "0 / 0"}
            </span>
            <button
              type="button"
              onClick={() => jumpTo(1)}
              disabled={!visibleChanges.length}
            >
              下一条 ↓
            </button>
            <button type="button" className="compare-close" onClick={onClose}>
              退出对比 ✕
            </button>
          </div>
        </header>

        <div className="compare-sides">
          <div className="compare-side">
            <strong>{left.label}</strong>
            <small>{left.hint}</small>
          </div>
          <span className="compare-arrow">→</span>
          <div className="compare-side">
            <strong>{right.label}</strong>
            <small>{right.hint}</small>
          </div>
        </div>

        <div className="compare-timeline">
          <div className="compare-lane-row">
            <span className="compare-lane-tag">基线</span>
            <div
              className="compare-lane"
              ref={setLaneRef("old")}
              onScroll={() => syncLanes("old")}
            >
              <div
                className="compare-lane-inner"
                style={{ width: `${Math.max(100, maxTime / 120)}%` }}
              >
                {left.cues.map((cue) =>
                  renderCueBlock(
                    cue,
                    "old",
                    pairChangeById.get(`old-${cue.id}`),
                  ),
                )}
              </div>
            </div>
          </div>
          <div className="compare-lane-row connector-row">
            <span className="compare-lane-tag" />
            <div
              className="compare-lane connector-lane"
              ref={setLaneRef("mid")}
            >
              <div
                className="compare-lane-inner"
                style={{ width: `${Math.max(100, maxTime / 120)}%` }}
              >
                <svg className="compare-connectors" aria-hidden="true">
                  {connectors.map((change) => (
                    <line
                      key={change.id}
                      className={`compare-connector compare-connector-${change.kind}${change.id === activeId ? " active" : ""}`}
                      x1={`${((change.oldCue!.startMs + change.oldCue!.endMs) / 2 / maxTime) * 100}%`}
                      y1="0"
                      x2={`${((change.newCue!.startMs + change.newCue!.endMs) / 2 / maxTime) * 100}%`}
                      y2="100%"
                    />
                  ))}
                </svg>
              </div>
            </div>
          </div>
          <div className="compare-lane-row">
            <span className="compare-lane-tag">对比</span>
            <div
              className="compare-lane"
              ref={setLaneRef("new")}
              onScroll={() => syncLanes("new")}
            >
              <div
                className="compare-lane-inner"
                style={{ width: `${Math.max(100, maxTime / 120)}%` }}
              >
                {right.cues.map((cue) =>
                  renderCueBlock(
                    cue,
                    "new",
                    pairChangeById.get(`new-${cue.id}`),
                  ),
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="compare-filters">
          {filterDefs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "active" : ""}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <em>
                {item.id === "all"
                  ? diff.changes.length
                  : diff.changes.filter((change) => change.kind === item.id)
                      .length}
              </em>
            </button>
          ))}
        </div>

        <div className="compare-list">
          {visibleChanges.length === 0 ? (
            <div className="compare-empty">两份内容没有可显示的差异</div>
          ) : (
            visibleChanges.map((change) => (
              <div
                key={change.id}
                ref={(element) => {
                  if (element) rowRefs.current.set(change.id, element);
                  else rowRefs.current.delete(change.id);
                }}
                className={[
                  "change-card",
                  `change-${change.kind}`,
                  change.id === activeId ? "active" : "",
                ].join(" ")}
                onClick={() => activate(change)}
              >
                <div className="change-head">
                  <span className={`change-badge badge-${change.kind}`}>
                    {kindLabels[change.kind]}
                  </span>
                  <span className="change-index">
                    {change.kind === "added"
                      ? `#${cueIndex(change.newCue)}`
                      : change.kind === "removed"
                        ? `#${cueIndex(change.oldCue)}`
                        : `#${cueIndex(change.oldCue)} → #${cueIndex(change.newCue)}`}
                  </span>
                  <TimeDrift change={change} />
                </div>
                {change.lineChanges && (
                  <div className="diff-lines">
                    {change.lineChanges.map((line, i) => (
                      <LineDiff key={i} line={line} />
                    ))}
                  </div>
                )}
                {change.kind === "removed" && change.oldCue && (
                  <div className="diff-lines">
                    {change.oldCue.text.split("\n").map((text, i) => (
                      <div key={i} className="diff-line diff-line-removed">
                        <span className="diff-gutter">
                          <span className="diff-lineno">{i + 1}</span>
                          <span className="diff-lineno new" />
                        </span>
                        <span className="diff-marker diff-marker-removed">
                          −
                        </span>
                        <span className="diff-line-text">{text}</span>
                      </div>
                    ))}
                  </div>
                )}
                {change.kind === "added" && change.newCue && (
                  <div className="diff-lines">
                    {change.newCue.text.split("\n").map((text, i) => (
                      <div key={i} className="diff-line diff-line-added">
                        <span className="diff-gutter">
                          <span className="diff-lineno" />
                          <span className="diff-lineno new">{i + 1}</span>
                        </span>
                        <span className="diff-marker diff-marker-added">
                          ＋
                        </span>
                        <span className="diff-line-text">{text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <footer className="compare-foot">
          <span>
            配对规则：起止时间差值均 ≤ {TIME_PAIR_GATE_MS / 1000}
            秒、且文本相似度 ≥ {Math.round(TEXT_PAIR_SIMILARITY * 100)}%
            才视为同一条；越过阈值的条目按新增/删除处理。漂移 ≤{" "}
            {TIME_DRIFT_NOTE_MS}ms 不计为时间改动。
          </span>
          <span>仅用于查看，不会改动当前编辑内容与选中位置</span>
        </footer>
      </div>
    </div>
  );
}
