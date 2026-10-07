import type { Format, SubtitleProject } from "../models";
import type { SubtitleMeterViewModel } from "../viewmodels/subtitleMeterViewModel";
import { formatSavedAt } from "../diff/diffFormat";
import type { CompareSelection } from "./VersionCompareModule";
export function VersionExportModule({
  project,
  vm,
  phase,
  onCompare,
}: {
  project: SubtitleProject;
  vm: SubtitleMeterViewModel;
  phase: string;
  onCompare: (selection: CompareSelection) => void;
}) {
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
        <div className="version-actions">
          <button
            className="secondary-button"
            disabled={project.versions.length === 0}
            onClick={() =>
              onCompare({
                sideAId: project.versions.at(-1)!.id,
                sideBId: "current",
              })
            }
          >
            ⇄ 与当前对比
          </button>
          <button
            className="secondary-button"
            onClick={() => void vm.saveVersion()}
          >
            ＋ 保存快照
          </button>
        </div>
      </div>
      {project.versions.length > 0 && (
        <div className="version-list">
          {[...project.versions].reverse().map((version) => (
            <div key={version.id} className="version-item">
              <button
                className="version-restore"
                onClick={() => void vm.restoreVersion(version.id)}
              >
                <span className="version-item-label">{version.label}</span>
                <span className="version-item-time">
                  {formatSavedAt(version.savedAt)}
                </span>
                <span className="version-restore-hint">恢复整份快照 ↗</span>
              </button>
              <button
                type="button"
                className="version-compare"
                onClick={() =>
                  onCompare({ sideAId: version.id, sideBId: "current" })
                }
              >
                对比
              </button>
            </div>
          ))}
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
      <p className="privacy-note">
        对比只读不改内容 · 字幕文件与项目版本仅保存在当前浏览器
      </p>
    </section>
  );
}
