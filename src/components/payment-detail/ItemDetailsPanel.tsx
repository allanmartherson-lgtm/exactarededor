/**
 * ItemDetailsPanel — painel lateral (drawer) que substitui a antiga
 * expansão inline do `ItemDetailsRow`. Abre pela direita, mantém
 * o restante da tabela imóvel e organiza o conteúdo em seções
 * colapsáveis.
 *
 * Diferente da versão anterior, este painel NÃO reusa o ItemDetailsRow
 * (que foi desenhado para a largura total da tela e ficava ilegível
 * dentro dos 440px do drawer). Toda a informação é renderizada por
 * conta própria em layout vertical de lista chave-valor.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/status";
import {
  getAccessRoute,
  getAgreement,
  getDoctor,
  getDoctorRole,
  getPatient,
  getProcedureCode,
  getProcedureName,
} from "@/lib/itemFields";

type AnyItem = Record<string, any>;

interface ItemDetailsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AnyItem | null;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Slot opcional para o seletor "Tipo deste item" (Só este / Atend.). */
  caseSubtypeSlot?: React.ReactNode;
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

function Field({
  label,
  value,
  full = false,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn("min-w-0", full && "col-span-2")}>
      <div className={SECTION_TITLE}>{label}</div>
      <div className="mt-0.5 text-[13px] break-words">
        {value == null || value === "" ? <span className="text-muted-foreground">—</span> : value}
      </div>
    </div>
  );
}

function formatDate(v: any): string {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return String(v);
  }
}

export function ItemDetailsPanel({
  open,
  onOpenChange,
  item,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  caseSubtypeSlot,
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
  const statusLabel = String(item.ai_status ?? item.status ?? "—");

  const grossAmount = Number(item.gross_amount ?? 0);
  const expectedAmount = Number(item.expected_amount ?? 0);
  const diff = grossAmount - expectedAmount;

  const appliedRuleLabel =
    item.applied_rule_label ?? item.rule_name ?? item.matched_rule_name ?? null;
  const appliedMethod = item.applied_calc_method ?? null;

  const calcMemory: string | null =
    item.ai_findings?.calculation_explanation ??
    item.ai_findings?.explanation ??
    item.calculation_explanation ??
    null;

  const alerts: string[] = Array.isArray(item.ai_findings?.alerts) ? item.ai_findings.alerts : [];
  const matchedRules: string[] = Array.isArray(item.ai_findings?.matched_rules)
    ? item.ai_findings.matched_rules
    : [];
  const engine = item.ai_findings?.engine ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-[440px] w-full p-0 overflow-hidden flex flex-col"
      >
        {/* Header — pr-14 garante espaço para o X do Sheet não sobrepor conteúdo */}
        <div className="border-b bg-primary text-primary-foreground px-4 py-3 pr-14 shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-[11px] uppercase tracking-wide opacity-80">Detalhes do item</div>
            <span className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-primary-foreground hover:bg-white/10"
                disabled={!hasPrev}
                onClick={onPrev}
                title="Item anterior"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-primary-foreground hover:bg-white/10"
                disabled={!hasNext}
                onClick={onNext}
                title="Próximo item"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </span>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <div className="text-sm font-semibold truncate flex-1 min-w-0" title={patient}>
              {patient}
            </div>
            <span className="shrink-0 text-[10px] uppercase font-semibold rounded bg-white/15 px-2 py-0.5">
              {statusLabel}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] opacity-90 truncate" title={`${procCode} — ${procName}`}>
            {procCode} — {procName}
          </div>
        </div>

        {/* Scroll interno */}
        <div className="flex-1 overflow-y-auto">
          {/* 1. Cálculo — aberto por padrão, com memória em destaque */}
          <Section title="Cálculo" defaultOpen>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pago" value={<span className="tabular-nums font-semibold text-[15px]">{formatCurrency(grossAmount)}</span>} />
              <Field label="Esperado" value={<span className="tabular-nums font-semibold text-[15px]">{formatCurrency(expectedAmount)}</span>} />
              <Field
                label="Diferença"
                value={
                  <span className={cn(
                    "tabular-nums font-semibold text-[15px]",
                    Math.abs(diff) < 0.01 ? "text-emerald-600" : diff > 0 ? "text-red-600" : "text-amber-600",
                  )}>
                    {formatCurrency(diff)}
                  </span>
                }
              />
            </div>
            {calcMemory && (
              <div className="mt-3 bg-muted/40 rounded p-3 text-[12px] whitespace-pre-wrap break-words">
                {calcMemory}
              </div>
            )}
            {appliedMethod && (
              <div className="mt-3 text-[12px] text-muted-foreground">
                Método aplicado: <span className="font-medium text-foreground">{appliedMethod}</span>
              </div>
            )}
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

          {/* 4. Dados do item — colapsada, layout vertical de lista */}
          <Section title="Dados do item">
            {caseSubtypeSlot && (
              <div className="mb-3 pb-3 border-b">
                <div className={SECTION_TITLE}>Tipo deste item</div>
                <div className="mt-1">{caseSubtypeSlot}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              <Field label="Atendimento" value={item.attendance_number ?? item.atendimento ?? null} />
              <Field label="Data" value={formatDate(item.procedure_date ?? item.data ?? item.date)} />
              <Field label="Paciente" value={patient} full />
              <Field label="Convênio" value={getAgreement(item)} full />
              <Field label="Via de acesso" value={getAccessRoute(item)} />
              <Field label="TUSS" value={procCode} />
              <Field label="Procedimento" value={procName} full />
              <Field label="Médico" value={getDoctor(item)} full />
              <Field label="Função" value={getDoctorRole(item)} />
              <Field label="Quantidade" value={item.quantity ?? 1} />
              <Field label="Setor" value={item.sector_name ?? item.sector ?? null} full />
              <Field label="Setor (planilha)" value={item.raw_sector ?? item.sector_raw ?? null} full />
              <Field label="Tipo do item" value={item.item_type_label ?? item.item_type ?? null} full />
            </div>
          </Section>

          {/* 5. Histórico e análise — colapsada, blocos verticais */}
          <Section title="Histórico e análise">
            <div className="space-y-3">
              {alerts.length > 0 && (
                <div className="border-l-2 border-amber-500 pl-3">
                  <div className={SECTION_TITLE}>Alertas</div>
                  <ul className="mt-1 space-y-1 text-[12px]">
                    {alerts.map((a, i) => (
                      <li key={i} className="break-words">• {a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {matchedRules.length > 0 && (
                <div className="border-l-2 border-primary/40 pl-3">
                  <div className={SECTION_TITLE}>Regras avaliadas</div>
                  <ul className="mt-1 space-y-1 text-[12px]">
                    {matchedRules.map((r, i) => (
                      <li key={i} className="break-words">• {r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {engine && (
                <div className="border-l-2 border-muted-foreground/40 pl-3">
                  <div className={SECTION_TITLE}>Motor</div>
                  <div className="mt-1 space-y-1 text-[12px]">
                    {engine.calculation_type_used && (
                      <div><span className="text-muted-foreground">Tipo de cálculo:</span> {String(engine.calculation_type_used)}</div>
                    )}
                    {engine.matched_priority && (
                      <div><span className="text-muted-foreground">Prioridade:</span> {String(engine.matched_priority)}</div>
                    )}
                    {engine.diff_pct != null && (
                      <div><span className="text-muted-foreground">Diferença %:</span> {Number(engine.diff_pct).toFixed(2)}%</div>
                    )}
                    {engine.ai_note && (
                      <div className="mt-1 bg-muted/40 rounded p-2 whitespace-pre-wrap break-words">{String(engine.ai_note)}</div>
                    )}
                  </div>
                </div>
              )}

              {item.created_at && (
                <div className="border-l-2 border-muted-foreground/40 pl-3">
                  <div className={SECTION_TITLE}>Criado em</div>
                  <div className="mt-1 text-[12px]">{formatDate(item.created_at)}</div>
                </div>
              )}

              {alerts.length === 0 && matchedRules.length === 0 && !engine && !item.created_at && (
                <div className="text-[12px] text-muted-foreground italic">Sem histórico registrado.</div>
              )}
            </div>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
