import { Check } from "lucide-react";
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

const STAGES: Array<{ key: Stage; label: string }> = [
  { key: "analise", label: "Análise" },
  { key: "validacao", label: "Validação" },
  { key: "aprovacao", label: "Aprovação" },
  { key: "pos_nf", label: "Pós-NF" },
  { key: "pago", label: "Pago" },
];

const STAGE_INDEX: Record<Stage, number> = {
  analise: 0,
  validacao: 1,
  aprovacao: 2,
  pos_nf: 3,
  pago: 4,
};

function statusToStage(status: PaymentStatus): Stage {
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
        "w-full rounded-[14px] border border-border/50 bg-card px-4 py-3",
        "shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        className,
      )}
      role="group"
      aria-label="Funil de aprovação do pagamento"
    >
      <div className="flex items-center justify-between gap-1">
        {STAGES.map((s, i) => {
          const isLast = i === STAGES.length - 1;
          const isCurrent = !terminated && i === currentIdx;
          const isDone = !terminated && i < currentIdx;
          const isPaid = !terminated && currentIdx === STAGE_INDEX.pago && i === STAGE_INDEX.pago;

          return (
            <div key={s.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 min-w-0">
                <div
                  className={cn(
                    "relative h-6 w-6 rounded-full flex items-center justify-center transition-all",
                    terminated && "bg-muted text-muted-foreground",
                    !terminated && isDone && "bg-success text-white",
                    !terminated && isCurrent && !isPaid && "bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.15)]",
                    !terminated && isCurrent && isPaid && "bg-success text-white shadow-[0_0_0_4px_hsl(var(--success)/0.18)]",
                    !terminated && !isCurrent && !isDone && "bg-muted text-muted-foreground/60",
                  )}
                >
                  {isDone || isPaid ? (
                    <Check size={12} strokeWidth={3} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10.5px] font-medium leading-none whitespace-nowrap",
                    terminated && "text-muted-foreground",
                    !terminated && isCurrent && !isPaid && "text-primary font-semibold",
                    !terminated && isCurrent && isPaid && "text-success font-semibold",
                    !terminated && isDone && "text-foreground/80",
                    !terminated && !isCurrent && !isDone && "text-muted-foreground/70",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {!isLast && (
                <div
                  aria-hidden
                  className={cn(
                    "flex-1 h-px mx-2 -mt-3 rounded-full transition-colors",
                    terminated && "bg-muted",
                    !terminated && i < currentIdx && "bg-success/60",
                    !terminated && i >= currentIdx && "bg-muted",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      {terminated && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Fluxo encerrado · {terminatedLabel[status as string] ?? "Encerrado"}
        </p>
      )}
    </div>
  );
}
