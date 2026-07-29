import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/lib/status";

/**
 * PaymentStatusFunnel — strip horizontal Apple-style com 5 etapas:
 *   Análise → Validação → Aprovação → Pós-NF → Pago
 *
 * Mapeia o `PaymentStatus` (24 valores) em uma das 5 etapas visíveis ao
 * operador. Etapas anteriores ficam concluídas (check + linha cheia), a
 * atual fica destacada (dot azul Apple preenchido com halo), futuras ficam
 * em cinza claro.
 *
 * Estados terminais negativos (rejeitado, cancelado, arquivado) renderizam
 * o funil em modo "neutralizado" — todos os dots ficam muted e aparece um
 * label sutil indicando o desfecho.
 *
 * Puramente visual: não dispara transições, não consome dados externos
 * além do status já carregado pela página.
 */

type Stage = "analise" | "validacao" | "aprovacao" | "pos_nf" | "pago";

const STAGES_COMPLETO: Array<{ key: Stage; label: string }> = [
  { key: "analise", label: "Análise" },
  { key: "validacao", label: "Validação" },
  { key: "aprovacao", label: "Aprovação" },
  { key: "pos_nf", label: "Pós-NF" },
  { key: "pago", label: "Pago" },
];

const STAGES_VALIDACAO: Array<{ key: Stage; label: string }> = [
  { key: "analise", label: "Análise" },
  { key: "validacao", label: "Validação" },
];

function statusToStage(status: PaymentStatus, workflowModule: "completo" | "validacao"): Stage {
  // No módulo "validação" o fluxo termina na etapa de Validação — não existe
  // diretor/NF/pago. `concluido_validacao` marca a etapa como concluída.
  if (workflowModule === "validacao") {
    switch (status) {
      case "aguardando_validacao":
      case "em_questionamento":
      case "devolvido_analista":
      case "concluido_validacao":
        return "validacao";
      default:
        return "analise";
    }
  }
  switch (status) {
    case "rascunho":
    case "em_confeccao":
    case "em_analise_ia":
    case "revisao_analista":
    case "concluida_analista":
    case "devolvido_analista":
      return "analise";
    case "aguardando_validacao":
      return "validacao";
    case "aguardando_aprovacao":
    case "aprovado_em_revisao":
    case "aprovado_parcial":
    case "em_questionamento":
      return "aprovacao";
    case "aprovado":
    case "aprovado_com_ressalva":
    case "pedido_nf_enviado":
    case "nf_recebida":
    case "nf_questionada":
    case "nf_conciliada":
    case "nf_divergente":
    case "lancado":
    case "revisao_pos_aprovacao":
      return "pos_nf";
    case "pago":
      return "pago";
    default:
      return "analise";
  }
}

const TERMINATED: ReadonlyArray<PaymentStatus> = ["rejeitado", "cancelado", "arquivado"];

export function PaymentStatusFunnel({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  const terminated = TERMINATED.includes(status);
  const currentIdx = STAGE_INDEX[statusToStage(status)];

  const terminatedLabel: Record<string, string> = {
    rejeitado: "Rejeitado",
    cancelado: "Cancelado",
    arquivado: "Arquivado",
  };

  return (
    <div
      className={cn(
        "w-full rounded-[10px] border border-border/50 bg-card px-3 py-1.5",
        className,
      )}
      role="group"
      aria-label="Funil de aprovação do pagamento"
    >
      <div className="flex items-center gap-0 flex-wrap">
        {STAGES.map((s, i) => {
          const isLast = i === STAGES.length - 1;
          const isCurrent = !terminated && i === currentIdx;
          const isDone = !terminated && i < currentIdx;
          const isPaid = !terminated && currentIdx === STAGE_INDEX.pago && i === STAGE_INDEX.pago;

          return (
            <div key={s.key} className="flex items-center">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors shrink-0",
                    terminated && "bg-border",
                    !terminated && isDone && "bg-success",
                    !terminated && isCurrent && !isPaid && "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]",
                    !terminated && isCurrent && isPaid && "bg-success shadow-[0_0_0_3px_hsl(var(--success)/0.20)]",
                    !terminated && !isCurrent && !isDone && "bg-border",
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] leading-none whitespace-nowrap",
                    terminated && "text-muted-foreground",
                    !terminated && isCurrent && !isPaid && "font-medium text-primary",
                    !terminated && isCurrent && isPaid && "font-medium text-success",
                    !terminated && isDone && "text-foreground/80",
                    !terminated && !isCurrent && !isDone && "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "w-5 h-px mx-1.5 rounded-full",
                    terminated && "bg-border",
                    !terminated && i < currentIdx && "bg-success/60",
                    !terminated && i >= currentIdx && "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
        {terminated && (
          <span className="ml-3 text-[11px] text-muted-foreground">
            · Fluxo encerrado ({terminatedLabel[status as string] ?? "Encerrado"})
          </span>
        )}
      </div>
    </div>
  );
}
