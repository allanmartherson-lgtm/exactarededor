/**
 * AssistanceAlertsDetailModal
 * Detalhamento dedicado dos alertas assistenciais de um lote (gerados pela
 * validate-payment e persistidos em payment_items.validation_findings).
 * Lista cada finding com item afetado x item em conflito e exporta CSV.
 *
 * Independente do relatório geral (aprovados/reprovados): este foca apenas
 * em assistencial (sobreposição, parecer→cirurgia, duplicidade, etc.).
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, Search, List, Users, ArrowUp, ArrowDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type ConflictingSnap = {
  attendance_number?: string | null;
  patient_name?: string | null;
  procedure_code?: string | null;
  procedure_name?: string | null;
  doctor_name?: string | null;
  procedure_date?: string | null;
  company_name?: string | null;
  payment_id?: string | null;
  payment_reference?: string | null;
};

type Finding = {
  rule_id?: string;
  rule_name?: string;
  kind?: string;
  severity?: string;
  action?: string;
  message?: string;
  conflicting_item_id?: string;
  conflicting_item?: ConflictingSnap;
  detected_at?: string;
};

type ItemRow = {
  id: string;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  procedure_date: string | null;
  doctor_name: string | null;
  patient_name: string | null;
  company_name: string | null;
  gross_amount: number | null;
  validation_findings?: unknown;
};

export type AssistanceAlertRow = {
  itemId: string;
  rule_name: string;
  kind: string;
  severity: string;
  message: string;
  attendance: string;
  doctor: string;
  patient: string;
  company: string;
  procedure_code: string;
  procedure_name: string;
  procedure_date: string;
  gross_amount: number;
  conflicting_doctor: string;
  conflicting_procedure: string;
  conflicting_date: string;
  conflicting_attendance: string;
  conflicting_payment_ref: string;
  conflicting_item_id: string;
  conflicting_gross_amount: number;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: ItemRow[];
  paymentReference?: string | null;
}

function fmtDate(s: string | null | undefined): string {
  // UTC-safe: usa os 10 primeiros caracteres do ISO (yyyy-mm-dd) para bater
  // exatamente com a chave de agrupamento do motor (procedure_date.slice(0,10)).
  // Evita que timestamps 00:00Z apareçam "no dia anterior" em navegadores UTC-3.
  if (!s) return "—";
  const iso = String(s).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return String(s);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",;\n]/.test(s) ? `"${s}"` : s;
}

export function AssistanceAlertsDetailModal({ open, onOpenChange, items, paymentReference }: Props) {
  const [query, setQuery] = useState("");
  const [ruleFilter, setRuleFilter] = useState<string>("__all__");
  const [viewMode, setViewMode] = useState<"list" | "grouped">("grouped");
  const [conflictGross, setConflictGross] = useState<Record<string, number>>({});

  const rows: AssistanceAlertRow[] = useMemo(() => {
    const out: AssistanceAlertRow[] = [];
    for (const it of items) {
      const findings = it.validation_findings;
      if (!Array.isArray(findings)) continue;
      for (const fRaw of findings as Finding[]) {
        const f = fRaw ?? {};
        const c = f.conflicting_item ?? {};
        const cid = f.conflicting_item_id ?? "";
        out.push({
          itemId: it.id,
          rule_name: f.rule_name ?? "Regra sem nome",
          kind: f.kind ?? "",
          severity: f.severity ?? "",
          message: f.message ?? "",
          attendance: it.attendance_number ?? "",
          doctor: it.doctor_name ?? "",
          patient: it.patient_name ?? "",
          company: it.company_name ?? "",
          procedure_code: it.procedure_code ?? "",
          procedure_name: it.procedure_name ?? "",
          procedure_date: it.procedure_date ?? "",
          gross_amount: Number(it.gross_amount ?? 0),
          conflicting_doctor: c.doctor_name ?? "",
          conflicting_procedure: c.procedure_name ?? "",
          conflicting_date: c.procedure_date ?? "",
          conflicting_attendance: c.attendance_number ?? "",
          conflicting_payment_ref: c.payment_reference ?? "",
          conflicting_item_id: cid,
          conflicting_gross_amount: cid ? Number(conflictGross[cid] ?? 0) : 0,
        });
      }
    }
    return out;
  }, [items, conflictGross]);

  // Busca gross_amount dos itens conflitantes (podem estar em outros lotes),
  // pois o snapshot em validation_findings não persiste valor. Sem isso, o
  // "valor em risco" só refletia o lote atual.
  useEffect(() => {
    if (!open) return;
    const ids = new Set<string>();
    for (const it of items) {
      const findings = it.validation_findings;
      if (!Array.isArray(findings)) continue;
      for (const f of findings as Finding[]) {
        const cid = f?.conflicting_item_id;
        if (cid) ids.add(cid);
      }
    }
    const missing = Array.from(ids).filter((id) => !(id in conflictGross));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const chunkSize = 200;
      const acc: Record<string, number> = {};
      for (let i = 0; i < missing.length; i += chunkSize) {
        const slice = missing.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("payment_items")
          .select("id, gross_amount")
          .in("id", slice);
        if (error) continue;
        for (const r of data ?? []) acc[r.id as string] = Number(r.gross_amount ?? 0);
      }
      if (!cancelled) setConflictGross((prev) => ({ ...prev, ...acc }));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, items, conflictGross]);


  const rules = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.rule_name));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (ruleFilter !== "__all__" && r.rule_name !== ruleFilter) return false;
      if (!q) return true;
      return (
        r.doctor.toLowerCase().includes(q) ||
        r.patient.toLowerCase().includes(q) ||
        r.attendance.toLowerCase().includes(q) ||
        r.procedure_name.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.message.toLowerCase().includes(q)
      );
    });
  }, [rows, query, ruleFilter]);

  // "Valor em risco" = soma por item_id ÚNICO (lote atual + itens conflitantes
  // de outros lotes). Cada par conflitante gera 2 findings simétricos, então a
  // dedup precisa usar o item_id real, sem prefixo por papel.
  const totalValor = useMemo(() => {
    let total = 0;
    const seen = new Set<string>();
    for (const r of filtered) {
      if (r.itemId && !seen.has(r.itemId)) {
        seen.add(r.itemId);
        total += r.gross_amount;
      }
      if (r.conflicting_item_id && !seen.has(r.conflicting_item_id)) {
        seen.add(r.conflicting_item_id);
        total += r.conflicting_gross_amount;
      }
    }
    return total;
  }, [filtered]);
  const byRule = useMemo(() => {
    const m = new Map<string, { n: number; v: number }>();
    const seenPerRule = new Map<string, Set<string>>();
    filtered.forEach((r) => {
      const cur = m.get(r.rule_name) ?? { n: 0, v: 0 };
      cur.n += 1;
      let seen = seenPerRule.get(r.rule_name);
      if (!seen) { seen = new Set(); seenPerRule.set(r.rule_name, seen); }
      if (r.itemId && !seen.has(r.itemId)) {
        seen.add(r.itemId);
        cur.v += r.gross_amount;
      }
      if (r.conflicting_item_id && !seen.has(r.conflicting_item_id)) {
        seen.add(r.conflicting_item_id);
        cur.v += r.conflicting_gross_amount;
      }
      m.set(r.rule_name, cur);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].n - a[1].n);
  }, [filtered]);


  // Agrupa alertas por PACIENTE (todas as datas juntas). Mostra a timeline
  // completa das visitas/pareceres do paciente no período, tanto do lote
  // atual quanto dos itens conflitantes de outros lotes.
  type TimelineEntry = {
    procedure_name: string;
    procedure_code: string;
    doctor: string;
    attendance: string;
    payment_ref: string;
    rule_name: string;
    gross_amount: number;
    procedure_date: string;
    isConflict: boolean;
  };
  type SortKey = "date" | "doctor" | "procedure" | "attendance" | "value";
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const grouped = useMemo(() => {
    const map = new Map<string, {
      key: string;
      patient: string;
      dates: Set<string>;
      rows: AssistanceAlertRow[];
      timeline: TimelineEntry[];
      total: number;
    }>();
    const seen = new Set<string>();
    for (const r of filtered) {
      const patientKey = (r.patient || "").toLowerCase().trim() || "__sem_paciente__";
      let g = map.get(patientKey);
      if (!g) {
        g = { key: patientKey, patient: r.patient, dates: new Set(), rows: [], timeline: [], total: 0 };
        map.set(patientKey, g);
      }
      g.rows.push(r);
      if (r.procedure_date) g.dates.add((r.procedure_date || "").slice(0, 10));
      // Dedup pela identidade real do item: o mesmo item aparece como dono de
      // um finding e como conflitante do finding simétrico do par.
      const curId = r.itemId ? `item|${r.itemId}` : null;
      if (curId && !seen.has(curId)) {
        seen.add(curId);
        g.total += r.gross_amount;
        g.timeline.push({
          procedure_name: r.procedure_name,
          procedure_code: r.procedure_code,
          doctor: r.doctor,
          attendance: r.attendance,
          payment_ref: paymentReference ?? "",
          rule_name: r.rule_name,
          gross_amount: r.gross_amount,
          procedure_date: r.procedure_date,
          isConflict: false,
        });
      }
      if (r.conflicting_procedure || r.conflicting_doctor || r.conflicting_attendance) {
        const cid = r.conflicting_item_id
          ? `item|${r.conflicting_item_id}`
          : `conf|${r.itemId}|${r.conflicting_attendance}|${r.conflicting_procedure}|${r.conflicting_payment_ref}`;
        if (!seen.has(cid)) {
          seen.add(cid);
          g.total += r.conflicting_gross_amount;
          if (r.conflicting_date) g.dates.add((r.conflicting_date || "").slice(0, 10));
          g.timeline.push({
            procedure_name: r.conflicting_procedure,
            procedure_code: "",
            doctor: r.conflicting_doctor,
            attendance: r.conflicting_attendance,
            payment_ref: r.conflicting_payment_ref,
            rule_name: r.rule_name,
            gross_amount: r.conflicting_gross_amount,
            procedure_date: r.conflicting_date,
            isConflict: true,
          });
        }
      }

    }
    // ordena timeline de cada grupo
    const dirMul = sortDir === "asc" ? 1 : -1;
    const cmp = (a: TimelineEntry, b: TimelineEntry): number => {
      switch (sortKey) {
        case "date": return ((a.procedure_date || "").localeCompare(b.procedure_date || "")) * dirMul;
        case "doctor": return a.doctor.localeCompare(b.doctor, "pt-BR") * dirMul;
        case "procedure": return a.procedure_name.localeCompare(b.procedure_name, "pt-BR") * dirMul;
        case "attendance": return a.attendance.localeCompare(b.attendance) * dirMul;
        case "value": return (a.gross_amount - b.gross_amount) * dirMul;
      }
    };
    for (const g of map.values()) g.timeline.sort(cmp);
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered, paymentReference, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "value" ? "desc" : "asc"); }
  };
  const SortIcon = ({ k }: { k: SortKey }) => sortKey !== k
    ? <span className="inline-block w-3" />
    : (sortDir === "asc" ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />);

  function exportCsv() {
    const headers = [
      "Regra", "Severidade", "Tipo", "Mensagem",
      "Atendimento", "Médico", "Paciente", "Empresa",
      "TUSS", "Procedimento", "Data Proc.", "Valor (R$)",
      "Médico em conflito", "Procedimento em conflito", "Data conflito", "Atendimento conflito", "Lote conflito",
    ];
    const lines = [headers.join(";")];
    for (const r of filtered) {
      lines.push([
        csvEscape(r.rule_name), csvEscape(r.severity), csvEscape(r.kind), csvEscape(r.message),
        csvEscape(r.attendance), csvEscape(r.doctor), csvEscape(r.patient), csvEscape(r.company),
        csvEscape(r.procedure_code), csvEscape(r.procedure_name), csvEscape(fmtDate(r.procedure_date)),
        csvEscape(r.gross_amount.toFixed(2).replace(".", ",")),
        csvEscape(r.conflicting_doctor), csvEscape(r.conflicting_procedure),
        csvEscape(fmtDate(r.conflicting_date)), csvEscape(r.conflicting_attendance),
        csvEscape(r.conflicting_payment_ref),
      ].join(";"));
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (paymentReference ?? "lote").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    a.download = `alertas_assistenciais_${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 bg-gradient-to-r from-warning/20 via-warning-soft/40 to-warning/10 border-b-2 border-warning/40">
          <DialogTitle className="text-warning-foreground flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-warning animate-pulse" />
            Alertas Assistenciais — detalhamento
          </DialogTitle>
          <p className="text-xs text-foreground/70">
            {paymentReference ? <span className="font-medium">{paymentReference}</span> : null}
            {paymentReference ? " · " : ""}
            Cruzamentos detectados pelo motor assistencial. Valor em risco inclui itens conflitantes de outros lotes.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-muted/30">


        {/* Resumo por regra */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {byRule.map(([name, agg]) => (
            <button
              key={name}
              type="button"
              onClick={() => setRuleFilter(ruleFilter === name ? "__all__" : name)}
              className={`text-left rounded-md border p-2 text-xs hover:bg-muted/40 transition ${ruleFilter === name ? "border-warning bg-warning-soft/40" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{name}</span>
                <Badge variant="outline" className="shrink-0">{agg.n}</Badge>
              </div>
              <div className="text-[10px] text-red-600 mt-0.5">{fmtCurrency(agg.v)} em risco</div>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por médico, paciente, atendimento, procedimento…"
              className="pl-7 h-8 text-xs"
            />
          </div>
          <div className="inline-flex rounded-md border bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("grouped")}
              className={`px-2.5 h-8 text-xs flex items-center gap-1 ${viewMode === "grouped" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              title="Agrupado por paciente + data"
            >
              <Users className="h-3.5 w-3.5" /> Por paciente
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 h-8 text-xs flex items-center gap-1 border-l ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              title="Lista de alertas"
            >
              <List className="h-3.5 w-3.5" /> Lista
            </button>
          </div>
          {ruleFilter !== "__all__" && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRuleFilter("__all__")}>
              Limpar filtro de regra
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5" />
            Exportar CSV ({filtered.length})
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{filtered.length}</span> alerta(s) listado(s) ·{" "}
          <span className="text-red-600 font-medium">{fmtCurrency(totalValor)}</span> em risco
        </div>

        {viewMode === "list" ? (
          /* Tabela */
          <div className="overflow-auto border-2 border-border rounded-lg flex-1 bg-card shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-gradient-to-r from-warning/15 to-warning/5 sticky top-0 z-10 border-b-2 border-warning/30">
                <tr>
                  <th className="text-left p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Regra</th>
                  <th className="text-left p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Atendimento</th>
                  <th className="text-left p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Médico / Paciente</th>
                  <th className="text-left p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Procedimento</th>
                  <th className="text-left p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Data</th>
                  <th className="text-right p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Valor</th>
                  <th className="text-left p-2.5 font-semibold text-foreground uppercase text-[10px] tracking-wide">Em conflito com</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-6 text-muted-foreground italic">
                      Nenhum alerta no filtro atual.
                    </td>
                  </tr>
                ) : filtered.map((r, idx) => (
                  <tr key={`${r.itemId}-${idx}`} className={`border-t border-border/60 hover:bg-warning/10 transition-colors ${idx % 2 === 0 ? "bg-card" : "bg-muted/40"}`}>
                    <td className="p-2 align-top">
                      <div className="font-medium">{r.rule_name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-2" title={r.message}>{r.message}</div>
                    </td>
                    <td className="p-2 align-top font-mono">{r.attendance || "—"}</td>
                    <td className="p-2 align-top">
                      <div>{r.doctor || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{r.patient || ""}</div>
                      <div className="text-[10px] text-muted-foreground">{r.company || ""}</div>
                    </td>
                    <td className="p-2 align-top">
                      <div>{r.procedure_name || "—"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.procedure_code}</div>
                    </td>
                    <td className="p-2 align-top">{fmtDate(r.procedure_date)}</td>
                    <td className="p-2 align-top text-right text-red-600 font-medium">{fmtCurrency(r.gross_amount)}</td>
                    <td className="p-2 align-top">
                      {r.conflicting_doctor || r.conflicting_procedure ? (
                        <>
                          <div>{r.conflicting_doctor || "—"}</div>
                          <div className="text-[10px] text-muted-foreground">{r.conflicting_procedure}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(r.conflicting_date)}
                            {r.conflicting_attendance ? ` · Atend. ${r.conflicting_attendance}` : ""}
                            {r.conflicting_payment_ref ? ` · Lote ${r.conflicting_payment_ref}` : ""}
                          </div>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Agrupado por paciente + data */
          <div className="overflow-auto border-2 border-border rounded-lg flex-1 bg-card shadow-sm p-3 space-y-3">
            {grouped.length === 0 ? (
              <div className="text-center p-6 text-muted-foreground italic text-xs">
                Nenhum alerta no filtro atual.
              </div>
            ) : grouped.map((g) => {
              const lotes = Array.from(new Set([paymentReference ?? "Lote atual", ...g.rows.map((r) => r.conflicting_payment_ref).filter(Boolean)]));
              const crossBatch = g.rows.some((r) => r.conflicting_payment_ref && r.conflicting_payment_ref !== paymentReference);
              const datesArr = Array.from(g.dates).sort();
              const datesLabel = datesArr.length === 0
                ? "—"
                : datesArr.length <= 3
                  ? datesArr.map(fmtDate).join(", ")
                  : `${datesArr.length} datas: ${fmtDate(datesArr[0])} → ${fmtDate(datesArr[datesArr.length - 1])}`;
              return (
                <div key={g.key} className="border rounded-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-warning/20 to-warning/5 px-3 py-2 border-b flex items-center gap-3 flex-wrap">
                    <div className="font-semibold text-sm">{g.patient || "Paciente não informado"}</div>
                    <Badge variant="outline" className="text-[10px]" title={datesArr.map(fmtDate).join(", ")}>
                      {datesArr.length} dia(s): {datesLabel}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{g.timeline.length} lançamento(s)</Badge>
                    {crossBatch && <Badge className="bg-red-600 text-white text-[10px]">Entre lotes</Badge>}
                    <div className="text-[10px] text-muted-foreground ml-auto">
                      Lotes: <span className="font-medium">{lotes.join(" · ")}</span>
                    </div>
                    <div className="text-xs text-red-600 font-semibold">{fmtCurrency(g.total)}</div>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-[10px] uppercase">
                      <tr>
                        <th className="text-left p-2 cursor-pointer select-none" onClick={() => toggleSort("date")}>Data <SortIcon k="date" /></th>
                        <th className="text-left p-2 cursor-pointer select-none" onClick={() => toggleSort("procedure")}>Procedimento <SortIcon k="procedure" /></th>
                        <th className="text-left p-2 cursor-pointer select-none" onClick={() => toggleSort("doctor")}>Médico <SortIcon k="doctor" /></th>
                        <th className="text-left p-2 cursor-pointer select-none" onClick={() => toggleSort("attendance")}>Atend. <SortIcon k="attendance" /></th>
                        <th className="text-left p-2">Lote</th>
                        <th className="text-left p-2">Regra</th>
                        <th className="text-right p-2 cursor-pointer select-none" onClick={() => toggleSort("value")}>Valor <SortIcon k="value" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.timeline.map((e, i) => (
                        <tr key={i} className={`border-t ${e.isConflict ? "bg-red-50/40" : ""}`}>
                          <td className="p-2 whitespace-nowrap">{fmtDate(e.procedure_date)}</td>
                          <td className="p-2">
                            <div>{e.procedure_name || "—"}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{e.procedure_code}</div>
                          </td>
                          <td className="p-2">{e.doctor || "—"}</td>
                          <td className="p-2 font-mono text-[10px]">{e.attendance || "—"}</td>
                          <td className="p-2">
                            <span className={e.isConflict ? "text-red-600 font-medium" : ""}>
                              {e.payment_ref || (e.isConflict ? "outro lote" : paymentReference || "—")}
                            </span>
                          </td>
                          <td className="p-2 text-[10px]">{e.rule_name || "—"}</td>
                          <td className="p-2 text-right font-medium">{e.gross_amount ? fmtCurrency(e.gross_amount) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>

  );
}
