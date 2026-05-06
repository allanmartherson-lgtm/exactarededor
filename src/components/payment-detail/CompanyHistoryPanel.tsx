import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, Sparkles, MessageSquare, Bot, User as UserIcon, UserCheck } from "lucide-react";
import type {
  AiVersionRow,
  AssignmentRow,
  ObservationRow,
  PaymentItemRow,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";

/**
 * Painel unificado de histórico (IA + analistas/validadores/diretores) para
 * todos os itens da empresa em uma única timeline cronológica.
 *
 * Fonte única: as MESMAS coleções já carregadas pelo `usePaymentDetailData`
 * + as versões da IA da página dedicada — nada é refeito por baixo.
 *
 * - Cada entrada exibe data/hora, autor (nome completo via profiles) e o
 *   item ao qual se refere (paciente / atendimento) quando aplicável.
 * - Permite filtrar por item para focar em um caso específico sem perder
 *   o panorama global.
 */
export type CompanyHistoryPanelProps = {
  items: PaymentItemRow[];
  observations: ObservationRow[];
  aiVersions: AiVersionRow[];
  assignments?: AssignmentRow[];
  profiles: Record<string, string>;
};

type Entry = {
  id: string;
  at: string;
  kind: "obs" | "ai" | "assign";
  authorType: string;
  authorName: string;
  itemId: string | null;
  itemLabel: string | null;
  body: React.ReactNode;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR");
}

function itemLabelOf(it: PaymentItemRow | undefined): string | null {
  if (!it) return null;
  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const paciente =
    (it.patient_name as string | null) ??
    ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
    null;
  const att = it.attendance_number ? `Atend. #${it.attendance_number}` : null;
  return [paciente, att].filter(Boolean).join(" · ") || null;
}

export function CompanyHistoryPanel({
  items,
  observations,
  aiVersions,
  assignments = [],
  profiles,
}: CompanyHistoryPanelProps) {
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const itemMap = useMemo(() => {
    const m = new Map<string, PaymentItemRow>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  const [filterItem, setFilterItem] = useState<string>("all");

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];

    // Observações (manuais e do sistema/IA) — escopo do grupo:
    //  - associadas a itens do grupo (item_id ∈ itemIds), ou
    //  - sem item_id (comentários gerais do pagamento, exibidos aqui também).
    for (const o of observations) {
      const itemBelongs = o.item_id ? itemIds.has(o.item_id) : true;
      if (!itemBelongs) continue;
      const it = o.item_id ? itemMap.get(o.item_id) : undefined;
      out.push({
        id: `obs-${o.id}`,
        at: o.created_at,
        kind: "obs",
        authorType: o.author_type,
        authorName: (o.author_id && profiles[o.author_id]) || "—",
        itemId: o.item_id ?? null,
        itemLabel: itemLabelOf(it),
        body: (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {o.message}
          </p>
        ),
      });
    }

    // Versões da IA dos itens do grupo
    for (const v of aiVersions) {
      if (!itemIds.has(v.item_id)) continue;
      const it = itemMap.get(v.item_id);
      const alerts = (v.alerts ?? []) as string[];
      out.push({
        id: `ai-${v.id}`,
        at: v.created_at,
        kind: "ai",
        authorType: "ia",
        authorName: v.model || "Motor IA",
        itemId: v.item_id,
        itemLabel: itemLabelOf(it),
        body: (
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">
              Versão {v.version} · status:{" "}
              <span className="font-medium text-foreground">{v.ai_status}</span>
              {v.expected_amount != null && (
                <> · esperado: <span className="tabular-nums text-foreground">R$ {Number(v.expected_amount).toFixed(2)}</span></>
              )}
            </div>
            {alerts.length > 0 && (
              <ul className="space-y-0.5">
                {alerts.map((a, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-muted-foreground">•</span>
                    <span className="whitespace-pre-wrap">{a}</span>
                  </li>
                ))}
              </ul>
            )}
            {v.calculation_explanation && (
              <p className="text-muted-foreground italic">{v.calculation_explanation}</p>
            )}
          </div>
        ),
      });
    }

    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [observations, aiVersions, itemIds, itemMap, profiles]);

  const filtered = useMemo(() => {
    if (filterItem === "all") return entries;
    if (filterItem === "geral") return entries.filter((e) => e.itemId === null);
    return entries.filter((e) => e.itemId === filterItem);
  }, [entries, filterItem]);

  const itemOptions = useMemo(() => {
    return items
      .map((it) => ({
        id: it.id,
        label: itemLabelOf(it) ?? it.id.slice(0, 8),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [items]);

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Histórico unificado
            <Badge variant="secondary" className="ml-1">
              {filtered.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Item:</span>
            <Select value={filterItem} onValueChange={setFilterItem}>
              <SelectTrigger className="h-8 w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os itens + comentários gerais</SelectItem>
                <SelectItem value="geral">Somente comentários gerais</SelectItem>
                {itemOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Tudo o que aconteceu nesta empresa: análises da IA, comentários do
          analista, devoluções e revisões — em ordem cronológica, com autor e
          data/hora completos para auditoria.
        </p>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum registro de histórico para o filtro atual.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => {
              const Icon =
                e.kind === "ai"
                  ? Bot
                  : e.authorType === "sistema"
                  ? Sparkles
                  : e.authorType === "ia"
                  ? Bot
                  : MessageSquare;
              const tone =
                e.kind === "ai" || e.authorType === "ia"
                  ? "border-l-info"
                  : e.authorType === "validador"
                  ? "border-l-primary"
                  : e.authorType === "diretor"
                  ? "border-l-accent"
                  : e.authorType === "sistema"
                  ? "border-l-muted-foreground"
                  : "border-l-success";
              return (
                <li
                  key={e.id}
                  className={cn(
                    "rounded-md border bg-muted/20 px-3 py-2 text-xs border-l-4",
                    tone,
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mb-1">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="uppercase tracking-wide rounded px-1 py-0.5 bg-muted text-foreground/80">
                      {e.authorType}
                    </span>
                    {e.authorName && e.authorName !== "—" && (
                      <span className="flex items-center gap-1 text-foreground/80">
                        <UserIcon className="h-3 w-3" />
                        {e.authorName}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums">{fmtDate(e.at)}</span>
                  </div>
                  {e.itemLabel && (
                    <div className="text-[11px] text-muted-foreground mb-1">
                      Item: <span className="text-foreground">{e.itemLabel}</span>
                    </div>
                  )}
                  <div className="text-foreground">{e.body}</div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
