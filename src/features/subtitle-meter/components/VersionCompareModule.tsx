import { useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleProject } from "../models";
import { formatTimestamp } from "../parsers/timecode";
import { compareVersions } from "../diff/cueDiff";
import type { CueDiff, DiffChangeKind, DiffSide } from "../diff/diffTypes";
import { formatSavedAt, formatSignedDelta } from "../diff/diffFormat";
import { CompareTimeline } from "./CompareTimeline";
import { TextDiffLines } from "./TextDiffLines";

type FilterKind = "all" | "added" | "deleted" | "text" | "time";
const filters: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "added", label: "新增" },
  { id: "deleted", label: "删除" },
  { id: "text", label: "文本改动" },
  { id: "time", label: "时间漂移" },
];

const kindLabel: Record<DiffChangeKind, string> = {
  added: "新增",
  deleted: "删除",
  text: "文本",
  time: "时间",
  both: "文本+时间",
  same: "未变",
};

const matchesFilter = (kind: DiffChangeKind, filter: FilterKind) =>
  filter === "all"
    ? true
    : filter === "text"
      ? kind === "text" || kind === "both"
      : filter === "time"
        ? kind === "time" || kind === "both"
        : kind === filter;

export interface CompareSelection {
  sideAId: string;
  sideBId: string;
}

interface VersionCompareModuleProps {
  project: SubtitleProject;
  initial: CompareSelection;
  onClose: () => void;
}

export function VersionCompareModule({
  project,
  initial,
  onClose,
}: VersionCompareModuleProps) {
  const [sideAId, setSideAId] = useState(initial.sideAId);
  const [sideBId, setSideBId] = useState(initial.sideBId);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => [
      {
        id: "current",
        label: "当前内容",
        detail: "编辑中 · 未存为快照",
        cues: project.cues,
      },
      ...project.versions.map((version) => ({
        id: version.id,
        label: version.label,
        detail: formatSavedAt(version.savedAt),
        cues: version.cues,
      })),
    ],
    [project],
  );
  const sideA = useMemo<DiffSide>(() => {
    const option = options.find((item) => item.id === sideAId) ?? options[0];
    return { id: option.id, label: option.label, cues: option.cues };
  }, [options, sideAId]);
  const sideB = useMemo<DiffSide>(() => {
    const option = options.find((item) => item.id === sideBId) ?? options[0];
    return { id: option.id, label: option.label, cues: option.cues };
  }, [options, sideBId]);
  const sameSide = sideAId === sideBId;
  const diff = useMemo(
    () => (sameSide ? null : compareVersions(sideA, sideB)),
    [sameSide, sideA, sideB],
  );
  const visible = useMemo(
    () =>
      diff
        ? diff.entries.filter((entry) => matchesFilter(entry.kind, filter))
        : [],
    [diff, filter],
  );

  useEffect(() => {
    setActiveKey((current) =>
      current && visible.some((entry) => entry.key === current)
        ? current
        : (visible[0]?.key ?? null),
    );
  }, [visible]);

  const active = useMemo(
    () => diff?.entries.find((entry) => entry.key === activeKey) ?? null,
    [diff, activeKey],
  );

  const jumpTo = (entry: CueDiff) => {
    setActiveKey(entry.key);
    document
      .querySelectorAll(`[data-diff-key="${entry.key}"]`)
      .forEach((node) => {
        const element = node as HTMLElement;
        element.scrollIntoView?.({ block: "nearest", inline: "center" });
      });
    const row = listRef.current?.querySelector(
      `[data-row-key="${entry.key}"]`,
    ) as HTMLElement | null;
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const step = (direction: 1 | -1) => {
    if (!visible.length) return;
    const index = visible.findIndex((entry) => entry.key === activeKey);
    const next = visible[(index + direction + visible.length) % visible.length];
    if (next) jumpTo(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const positionText = (entry: CueDiff) => {
    if (entry.kind === "added") return `#${entry.indexB}（新位置）`;
    if (entry.kind === "deleted") return `#${entry.indexA}（旧位置）`;
    return `#${entry.indexA} → #${entry.indexB}`;
  };

  const driftLine = (entry: CueDiff) => {
    if (!entry.cueA || !entry.cueB) return null;
    if (entry.kind === "text" || entry.kind === "same") return null;
    return (
      <div className="diff-detail-drift">
        <span>
          开始
          <strong
            className={
              entry.startDeltaMs > 0
                ? "drift-late"
                : entry.startDeltaMs < 0
                  ? "drift-early"
                  : ""
            }
          >
            {formatSignedDelta(entry.startDeltaMs)}
          </strong>
        </span>
        <span>
          结束
          <strong
            className={
              entry.endDeltaMs > 0
                ? "drift-late"
                : entry.endDeltaMs < 0
                  ? "drift-early"
                  : ""
            }
          >
            {formatSignedDelta(entry.endDeltaMs)}
          </strong>
        </span>
        <span className="drift-raw">
          {formatTimestamp(entry.cueA.startMs, project.format)} →{" "}
          {formatTimestamp(entry.cueB.startMs, project.format)}
        </span>
      </div>
    );
  };

  return (
    <div
      className="compare-overlay"
      role="dialog"
      aria-modal
      aria-label="版本对比"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="compare-dialog">
        <header className="compare-head">
          <div>
            <span className="module-kicker">VERSION COMPARE · 只读</span>
            <h2>版本对比</h2>
          </div>
          <button
            type="button"
            className="compare-close"
            aria-label="关闭对比"
            onClick={onClose}
          >
            关闭 ✕
          </button>
        </header>

        <div className="compare-pickers">
          <label>
            旧侧（基准）
            <select
              aria-label="选择对比旧侧"
              value={sideAId}
              onChange={(event) => setSideAId(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <span className="compare-arrow">⇄</span>
          <label>
            新侧
            <select
              aria-label="选择对比新侧"
              value={sideBId}
              onChange={(event) => setSideBId(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {diff && (
            <div className="compare-stats" aria-live="polite">
              <span className="stat-added">新增 {diff.stats.added}</span>
              <span className="stat-deleted">删除 {diff.stats.deleted}</span>
              <span className="stat-text">文本 {diff.stats.text}</span>
              <span className="stat-time">时间 {diff.stats.time}</span>
              <span className="stat-same">未变 {diff.stats.same}</span>
            </div>
          )}
        </div>

        {sameSide ? (
          <div className="compare-empty">
            两侧选择了同一内容，请选择两个不同快照，或将快照与「当前内容」比较。
          </div>
        ) : diff ? (
          <>
            <CompareTimeline
              diff={diff}
              labelA={sideA.label}
              labelB={sideB.label}
              activeKey={activeKey}
              onSelect={jumpTo}
            />
            <div className="compare-filter-row">
              <div className="compare-filters">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? "active" : ""}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="compare-nav">
                <button type="button" onClick={() => step(-1)}>
                  ↑ 上一条
                </button>
                <button type="button" onClick={() => step(1)}>
                  下一条 ↓
                </button>
              </div>
            </div>
            <div className="compare-body">
              <div className="compare-list" ref={listRef}>
                {visible.length === 0 ? (
                  <div className="compare-empty">此筛选下没有差异条目</div>
                ) : (
                  visible.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      data-row-key={entry.key}
                      className={`compare-row compare-row-${entry.kind} ${
                        activeKey === entry.key ? "active" : ""
                      }`}
                      onClick={() => jumpTo(entry)}
                    >
                      <span className="compare-row-kind">
                        {kindLabel[entry.kind]}
                      </span>
                      <span className="compare-row-pos">
                        {positionText(entry)}
                      </span>
                      <span className="compare-row-preview">
                        {entry.cueB?.text ?? entry.cueA?.text}
                      </span>
                      {(entry.kind === "time" || entry.kind === "both") && (
                        <span className="compare-row-drift">
                          {formatSignedDelta(entry.startDeltaMs)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
              <div className="compare-detail">
                {active ? (
                  <>
                    <div className="compare-detail-head">
                      <span
                        className={`compare-row-kind compare-row-${active.kind}`}
                      >
                        {kindLabel[active.kind]}
                      </span>
                      <span>{positionText(active)}</span>
                    </div>
                    {driftLine(active)}
                    {active.kind === "added" && active.cueB && (
                      <div className="diff-line diff-line-inserted">
                        <span className="diff-line-no">+</span>
                        <span className="diff-line-text diff-char-ins">
                          {active.cueB.text}
                        </span>
                      </div>
                    )}
                    {active.kind === "deleted" && active.cueA && (
                      <div className="diff-line diff-line-deleted">
                        <span className="diff-line-no">−</span>
                        <span className="diff-line-text diff-char-del">
                          {active.cueA.text}
                        </span>
                      </div>
                    )}
                    {(active.kind === "text" || active.kind === "both") && (
                      <TextDiffLines lines={active.lines} />
                    )}
                    {active.kind === "time" && (
                      <div className="compare-text-plain">
                        {active.cueB?.text}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="compare-empty">选择左侧条目查看具体差异</div>
                )}
              </div>
            </div>
          </>
        ) : null}
        <footer className="compare-foot">
          对比只读，不会修改快照或当前编辑；关闭后编辑状态与选中位置保持不变。
        </footer>
      </section>
    </div>
  );
}
