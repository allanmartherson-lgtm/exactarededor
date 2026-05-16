/**
 * Sistema unificado de sinalização visual.
 *
 * Fonte única para:
 *  - níveis de severidade (info / warn / critical / block)
 *  - mapeamento de `action` do motor de regras → nível visual
 *  - classes Tailwind por nível (badge, banner)
 *  - ícones padrão por nível
 *  - helper `flashHighlight` para destacar uma linha após scroll
 *  - wrappers `notify.*` em cima do sonner (consistência de tom/ícone)
 *
 * Use este módulo sempre que precisar comunicar severidade ao usuário:
 * badges inline, banners, toasts, popovers de validação.
 */
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  ShieldX,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

export type SeverityLevel = "info" | "warn" | "critical" | "block";

export const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  info: 0,
  warn: 1,
  critical: 2,
  block: 3,
};

export interface SeverityToken {
  level: SeverityLevel;
  label: string;
  /** Badge inline pill */
  badge: string;
  /** Banner block (com borda) */
  banner: string;
  /** Cor da borda/anel apenas */
  ring: string;
  icon: LucideIcon;
}

export const SEVERITY_TOKENS: Record<SeverityLevel, SeverityToken> = {
  info: {
    level: "info",
    label: "Informativo",
    badge: "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100",
    banner: "border-teal-200 bg-teal-50 text-teal-800",
    ring: "ring-teal-200",
    icon: Info,
  },
  warn: {
    level: "warn",
    label: "Alerta",
    badge: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    banner: "border-amber-200 bg-amber-50 text-amber-800",
    ring: "ring-amber-200",
    icon: AlertTriangle,
  },
  critical: {
    level: "critical",
    label: "Alerta forte",
    badge: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
    banner: "border-orange-200 bg-orange-50 text-orange-800",
    ring: "ring-orange-200",
    icon: AlertOctagon,
  },
  block: {
    level: "block",
    label: "Bloqueio",
    badge: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
    banner: "border-red-200 bg-red-50 text-red-800",
    ring: "ring-red-200",
    icon: ShieldX,
  },
};

/** Mapeia `action` configurada nas regras → nível visual. */
export function actionToLevel(action: string | null | undefined): SeverityLevel {
  switch (action) {
    case "bloquear":
      return "block";
    case "alerta_forte":
      return "critical";
    case "alerta":
      return "warn";
    case "informar":
    default:
      return "info";
  }
}

/** Severidade dominante (a mais grave) numa lista de níveis. */
export function dominantLevel(levels: SeverityLevel[]): SeverityLevel {
  if (levels.length === 0) return "info";
  return levels.reduce((acc, lvl) =>
    SEVERITY_ORDER[lvl] > SEVERITY_ORDER[acc] ? lvl : acc,
  "info" as SeverityLevel);
}

/**
 * Pulsa uma linha (ou qualquer elemento) com fundo amber 2× após scroll
 * suave centralizado. Usar para sinalizar "você chegou aqui" quando o
 * usuário foi navegado para um item específico (ex.: duplicidade).
 *
 * O elemento precisa estar no DOM. Idempotente — chamadas repetidas
 * reiniciam a animação.
 */
export function flashHighlight(el: HTMLElement | null | undefined) {
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    /* ignore */
  }
  el.classList.remove("row-flash");
  // Force reflow para reiniciar a animação se já estava aplicada.
  void el.offsetWidth;
  el.classList.add("row-flash");
  window.setTimeout(() => {
    el.classList.remove("row-flash");
  }, 1800);
}

/**
 * Tenta destacar uma linha pelo `data-row-id`. Aguarda o DOM caso o grid
 * ainda esteja montando (até `maxWaitMs`). Retorna true quando achou.
 */
export function flashRowById(rowId: string, maxWaitMs = 2000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`);
      if (el) {
        flashHighlight(el);
        resolve(true);
        return;
      }
      if (Date.now() - start > maxWaitMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

/* ---------- Toasts padronizados (sonner) ---------- */

type NotifyOptions = { description?: string; duration?: number };

export const notify = {
  info(title: string, opts?: NotifyOptions) {
    toast(title, { description: opts?.description, duration: opts?.duration });
  },
  success(title: string, opts?: NotifyOptions) {
    toast.success(title, { description: opts?.description, duration: opts?.duration });
  },
  warn(title: string, opts?: NotifyOptions) {
    toast.warning(title, { description: opts?.description, duration: opts?.duration });
  },
  error(title: string, opts?: NotifyOptions) {
    toast.error(title, { description: opts?.description, duration: opts?.duration ?? 6000 });
  },
};
