import { createRoot, type Root } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface JustificationOptions {
  title?: string;
  description?: React.ReactNode;
  /** Texto do botão de confirmar. */
  confirmText?: string;
  cancelText?: string;
  /** Mínimo de caracteres exigidos (default 20). Use 0 para tornar opcional. */
  minLength?: number;
  /** Máximo permitido no textarea (default 1000). */
  maxLength?: number;
  /** Placeholder do textarea. */
  placeholder?: string;
  /** Sugestão pré-preenchida (analista pode ajustar antes de confirmar). */
  defaultValue?: string;
  /** Aparência do botão de confirmar. */
  tone?: "default" | "success" | "warning" | "danger";
}

interface InternalProps extends JustificationOptions {
  resolve: (v: string | null) => void;
  cleanup: () => void;
}

const toneClasses: Record<NonNullable<JustificationOptions["tone"]>, string> = {
  default: "",
  success: "bg-emerald-600 hover:bg-emerald-700 text-white",
  warning: "bg-amber-600 hover:bg-amber-700 text-white",
  danger: "bg-destructive hover:bg-destructive/90 text-destructive-foreground",
};

function JustificationDialog({
  title = "Justificativa",
  description,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  minLength = 20,
  maxLength = 1000,
  placeholder,
  defaultValue = "",
  tone = "default",
  resolve,
  cleanup,
}: InternalProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const trimmed = value.trim();
  const remaining = Math.max(0, minLength - trimmed.length);
  const canConfirm = useMemo(() => trimmed.length >= minLength, [trimmed, minLength]);

  const finish = (result: string | null) => {
    setOpen(false);
    resolve(result);
    setTimeout(cleanup, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-sm text-muted-foreground">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
            placeholder={placeholder ?? (minLength > 0
              ? `Descreva o motivo (mínimo ${minLength} caracteres).`
              : "Descreva o motivo (opcional).")}
            rows={5}
            className="resize-none"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canConfirm) {
                e.preventDefault();
                finish(trimmed);
              }
            }}
          />
          <div className="flex items-center justify-between text-xs">
            <span
              className={cn(
                "font-medium",
                canConfirm ? "text-emerald-600" : "text-amber-600",
              )}
            >
              {canConfirm
                ? "Justificativa válida."
                : `Faltam ${remaining} caractere${remaining === 1 ? "" : "s"}.`}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {trimmed.length}/{maxLength}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => finish(null)}>
            {cancelText}
          </Button>
          <Button
            className={toneClasses[tone]}
            disabled={!canConfirm}
            onClick={() => finish(trimmed)}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Abre um modal para coleta de justificativa. Resolve com o texto quando o
 * analista confirma (respeitando `minLength`) ou com `null` no cancelamento.
 * Substitui o padrão `window.prompt` + toast de erro por um fluxo controlado
 * com contagem ao vivo e desabilita a confirmação até o mínimo ser atingido.
 */
export function promptJustification(opts: JustificationOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-justification-host", "");
    document.body.appendChild(host);
    let root: Root | null = createRoot(host);
    const cleanup = () => {
      try { root?.unmount(); } catch { /* noop */ }
      root = null;
      host.remove();
    };
    root.render(
      <JustificationDialog {...opts} resolve={resolve} cleanup={cleanup} />,
    );
  });
}
