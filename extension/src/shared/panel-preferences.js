export const PANEL_SIZE_LEVELS = Object.freeze(["small", "medium", "large"]);

export function normalizePanelSize(value) {
  return PANEL_SIZE_LEVELS.includes(value) ? value : PANEL_SIZE_LEVELS[0];
}

export function normalizePanelPosition(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}
