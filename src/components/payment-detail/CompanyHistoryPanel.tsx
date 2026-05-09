import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, User as UserIcon, UserCheck, FileDown, Info, ShieldAlert, Pencil } from "lucide-react";
import type {
  AiVersionRow,
  AssignmentRow,
  ObservationRow,
  PaymentItemRow,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";
import { authorRoleLabel, getRoleVisual } from "@/lib/observations";

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
  type?: string;
  authorType: string;
  authorName: string;
  itemId: string | null;
  itemLabel: string | null;
  body: React.ReactNode;
  /** Versão somente texto do body — usada na exportação em PDF. */
  bodyText: string;
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
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

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
        type: o.observation_type,
        authorType: o.author_type,
        authorName: o.author_id
          ? (profiles[o.author_id] ?? `Usuário ${o.author_id.slice(0, 8)}`)
          : (o.author_type === "sistema" || o.author_type === "ia" ? "Sistema" : "Usuário desconhecido"),
        itemId: o.item_id ?? null,
        itemLabel: itemLabelOf(it),
        bodyText: o.message ?? "",
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
      const aiHeader = `Versão ${v.version} · status: ${v.ai_status}`
        + (v.expected_amount != null ? ` · esperado: R$ ${Number(v.expected_amount).toFixed(2)}` : "");
      const aiBodyText = [
        aiHeader,
        ...alerts.map((a) => `• ${a}`),
        v.calculation_explanation ? v.calculation_explanation : "",
      ].filter(Boolean).join("\n");
      out.push({
        id: `ai-${v.id}`,
        at: v.created_at,
        kind: "ai",
        authorType: "ia",
        authorName: v.model || "Motor IA",
        itemId: v.item_id,
        itemLabel: itemLabelOf(it),
        bodyText: aiBodyText,
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

    // Atribuições (assumiu/transferiu) — escopo do lote inteiro, sempre
    // exibidas (não filtradas por item, pois afetam o lote todo).
    for (const a of assignments) {
      const analystName = profiles[a.analyst_id] || "—";
      const prevName = a.previous_analyst_id ? (profiles[a.previous_analyst_id] || "—") : null;
      const isTransfer = a.action === "transferiu";
      const assignText = `${analystName} ${
        isTransfer
          ? `assumiu o lote${prevName ? ` de ${prevName}` : ""}`
          : "assumiu o lote"
      }${a.source === "auto" ? " (registro automático na 1ª ação)" : ""}${a.note ? ` — ${a.note}` : ""}.`;
      out.push({
        id: `assign-${a.id}`,
        at: a.created_at,
        kind: "assign",
        authorType: isTransfer ? "transferência" : "atribuição",
        authorName: analystName,
        itemId: null,
        itemLabel: null,
        bodyText: assignText,
        body: (
          <p className="whitespace-pre-wrap">
            <strong>{analystName}</strong>{" "}
            {isTransfer ? (
              <>assumiu o lote {prevName ? <>de <strong>{prevName}</strong></> : null}</>
            ) : (
              <>assumiu o lote</>
            )}
            {a.source === "auto" ? " (registro automático na 1ª ação)" : ""}
            {a.note ? ` — ${a.note}` : ""}.
          </p>
        ),
      });
    }

    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [observations, aiVersions, assignments, itemIds, itemMap, profiles]);

  const filtered = useMemo(() => {
    let out = entries;
    if (filterItem === "geral") out = out.filter((e) => e.itemId === null);
    else if (filterItem !== "all") out = out.filter((e) => e.itemId === filterItem);
    if (filterRole !== "all") out = out.filter((e) => e.authorType === filterRole);
    if (filterType !== "all") {
      out = out.filter((e) => e.kind === "obs" && e.type === filterType);
    }
    return out;
  }, [entries, filterItem, filterRole, filterType]);

  const availableRoles = useMemo(() => {
    const order = ["analista", "validador", "diretor", "admin", "sistema", "ia"];
    const set = new Set<string>();
    entries.forEach((e) => e.authorType && set.add(e.authorType));
    return order.filter((r) => set.has(r));
  }, [entries]);

  const itemOptions = useMemo(() => {
    return items
      .map((it) => ({
        id: it.id,
        label: itemLabelOf(it) ?? it.id.slice(0, 8),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [items]);

  /**
   * Exporta o histórico atualmente filtrado para PDF (paisagem A4).
   * Inclui autor (nome + papel), data/hora, item relacionado e o conteúdo
   * em texto puro — útil para anexar em auditorias / atas.
   */
  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const generatedAt = new Date().toLocaleString("pt-BR");
    doc.setFontSize(14);
    doc.text("Histórico do pagamento", 40, 40);
    doc.setFontSize(9);
    doc.setTextColor(110);
    const filterDesc = [
      filterItem === "all" ? "Todos os itens" : filterItem === "geral" ? "Comentários gerais" : `Item: ${itemOptions.find((o) => o.id === filterItem)?.label ?? filterItem}`,
      filterRole === "all" ? "Todos os papéis" : `Papel: ${authorRoleLabel(filterRole)}`,
    ].join(" · ");
    doc.text(`Gerado em ${generatedAt} · ${filterDesc} · ${filtered.length} registro(s)`, 40, 56);
    doc.setTextColor(0);

    autoTable(doc, {
      startY: 72,
      head: [["Data/Hora", "Autor", "Papel", "Item", "Mensagem"]],
      body: filtered.map((e) => [
        fmtDate(e.at),
        e.authorName,
        authorRoleLabel(e.authorType),
        e.itemLabel ?? "—",
        e.bodyText || "—",
      ]),
      styles: { fontSize: 8, cellPadding: 4, valign: "top", overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 110 },
        2: { cellWidth: 70 },
        3: { cellWidth: 130 },
        4: { cellWidth: "auto" },
      },
      didDrawPage: (data) => {
        const str = `Página ${doc.getNumberOfPages()}`;
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(str, data.settings.margin.left, doc.internal.pageSize.height - 12);
        doc.setTextColor(0);
      },
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    doc.save(`historico-${stamp}.pdf`);
  };

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
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="text-xs text-muted-foreground">Papel:</span>
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os papéis</SelectItem>
                {availableRoles.map((r) => {
                  const v = getRoleVisual(r);
                  const RoleIcon = v.Icon;
                  return (
                    <SelectItem key={r} value={r}>
                      <span className="inline-flex items-center gap-2">
                        <RoleIcon className="h-3.5 w-3.5" />
                        {authorRoleLabel(r)}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Tipo:</span>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="informativo">Informativo</SelectItem>
                <SelectItem value="impacta_aprovacao">Impacta aprovação</SelectItem>
                <SelectItem value="justificativa_override">Justificativa</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={exportPdf}
              disabled={filtered.length === 0}
              title="Exportar histórico filtrado em PDF"
            >
              <FileDown className="h-3.5 w-3.5 mr-1.5" />
              Exportar PDF
            </Button>
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
              // Atribuição manual mantém ícone próprio (UserCheck);
              // demais entradas usam a identidade visual unificada por papel.
              const visual = getRoleVisual(
                e.kind === "ai" ? "ia" : e.authorType,
              );
              const Icon = e.kind === "assign" ? UserCheck : visual.Icon;
              const borderClass =
                e.kind === "assign" ? "border-l-warning" : visual.borderClass;
              return (
                <li
                  key={e.id}
                  className={cn(
                    "rounded-md border bg-muted/20 px-3 py-2 text-xs border-l-4",
                    borderClass,
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mb-1">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 uppercase tracking-wide",
                        e.kind === "assign"
                          ? "bg-warning-soft text-warning-foreground border-warning/40"
                          : visual.badgeClass,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {e.kind === "assign" ? "Atribuição" : authorRoleLabel(e.authorType)}
                    </span>
                    {e.kind === "obs" && e.type && e.type !== "informativo" && (
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "h-5 px-1.5 text-[10px] uppercase tracking-wider font-bold",
                          e.type === "impacta_aprovacao"
                            ? "border-amber-500/50 text-amber-700 bg-amber-100"
                            : "border-success/50 text-success-foreground bg-success/10"
                        )}
                      >
                        {e.type === "impacta_aprovacao" ? (
                          <ShieldAlert className="h-2.5 w-2.5 mr-1" />
                        ) : (
                          <Pencil className="h-2.5 w-2.5 mr-1" />
                        )}
                        {e.type === "impacta_aprovacao" ? "Impacta Aprovação" : "Justificativa"}
                      </Badge>
                    )}
                    {e.authorName && (
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
