/** 对比视图使用的时间展示工具 */

/** 带符号的时间漂移，如 +1.250s / −0.040s / 0 */
export function formatSignedDelta(ms: number): string {
  if (ms === 0) return "0";
  const sign = ms > 0 ? "+" : "−";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}

/** 时间轴短钟点 HH:MM:SS，用于对比轨刻度 */
export function formatClock(ms: number): string {
  const safe = Math.max(0, Math.trunc(ms));
  const h = Math.floor(safe / 3600000),
    m = Math.floor(safe / 60000) % 60,
    s = Math.floor(safe / 1000) % 60;
  const mm = String(m).padStart(2, "0"),
    ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 快照保存时间，固定 zh-CN 风格，避免依赖运行时 locale */
export function formatSavedAt(savedAt: number): string {
  const d = new Date(savedAt);
  const p = (value: number) => String(value).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}
