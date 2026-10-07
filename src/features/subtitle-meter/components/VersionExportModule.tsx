import { useMemo, useState } from "react";
import type { Format, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { CompareModule, type CompareSide } from "./CompareModule";

const CURRENT = "__current__";

function formatSavedAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VersionExportModule({
  project,
  vm,
  phase,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  phase: string;
}) {
  // 对比为纯查看态：只存在本组件，不经过 view model，
  // 因此退出后编辑内容与选中位置完全保留。
  const [leftId, setLeftId] = useState<string>(
    project.versions.at(-1)?.id ?? CURRENT,
  );
  const [rightId, setRightId] = useState<string>(CURRENT);
  const [comparing, setComparing] = useState<CompareSide[] | null>(null);

  const sideById = useMemo(() => {
    const map = new Map<string, CompareSide>();
    map.set(CURRENT, {
      id: CURRENT,
      label: "当前编辑内容",
      hint: `未保存的改动 · ${project.cues.length} 条`,
      cues: project.cues,
    });
    project.versions.forEach((version) =>
      map.set(version.id, {
        id: version.id,
        label: version.label,
        hint: `${formatSavedAt(version.savedAt)} · ${version.cues.length} 条`,
        cues: version.cues,
      }),
    );
    return map;
  }, [project]);

  // 快照被重新保存后，失效的选择回落到可用项
  const safeLeftId = sideById.has(leftId)
    ? leftId
    : (project.versions.at(-1)?.id ?? CURRENT);
  const safeRightId = sideById.has(rightId) ? rightId : CURRENT;
  const leftSide = sideById.get(safeLeftId)!;
  const rightSide = sideById.get(safeRightId)!;
  const canCompare = project.versions.length > 0 && safeLeftId !== safeRightId;

  const startCompare = () => {
    if (!canCompare) return;
    setComparing([leftSide, rightSide]);
  };

  return (
    <section className="module version-module">
      <div className="module-head">
        <div>
          <span className="module-kicker">04 / VERSIONS & EXPORT</span>
          <h2>版本与交付</h2>
        </div>
        <span className="saved-label">● 自动保存</span>
      </div>
      <div className="version-row">
        <div>
          <strong>本地快照</strong>
          <small>
            {project.versions.length
              ? `最近：${project.versions.at(-1)?.label}`
              : "保存当前版本以便回退"}
          </small>
        </div>
        <button
          className="secondary-button"
          onClick={() => void vm.saveVersion()}
        >
          ＋ 保存快照
        </button>
      </div>
      {project.versions.length > 0 && (
        <div className="version-list">
          {project.versions.map((version) => (
            <div key={version.id} className="version-item">
              <div className="version-item-copy">
                <strong>{version.label}</strong>
                <small>
                  {formatSavedAt(version.savedAt)} · {version.cues.length} 条
                </small>
              </div>
              <div className="version-item-actions">
                <button
                  className="version-action compare"
                  onClick={() =>
                    setComparing([
                      sideById.get(version.id)!,
                      sideById.get(CURRENT)!,
                    ])
                  }
                >
                  与当前对比
                </button>
                <button
                  className="version-action restore"
                  onClick={() => void vm.restoreVersion(version.id)}
                >
                  恢复 ↗
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {project.versions.length > 0 && (
        <div className="compare-picker">
          <div className="compare-picker-title">
            <strong>版本对比</strong>
            <small>任选两个快照，或快照与当前内容；仅查看，不改动编辑</small>
          </div>
          <div className="compare-picker-row">
            <label>
              基线
              <select
                aria-label="对比基线"
                value={safeLeftId}
                onChange={(e) => setLeftId(e.target.value)}
              >
                {project.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="compare-picker-arrow">→</span>
            <label>
              对比
              <select
                aria-label="对比目标"
                value={safeRightId}
                onChange={(e) => setRightId(e.target.value)}
              >
                <option value={CURRENT}>当前编辑内容</option>
                {project.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button compare-start"
              disabled={!canCompare}
              title={canCompare ? undefined : "请选择两个不同的版本进行对比"}
              onClick={startCompare}
            >
              开始对比 ↗
            </button>
          </div>
        </div>
      )}
      <div className="export-row">
        <label>
          格式
          <select
            aria-label="导出格式"
            value={project.format}
            onChange={(e) => vm.setFormat(e.target.value as Format)}
          >
            <option value="srt">SRT</option>
            <option value="vtt">WebVTT</option>
          </select>
        </label>
        <button
          className="export-button"
          disabled={phase === "exporting"}
          onClick={() => void vm.exportFile()}
        >
          导出字幕 <span>↓</span>
        </button>
      </div>
      <p className="privacy-note">字幕文件与项目版本仅保存在当前浏览器</p>
      {comparing && (
        <CompareModule
          left={comparing[0]}
          right={comparing[1]}
          onClose={() => setComparing(null)}
        />
      )}
    </section>
  );
}
