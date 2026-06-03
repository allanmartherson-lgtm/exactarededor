import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Info, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfirmTone = "info" | "warning" | "danger" | "success" | "question";

export interface ConfirmOptions {
  title?: string;
  description?: React.ReactNode;
  /** Texto longo opcional, preserva quebras de linha (\n) */
  details?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
  /** Se true, esconde o botão cancelar (vira um alert simples) */
  alertOnly?: boolean;
}

const toneConfig: Record<ConfirmTone, { icon: React.ComponentType<{ className?: string }>; iconWrap: string; iconColor: string; confirmClass: string }> = {
  info:     { icon: Info,          iconWrap: "bg-blue-100 dark:bg-blue-950/40",   iconColor: "text-blue-600 dark:text-blue-400",   confirmClass: "" },
  warning:  { icon: AlertTriangle, iconWrap: "bg-amber-100 dark:bg-amber-950/40", iconColor: "text-amber-600 dark:text-amber-400", confirmClass: "bg-amber-600 hover:bg-amber-700 text-white" },
  danger:   { icon: XCircle,       iconWrap: "bg-red-100 dark:bg-red-950/40",     iconColor: "text-red-600 dark:text-red-400",     confirmClass: "bg-destructive hover:bg-destructive/90 text-destructive-foreground" },
  success:  { icon: CheckCircle2,  iconWrap: "bg-emerald-100 dark:bg-emerald-950/40", iconColor: "text-emerald-600 dark:text-emerald-400", confirmClass: "" },
  question: { icon: HelpCircle,    iconWrap: "bg-muted",                          iconColor: "text-muted-foreground",              confirmClass: "" },
};

interface InternalProps extends ConfirmOptions {
  resolve: (v: boolean) => void;
  cleanup: () => void;
}

function ConfirmDialog({
  title = "Confirmar ação",
  description,
  details,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  tone = "question",
  alertOnly = false,
  resolve,
  cleanup,
}: InternalProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // open on next tick so animation triggers
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const cfg = toneConfig[tone];
  const Icon = cfg.icon;

  const finish = (value: boolean) => {
    setOpen(false);
    resolve(value);
    // wait for close animation before unmounting
    setTimeout(cleanup, 200);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) finish(false); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", cfg.iconWrap)}>
              <Icon className={cn("h-5 w-5", cfg.iconColor)} />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <AlertDialogTitle className="text-base leading-tight">{title}</AlertDialogTitle>
              {description && (
                <AlertDialogDescription className="mt-1.5 text-sm text-muted-foreground">
                  {description}
                </AlertDialogDescription>
              )}
            </div>
          </div>
          {details && (
            <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs text-foreground/80 whitespace-pre-wrap max-h-64 overflow-auto font-mono leading-relaxed">
              {details}
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {!alertOnly && (
            <AlertDialogCancel onClick={() => finish(false)}>{cancelText}</AlertDialogCancel>
          )}
          <AlertDialogAction
            className={cfg.confirmClass}
            onClick={() => finish(true)}
            autoFocus
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function mount(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-confirm-host", "");
    document.body.appendChild(host);
    let root: Root | null = createRoot(host);
    const cleanup = () => {
      try { root?.unmount(); } catch { /* noop */ }
      root = null;
      host.remove();
    };
    root.render(<ConfirmDialog {...opts} resolve={resolve} cleanup={cleanup} />);
  });
}

/** Substituto de window.confirm — retorna Promise<boolean>. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return mount(opts);
}

/** Substituto de window.alert — sempre resolve true ao fechar. */
export function alertDialog(opts: Omit<ConfirmOptions, "alertOnly" | "cancelText">): Promise<boolean> {
  return mount({ ...opts, alertOnly: true, confirmText: opts.confirmText ?? "Entendi" });
}
