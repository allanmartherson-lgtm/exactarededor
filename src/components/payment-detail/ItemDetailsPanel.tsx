/**
 * ItemDetailsPanel — painel lateral (drawer) que substitui a antiga
 * expansão inline do `ItemDetailsRow`. Abre pela direita, mantém
 * o restante da tabela imóvel e organiza o conteúdo em seções
 * colapsáveis (Cálculo e Regra abertas por padrão; Observações
 * e Dados do item colapsadas).
 *
 * Segue a diretriz do prompt: NENHUMA informação do ItemDetailsRow
 * original pode ser perdida. As seções "Cálculo" e "Regra" mostram
 * um resumo rápido, e a seção "Dados do item" renderiza o
 * ItemDetailsRow completo dentro de uma tabela mínima, garantindo
 * paridade total com a versão inline anterior.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/status";
import { getPatient, getProcedureCode, getProcedureName } from "@/lib/itemFields";

type AnyItem = Record<string, any>;

interface ItemDetailsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AnyItem | null;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Bloco completo com todo o conteúdo detalhado (ItemDetailsRow envolvido em <table><tbody>).
   *  Vai dentro da seção "Dados do item" para preservar 100% da informação. */
  fullDetailsSlot?: React.ReactNode;
  /** Observações já processadas para exibição resumida. */
  observations?: Array<{ id?: string; text?: string | null; author_name?: string | null; created_at?: string | null }>;
}

const SECTION_TITLE = "text-[11px] uppercase tracking-wide text-muted-foreground font-medium";

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2 px-4 py-2 border-b bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <span className={SECTION_TITLE}>{title}</span>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 py-3 border-b">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={SECTION_TITLE}>{label}</div>
      <div className="mt-0.5 text-[13px] break-words">{value ?? "—"}</div>
    </div>
  );
}

export function ItemDetailsPanel({
  open,
  onOpenChange,
  item,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  fullDetailsSlot,
  observations = [],
}: ItemDetailsPanelProps) {
  if (!item) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-[440px] w-full p-0" />
      </Sheet>
    );
  }

  const patient = getPatient(item);
  const procCode = getProcedureCode(item);
  const procName = getProcedureName(item);
  const statusLabel = (item.ai_status ?? item.status ?? "—") as string;

  const grossAmount = Number(item.gross_amount ?? 0);
  const expectedAmount = Number(item.expected_amount ?? 0);
  const diff = grossAmount - expectedAmount;

  const appliedRuleLabel =
    item.applied_rule_label ?? item.rule_name ?? item.matched_rule_name ?? null;
  const appliedMethod = item.applied_calc_method ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-[440px] w-full p-0 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b bg-primary text-primary-foreground px-4 py-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide opacity-80">Detalhes do item</div>
            <div className="text-sm font-semibold truncate" title={patient}>{patient}</div>
            <div className="text-[11px] opacity-90 truncate" title={`${procCode} — ${procName}`}>
              {procCode} — {procName}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-primary-foreground hover:bg-white/10"
              disabled={!hasPrev}
              onClick={onPrev}
              title="Item anterior"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-primary-foreground hover:bg-white/10"
              disabled={!hasNext}
              onClick={onNext}
              title="Próximo item"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <span className="ml-2 text-[10px] uppercase font-semibold rounded bg-white/15 px-2 py-0.5">
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Scroll interno */}
        <div className="flex-1 overflow-y-auto">
          {/* 1. Cálculo — aberto por padrão */}
          <Section title="Cálculo" defaultOpen>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pago" value={<span className="tabular-nums font-semibold">{formatCurrency(grossAmount)}</span>} />
              <Field label="Esperado" value={<span className="tabular-nums">{formatCurrency(expectedAmount)}</span>} />
              <Field
                label="Diferença"
                value={
                  <span className={cn(
                    "tabular-nums font-semibold",
                    Math.abs(diff) < 0.01 ? "text-emerald-600" : diff > 0 ? "text-red-600" : "text-amber-600",
                  )}>
                    {formatCurrency(diff)}
                  </span>
                }
              />
            </div>
            {appliedMethod && (
              <div className="mt-3 text-[12px] text-muted-foreground">
                Método aplicado: <span className="font-medium text-foreground">{appliedMethod}</span>
              </div>
            )}
            <div className="mt-2 text-[11px] text-muted-foreground italic">
              Memória de cálculo completa disponível na seção "Dados do item" abaixo.
            </div>
          </Section>

          {/* 2. Regra aplicada — aberta por padrão */}
          <Section title="Regra aplicada" defaultOpen>
            <div className="space-y-2">
              <Field label="Nome da regra" value={appliedRuleLabel ?? <span className="text-muted-foreground italic">Sem regra vinculada</span>} />
              {item.applied_layer && <Field label="Camada" value={String(item.applied_layer)} />}
              {item.applied_rule_id && (
                <Field label="ID da regra" value={<span className="font-mono text-[11px]">{String(item.applied_rule_id)}</span>} />
              )}
            </div>
          </Section>

          {/* 3. Observações — colapsada */}
          <Section title="Observações">
            {observations.length === 0 ? (
              <div className="text-[12px] text-muted-foreground italic">Nenhuma observação registrada.</div>
            ) : (
              <ul className="space-y-2">
                {observations.map((o, idx) => (
                  <li key={o.id ?? idx} className="border-l-2 border-primary/40 pl-2 text-[12px]">
                    <div className="whitespace-pre-wrap break-words">{o.text ?? "—"}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {o.author_name ?? "—"}{o.created_at ? ` • ${o.created_at}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 4. Dados do item — colapsada. Contém o ItemDetailsRow COMPLETO,
              garantindo paridade total com a versão inline anterior. */}
          <Section title="Dados do item">
            {fullDetailsSlot ?? (
              <div className="text-[12px] text-muted-foreground italic">
                Sem detalhes adicionais.
              </div>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
