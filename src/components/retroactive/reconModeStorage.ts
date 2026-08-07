import { type ReconMode } from "./reconTypes";

const MODE_STORAGE_PREFIX = "retro_mode__";

export function getStoredMode(id: string): ReconMode {
  if (typeof window === "undefined") return "alegacao_medico";
  const v = window.sessionStorage.getItem(MODE_STORAGE_PREFIX + id);
  return v === "tasy_vs_repasse" ? "tasy_vs_repasse" : "alegacao_medico";
}

export function setStoredMode(id: string, m: ReconMode) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(MODE_STORAGE_PREFIX + id, m);
}
