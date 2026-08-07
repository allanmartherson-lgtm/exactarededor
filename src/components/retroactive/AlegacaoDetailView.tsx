import RetroactiveMappingWizard, { readRawSheet } from "./RetroactiveMappingWizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs as InnerTabs, TabsContent as InnerTabsContent, TabsList as InnerTabsList, TabsTrigger as InnerTabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { dbDateOrNull } from "@/lib/dateNormalize";
import { parseYmdLocal } from "@/lib/dateUtils";
import { learnCompanyAlias, shouldLearnAlias } from "@/lib/learnCompanyAlias";
import { brl, num } from "@/lib/tvr";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ArrowLeftIcon, CheckIcon, FileCheckIcon, PlayIcon, PlusIcon, Trash2Icon, UploadCloudIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { emptyDraft, parsePastedText } from "./draftItems";
import { CLASS_LABEL, CLASS_TONE, type DraftItem, type ItemRow, type ReconRow } from "./reconTypes";

export function AlegacaoDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  // hospitalId não usado neste view — companies aqui é cadastro estadual (sem escopo por hospital)
  const [recon, setRecon] = useState<ReconRow | null>(null);
  const [doctorName, setDoctorName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([emptyDraft()]);
  const [pasted, setPasted] = useState("");
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; aliases: string[] }>>([]);
  const [wizard, setWizard] = useState<
    | { open: false }
    | { open: true; fileName: string; headers: string[]; rows: Record<string, unknown>[] }
  >({ open: false });

  // Universo de PJs candidatas para o passo "Vincular PJs" do wizard.
  // companies é tabela de cadastro estadual (sem hospital_id) — alinhado ao
  // resto do fluxo de criação (linhas 577-585).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("companies")
        .select("id, name, aliases")
        .eq("active", true)
        .order("name");
      if (cancelled) return;
      setCompanies(((data ?? []) as Array<{ id: string; name: string; aliases: string[] | null }>).map((c) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases ?? [],
      })));
    })();
    return () => { cancelled = true; };
  }, []);

  const load = async () => {
    const { data: r } = await supabase
      .from("retroactive_reconciliations" as never)
      .select(
        "id, doctor_id, company_id, period_start, period_end, status, title, summary, adjustment_ids, created_at, concluded_at, source_payment_id, cost_center_code, analysis_mode",
      )
      .eq("id", id)
      .single();
    const row = r as unknown as ReconRow | null;
    setRecon(row);
    if (row?.doctor_id) {
      const { data: d } = await supabase
        .from("doctors")
        .select("full_name")
        .eq("id", row.doctor_id)
        .single();
      setDoctorName((d as { full_name?: string } | null)?.full_name ?? "");
    } else {
      setDoctorName("");
    }
    if (row?.company_id) {
      const { data: c } = await supabase
        .from("companies")
        .select("name")
        .eq("id", row.company_id)
        .single();
      setCompanyName((c as { name?: string } | null)?.name ?? "");
    } else {
      setCompanyName("");
    }
    // Pagina — sem isso apurações com >1000 itens ficam truncadas.
    const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
    const its = await fetchAllPaginated<ItemRow>((from, to) =>
      supabase
        .from("retroactive_reconciliation_items" as never)
        .select(
          "id, attendance, tuss_code, procedure_date, patient_name, function_label, procedure_name, claimed_amount, claimed_quantity, paid_amount, paid_quantity, expected_amount, gap_amount, matched_payment_date, classification, classification_reason, payment_id",
        )
        .eq("reconciliation_id", id)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    setItems(its as unknown as ItemRow[]);
  };

  useEffect(() => {
    void load();
  }, [id]);

  const addDraft = () => setDrafts((d) => [...d, emptyDraft()]);
  const updateDraft = (idx: number, patch: Partial<DraftItem>) =>
    setDrafts((d) => d.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const removeDraft = (idx: number) => setDrafts((d) => d.filter((_, i) => i !== idx));

  const onUpload = async (file: File) => {
    setUploadLoading(true);
    setUploadedFileName(file.name);
    try {
      const { headers, rows } = await readRawSheet(file);
      if (rows.length === 0) {
        toast({
          title: "Planilha vazia",
          description: "A primeira aba não tem linhas de dados.",
          variant: "destructive",
        });
        setUploadLoading(false);
        return;
      }
      setWizard({ open: true, fileName: file.name, headers, rows });
    } catch (e) {
      toast({
        title: "Erro ao ler planilha",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setUploadLoading(false);
    }
  };

  const applyMapping = (
    mapped: Record<string, string>[],
    meta?: { companyMapping?: Record<string, string | null> },
  ) => {
    const cMap = meta?.companyMapping ?? {};

    // Validação de schema: normaliza data e coleta linhas inválidas
    // (sem chave mínima ou com data em formato irreconhecível).
    const rejected: { line: number; reason: string }[] = [];
    const accepted: DraftItem[] = [];

    mapped.forEach((m, idx) => {
      const line = idx + 2; // header + 1-based
      const attendance = (m.attendance ?? "").trim();
      const tuss = (m.tuss_code ?? "").trim();
      const rawDate = (m.procedure_date ?? "").trim();

      if (!attendance && !tuss) {
        rejected.push({ line, reason: "sem atendimento nem TUSS" });
        return;
      }

      let normalizedDate = "";
      if (rawDate) {
        const ymd = dbDateOrNull(rawDate);
        if (!ymd) {
          rejected.push({ line, reason: `data inválida "${rawDate}" (use YYYY-MM-DD ou DD/MM/YYYY)` });
          return;
        }
        normalizedDate = ymd;
      }

      const claimedAmount = (m.claimed_amount ?? "").trim();
      if (claimedAmount && !Number.isFinite(num(claimedAmount))) {
        rejected.push({ line, reason: `valor inválido "${claimedAmount}"` });
        return;
      }

      const raw = (m.company_hint ?? "").trim();
      const resolvedCompanyId = raw ? cMap[raw] ?? null : null;
      accepted.push({
        _localId: crypto.randomUUID(),
        source: "upload",
        attendance,
        tuss_code: tuss,
        procedure_date: normalizedDate,
        patient_name: m.patient_name ?? "",
        function_label: m.function_label ?? "",
        procedure_name: m.procedure_name ?? "",
        claimed_amount: claimedAmount,
        claimed_quantity: m.claimed_quantity ?? "",
        company_hint: raw,
        resolved_company_id: resolvedCompanyId,
      });
    });

    setDrafts((d) => [...d.filter((x) => x.attendance || x.tuss_code), ...accepted]);
    setWizard({ open: false });

    // Persiste vínculos aprendidos (alias) + salva mapping no summary da reconciliação.
    void (async () => {
      if (!meta?.companyMapping) return;
      const entries = Object.entries(meta.companyMapping);
      let learned = 0;
      for (const [raw, companyId] of entries) {
        if (!companyId) continue;
        const company = companies.find((c) => c.id === companyId);
        if (!company) continue;
        if (!shouldLearnAlias(raw, company)) continue;
        const res = await learnCompanyAlias(supabase, { companyId, rawName: raw });
        if (res.ok) learned++;
      }
      // Persistir mapping no summary (auditoria, reaproveitamento).
      if (recon) {
        const nextSummary = {
          ...(recon.summary ?? {}),
          company_mapping: meta.companyMapping,
        };
        await supabase
          .from("retroactive_reconciliations" as never)
          .update({ summary: nextSummary } as never)
          .eq("id", id);
      }
      if (learned > 0) {
        toast({ title: `${learned} apelido(s) de PJ aprendido(s) para próximas importações` });
      }
    })();

    if (rejected.length > 0) {
      const preview = rejected.slice(0, 5).map((r) => `linha ${r.line}: ${r.reason}`).join(" · ");
      const extra = rejected.length > 5 ? ` (+${rejected.length - 5} outras)` : "";
      toast({
        title: `${rejected.length} linha(s) rejeitada(s) na validação`,
        description: `${preview}${extra}`,
        variant: "destructive",
      });
    }
    if (accepted.length > 0) {
      toast({ title: `${accepted.length} linha(s) carregadas da planilha` });
    } else if (rejected.length === 0) {
      toast({ title: "Nenhuma linha aproveitada", variant: "destructive" });
    }
  };

  const onPasteApply = () => {
    const parsed = parsePastedText(pasted);
    if (parsed.length === 0) {
      toast({ title: "Nada parseado do texto colado", variant: "destructive" });
      return;
    }
    setDrafts((d) => [...d.filter((x) => x.attendance || x.tuss_code), ...parsed]);
    setPasted("");
    toast({ title: `${parsed.length} linha(s) adicionadas` });
  };

  const runReconciliation = async () => {
    const valid = drafts.filter((d) => d.attendance || d.tuss_code || d.claimed_amount);
    if (valid.length === 0) {
      toast({ title: "Adicione ao menos um item", variant: "destructive" });
      return;
    }
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("run-retroactive-reconciliation", {
      body: {
        reconciliation_id: id,
        items: valid.map((d) => ({
          source: d.source,
          attendance: d.attendance || null,
          tuss_code: d.tuss_code || null,
          procedure_date: d.procedure_date || null,
          patient_name: d.patient_name || null,
          function_label: d.function_label || null,
          procedure_name: d.procedure_name || null,
          claimed_amount: d.claimed_amount ? Number(d.claimed_amount) : null,
          claimed_quantity: d.claimed_quantity ? Number(d.claimed_quantity) : 1,
        })),
      },
    });
    setRunning(false);
    if (error) {
      toast({ title: "Erro no cruzamento", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cruzamento concluído" });
    setDrafts([emptyDraft()]);
    await load();
    void data;
  };

  const generateAdjustment = async () => {
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("generate-retroactive-adjustment", {
      body: { reconciliation_id: id },
    });
    setGenerating(false);
    if (error || (data as { error?: string })?.error) {
      let msg = error?.message ?? (data as { error?: string })?.error ?? "Falha desconhecida";
      try {
        const ctxBody = (error?.context as { body?: unknown } | undefined)?.body;
        if (typeof ctxBody === "string") {
          const parsed = JSON.parse(ctxBody);
          if (parsed?.error) msg = String(parsed.error);
        }
      } catch {
        // keep msg
      }
      toast({ title: "Erro ao gerar ajuste", description: String(msg), variant: "destructive" });
      return;
    }
    toast({
      title: "Ajuste de complemento gerado",
      description: `Total ${brl((data as { total?: number })?.total)}`,
    });
    await load();
  };

  const [statusFilter, setStatusFilter] = useState<ItemRow["classification"] | "all">("all");
  const [procSearch, setProcSearch] = useState("");
  const filteredItems = useMemo(() => {
    const q = procSearch.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter !== "all" && i.classification !== statusFilter) return false;
      if (q && !(i.procedure_name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, statusFilter, procSearch]);

  // Extrai dos motivos da divergência ("...com TUSS X, Y, Z — alegado ...")
  function parseDivergence(reason: string | null): { tuss: string; valor: string } {
    if (!reason) return { tuss: "", valor: "" };
    const tussMatch = reason.match(/com TUSS\s+([0-9,\s]+?)\s+—/i);
    const valMatch = reason.match(/pago\s*\(R\$\s*([\d.,]+)\)/i);
    return {
      tuss: tussMatch ? tussMatch[1].trim() : "",
      valor: valMatch ? valMatch[1].trim() : "",
    };
  }

  // Formato seguro de data (evita shift de timezone com "YYYY-MM-DD")
  function fmtDate(d: string | null, pattern = "dd/MM/yyyy"): string {
    if (!d) return "—";
    const iso = d.slice(0, 10);
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return d;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return format(dt, pattern);
  }

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const rows = items.map((it) => {
      const div = parseDivergence(it.classification_reason);
      return {
        Médico: doctorName ?? "",
        Atendimento: it.attendance ?? "",

        "TUSS alegado": it.tuss_code ?? "",
        "TUSS pago no atendimento": div.tuss,
        "Valor pago no atendimento (divergência)": div.valor,
        Procedimento: it.procedure_name ?? "",
        "Data procedimento": fmtDate(it.procedure_date),
        Paciente: it.patient_name ?? "",
        Função: it.function_label ?? "",
        "Qtd alegada": it.claimed_quantity ?? "",
        "Qtd paga": it.paid_quantity ?? "",
        "Valor alegado": Number(it.claimed_amount ?? 0),
        "Valor pago": Number(it.paid_amount ?? 0),
        "Valor esperado": Number(it.expected_amount ?? 0),
        Gap: Number(it.gap_amount ?? 0),
        "Data pagamento encontrado": fmtDate(it.matched_payment_date),
        Status: CLASS_LABEL[it.classification],
        Motivo: it.classification_reason ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Apuração");
    const stamp = format(new Date(), "yyyyMMdd_HHmm");
    XLSX.writeFile(wb, `apuracao-retroativa_${stamp}.xlsx`);
  };


  const totalComplemento = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.classification === "nao_pago" ||
            i.classification === "pago_a_menos" ||
            i.classification === "tuss_divergente",
        )
        .reduce((s, i) => s + Number(i.gap_amount ?? 0), 0),
    [items],
  );




  if (!recon)
    return (
      <div>
        <Skeleton className="h-6 w-1/3" />
      </div>
    );

  const concluded = recon.status === "concluida";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h3 className="text-lg font-semibold">
              {recon.title ?? "Apuração retroativa"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {[doctorName, companyName].filter(Boolean).join(" · ") || "—"} · {format(parseYmdLocal(recon.period_start), "dd/MM/yy")} →{" "}
              {format(parseYmdLocal(recon.period_end), "dd/MM/yy")}
            </p>
          </div>
        </div>
        <Badge variant={concluded ? "outline" : "default"}>
          {concluded ? "Concluída" : "Em análise"}
        </Badge>
      </div>

      <div className="sticky top-0 z-30 -mx-1 rounded-lg border border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2 text-xs shadow-sm">
        <div className="font-medium text-foreground mb-2">
          Legenda dos status · significado, gap e ação recomendada
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-1.5">
          {(
            [
              ["ok_pago", "Pago conforme regra.", "Gap: 0.", "Nenhuma."],
              ["pago_a_menos", "Pago menos que o esperado (valor/quantidade).", "Gap: esperado − pago.", "Complementar a diferença."],
              ["pago_a_mais", "Pago mais que o alegado (quantidade excedente).", "Excedente: unitário × qtd a mais.", "Revisar duplicidade / cobrar de volta."],
              ["tuss_divergente", "Atendimento pago, mas TUSS alegado não está no lote.", "Gap: valor alegado integral.", "Complementar — TUSS faltou."],
              ["nao_pago", "Atendimento inteiro não localizado nos pagamentos.", "Gap: valor alegado integral.", "Investigar antes de pagar."],
              ["pago_outro_mes", "Pago fora da janela apurada.", "Gap: 0 nesta apuração.", "Verificar outra apuração."],
              ["sem_lastro", "Sem match e sem valor alegado.", "Gap: indeterminado.", "Pedir mais informação ao médico."],
            ] as const
          ).map(([k, sig, gap, acao]) => (
            <div key={k} className="flex items-start gap-2">
              <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${CLASS_TONE[k]}`}>
                {CLASS_LABEL[k]}
              </span>
              <div className="leading-tight">
                <div>{sig}</div>
                <div className="text-muted-foreground"><strong>{gap}</strong> · {acao}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground border-t border-border pt-1.5">
          <strong>Total a complementar</strong> = <em>Pago a menos</em> + <em>Não pago</em> + <em>Pendência (TUSS faltante)</em>.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {(
          [
            ["ok_pago", "OK pago"],
            ["pago_a_menos", "Pago a menos"],
            ["pago_a_mais", "Pago a mais"],
            ["tuss_divergente", "TUSS divergente"],
            ["nao_pago", "Não pago"],
            ["pago_outro_mes", "Outro mês"],
            ["sem_lastro", "Sem lastro"],
          ] as const

        ).map(([k, lbl]) => (
          <div key={k} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {lbl}
            </div>
            <div className="text-xl font-semibold">{recon.summary?.[k] ?? 0}</div>
          </div>
        ))}
      </div>


      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Total a complementar
          </div>
          <div className="text-2xl font-semibold text-primary">{brl(totalComplemento)}</div>
        </div>
        {!concluded && totalComplemento > 0 && (
          <Button onClick={generateAdjustment} disabled={generating}>
            <FileCheckIcon className="h-4 w-4 mr-1" />
            {generating ? "Gerando…" : "Gerar ajuste de complemento"}
          </Button>
        )}
        {concluded && recon.adjustment_ids.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Ajuste gerado: <span className="font-mono">{recon.adjustment_ids[0].slice(0, 8)}…</span>
          </div>
        )}
      </div>

      {!concluded && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold mb-3">Lista alegada pelo médico</h4>
          <InnerTabs defaultValue="form">
            <InnerTabsList>
              <InnerTabsTrigger value="form">Formulário</InnerTabsTrigger>
              <InnerTabsTrigger value="upload">Planilha</InnerTabsTrigger>
              <InnerTabsTrigger value="paste">Colar texto</InnerTabsTrigger>
            </InnerTabsList>

            <InnerTabsContent value="form" className="mt-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-2 py-1">Atendimento</th>
                      <th className="px-2 py-1">TUSS</th>
                      <th className="px-2 py-1">Data</th>
                      <th className="px-2 py-1">Paciente</th>
                      <th className="px-2 py-1">Função</th>
                      <th className="px-2 py-1">Qtd</th>
                      <th className="px-2 py-1">Valor alegado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d, idx) => (
                      <tr key={d._localId} className="border-t border-border">
                        <td className="p-1">
                          <Input
                            value={d.attendance}
                            onChange={(e) => updateDraft(idx, { attendance: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={d.tuss_code}
                            onChange={(e) => updateDraft(idx, { tuss_code: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <DateInput value={d.procedure_date} onChange={(v) => updateDraft(idx, { procedure_date: v })} />
                        </td>
                        <td className="p-1">
                          <Input
                            value={d.patient_name}
                            onChange={(e) => updateDraft(idx, { patient_name: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            value={d.function_label}
                            onChange={(e) => updateDraft(idx, { function_label: e.target.value })}
                          />
                        </td>
                        <td className="p-1 w-20">
                          <Input
                            value={d.claimed_quantity}
                            onChange={(e) => updateDraft(idx, { claimed_quantity: e.target.value })}
                            placeholder="1"
                          />
                        </td>
                        <td className="p-1 w-32">
                          <Input
                            value={d.claimed_amount}
                            onChange={(e) => updateDraft(idx, { claimed_amount: e.target.value })}
                            placeholder="0,00"
                          />
                        </td>
                        <td className="p-1">
                          <Button variant="ghost" size="icon" onClick={() => removeDraft(idx)}>
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" onClick={addDraft} className="mt-2">
                <PlusIcon className="h-4 w-4 mr-1" /> Adicionar linha
              </Button>
            </InnerTabsContent>

            <InnerTabsContent value="upload" className="mt-3 space-y-3">
              <label
                className={cn(
                  "flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-8 cursor-pointer hover:bg-muted/40",
                  uploadLoading && "opacity-60 pointer-events-none",
                )}
              >
                <UploadCloudIcon className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm">
                  {uploadLoading ? "Lendo planilha…" : "Selecionar arquivo (.xlsx ou .csv)"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Após selecionar, abre o mapeamento de colunas. Linhas só entram depois de você confirmar.
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={uploadLoading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>

              {(() => {
                const uploadedCount = drafts.filter(
                  (d) => d.source === "upload" && (d.attendance || d.tuss_code),
                ).length;
                if (uploadedCount === 0 && !uploadedFileName) return null;
                return (
                  <div className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckIcon className="h-4 w-4 text-emerald-600" />
                      <span>
                        <strong>{uploadedCount}</strong> linha(s) carregada(s)
                        {uploadedFileName && <> de <span className="font-mono">{uploadedFileName}</span></>}
                        . Vá para <strong>Formulário</strong> para revisar ou clique em <strong>Rodar cruzamento</strong>.
                      </span>
                    </div>
                    {uploadedCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDrafts((d) => d.filter((x) => x.source !== "upload"));
                          setUploadedFileName("");
                          toast({ title: "Linhas da planilha removidas" });
                        }}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                );
              })()}
            </InnerTabsContent>

            <InnerTabsContent value="paste" className="mt-3">
              <Textarea
                rows={8}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Cole uma linha por item. Separadores aceitos: tab, ; ou múltiplos espaços."
              />
              <Button size="sm" onClick={onPasteApply} className="mt-2">
                Adicionar
              </Button>
            </InnerTabsContent>
          </InnerTabs>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground max-w-xl leading-relaxed">
              O cruzamento <strong>não recalcula regras</strong>. Ele compara cada linha alegada com o
              <code className="mx-1 px-1 bg-muted rounded">expected_amount</code> já gravado em
              <code className="mx-1 px-1 bg-muted rounded">payment_items</code> do médico/PJ na janela ±90d.
              Itens sem match aparecem como <em>não pago</em> ou <em>sem lastro</em>.
            </p>
            <Button onClick={runReconciliation} disabled={running}>
              <PlayIcon className="h-4 w-4 mr-1" />
              {running ? "Cruzando…" : `Rodar cruzamento (${drafts.filter((d) => d.attendance || d.tuss_code || d.claimed_amount).length})`}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-semibold">Resultado</h4>
            <span className="text-xs text-muted-foreground">
              {filteredItems.length} de {items.length} item(ns)
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={procSearch}
              onChange={(e) => setProcSearch(e.target.value)}
              placeholder="Buscar procedimento…"
              className="h-8 w-[200px] text-xs"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Filtrar status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {(["ok_pago", "pago_a_menos", "pago_a_mais", "tuss_divergente", "nao_pago", "pago_outro_mes", "sem_lastro"] as const).map((k) => (
                  <SelectItem key={k} value={k}>{CLASS_LABEL[k]}</SelectItem>
                ))}

              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportXlsx} disabled={items.length === 0}>
              Exportar Excel
            </Button>
          </div>

        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Médico</TableHead>
                <TableHead>Atendimento</TableHead>

                <TableHead>TUSS</TableHead>
                <TableHead>Procedimento</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead className="text-center">Qtd aleg.</TableHead>
                <TableHead className="text-center">Qtd paga</TableHead>
                <TableHead>Alegado</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Esperado</TableHead>
                <TableHead>Gap</TableHead>
                <TableHead>Pago em</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                    {items.length === 0
                      ? "Nenhum item processado ainda."
                      : "Nenhum item neste filtro."}
                  </TableCell>
                </TableRow>
              )}
              {filteredItems.map((it) => {
                const qtyShort =
                  it.claimed_quantity != null &&
                  it.paid_quantity != null &&
                  Number(it.paid_quantity) < Number(it.claimed_quantity);
                const outOfWindow = it.classification === "pago_outro_mes";
                return (
                  <TableRow key={it.id}>
                    <TableCell className="max-w-[160px] truncate" title={doctorName ?? undefined}>
                      {doctorName ?? "—"}
                    </TableCell>
                    <TableCell>{it.attendance ?? "—"}</TableCell>

                    <TableCell>{it.tuss_code ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={it.procedure_name ?? undefined}>
                      {it.procedure_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {fmtDate(it.procedure_date, "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{it.patient_name ?? "—"}</TableCell>
                    <TableCell className="text-center">{it.claimed_quantity ?? "—"}</TableCell>
                    <TableCell className={`text-center ${qtyShort ? "font-semibold text-amber-700" : ""}`}>
                      {it.paid_quantity ?? "—"}
                    </TableCell>
                    <TableCell>{brl(it.claimed_amount)}</TableCell>
                    <TableCell>{brl(it.paid_amount)}</TableCell>
                    <TableCell>{brl(it.expected_amount)}</TableCell>
                    <TableCell
                      className={
                        Number(it.gap_amount ?? 0) > 0
                          ? "font-semibold text-red-700"
                          : "text-muted-foreground"
                      }
                    >
                      {brl(it.gap_amount)}
                    </TableCell>
                    <TableCell className={outOfWindow ? "text-blue-700 font-medium" : "text-muted-foreground"}>
                      {fmtDate(it.matched_payment_date, "dd/MM/yyyy")}

                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${CLASS_TONE[it.classification]}`}
                        title={it.classification_reason ?? undefined}
                      >
                        {CLASS_LABEL[it.classification]}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {wizard.open && (
        <RetroactiveMappingWizard
          open={wizard.open}
          fileName={wizard.fileName}
          headers={wizard.headers}
          rows={wizard.rows}
          companyMappingConfig={companies.length > 0 ? { companies } : undefined}
          onCancel={() => setWizard({ open: false })}
          onConfirm={applyMapping}
        />
      )}
    </div>
  );
}

/* ===================================================================
 * TASY vs Repasse — modo independente, 100% em memória, sem edge function
 * =================================================================== */

