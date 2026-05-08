import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PaymentTimeline } from "./PaymentTimeline";
import type { ObservationRow, PaymentItemRow, InvoiceRow } from "@/hooks/usePaymentDetailData";
import { MessageCircleQuestion } from "lucide-react";

interface PaymentInternalQuestionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  observations: ObservationRow[];
  items: PaymentItemRow[];
  invoices: InvoiceRow[];
  profiles: Record<string, string>;
  itemLabel: (itemId: string | null | undefined) => string | null;
  onChanged: () => void | Promise<void>;
  onOpenQuestionInvoice: (invoiceId: string) => void;
  paymentReference?: string;
}

/**
 * Painel lateral para visualizar e responder questionamentos internos de um lote.
 * Filtra a timeline para exibir apenas o que for pergunta ou resposta a pergunta.
 */
export const PaymentInternalQuestionsPanel = ({
  isOpen,
  onClose,
  observations,
  items,
  invoices,
  profiles,
  itemLabel,
  onChanged,
  onOpenQuestionInvoice,
  paymentReference,
}: PaymentInternalQuestionsPanelProps) => {
  // Filtra para exibir apenas o que é relevante para o "ciclo de questionamento":
  // 1. A própria pergunta (is_question = true)
  // 2. A resposta (quem a pergunta aponta em answered_by_observation_id)
  const filteredObs = useMemo(() => {
    const questionRows = observations.filter((o: any) => o.is_question);
    const answerIds = new Set(
      questionRows
        .map((q: any) => q.answered_by_observation_id)
        .filter(Boolean)
    );
    
    return observations.filter((o: any) => {
      if (o.is_question) return true;
      if (answerIds.has(o.id)) return true;
      return false;
    });
  }, [observations]);

  const openQuestionsCount = useMemo(() => {
    return observations.filter((o: any) => o.is_question && !o.resolved_at).length;
  }, [observations]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl w-full">
        <SheetHeader className="pb-4 border-bottom mb-4">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-info" />
            Questionamentos Internos
            {paymentReference && (
              <span className="text-muted-foreground font-normal">
                · Lote {paymentReference}
              </span>
            )}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {openQuestionsCount > 0 
              ? `${openQuestionsCount} questionamento(s) aguardando resposta.`
              : "Todos os questionamentos foram resolvidos."}
          </p>
        </SheetHeader>

        <div className="mt-4">
          <PaymentTimeline
            observations={filteredObs}
            items={items}
            invoices={invoices}
            profiles={profiles}
            itemLabel={itemLabel}
            onOpenQuestionInvoice={onOpenQuestionInvoice}
            onChanged={onChanged}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};
