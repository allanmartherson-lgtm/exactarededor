/**
 * Dialog de apresentação do progresso do parse (Web Worker).
 *
 * Puramente visual — não faz nenhum trabalho, apenas exibe a fase e a
 * contagem que o chamador (NewPayment) alimenta enquanto os workers
 * processam os arquivos em paralelo.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

export type ParseProgressPhase = "lendo_arquivo" | "parseando_linhas" | "concluido";

interface ParseProgressDialogProps {
  open: boolean;
  phase: ParseProgressPhase;
  current: number;
  total: number;
  fileName?: string;
}

const PHASE_LABEL: Record<ParseProgressPhase, string> = {
  lendo_arquivo: "Lendo arquivo",
  parseando_linhas: "Parseando linhas",
  concluido: "Concluído",
};

export function ParseProgressDialog({
  open,
  phase,
  current,
  total,
  fileName,
}: ParseProgressDialogProps) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const detail =
    phase === "parseando_linhas" && total > 1
      ? `${current.toLocaleString("pt-BR")} / ${total.toLocaleString("pt-BR")} linhas`
      : phase === "lendo_arquivo"
      ? "Lendo bytes da planilha…"
      : phase === "concluido"
      ? "Finalizando…"
      : "";

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg"
        // Sem botão de fechar: parse é curto e não deve ser interrompido no meio.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
            {PHASE_LABEL[phase]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {fileName ? (
            // break-all + line-clamp preserva o nome inteiro em até 2 linhas,
            // sem cortar no meio como o truncate anterior fazia com nomes longos.
            <p
              className="text-sm text-muted-foreground break-all line-clamp-2 leading-snug"
              title={fileName}
            >
              {fileName}
            </p>
          ) : null}
          <Progress value={pct} />
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

