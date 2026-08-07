import { CompanyMappingList } from "@/components/shared/CompanyMappingList";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import * as React from "react";
import { useEffect, useState } from "react";
import { DatePickerCombo } from "./DatePickerCombo";
import { setStoredMode } from "./reconModeStorage";
import { type Company, type Doctor, type ReconMode } from "./reconTypes";

export function NewView({
  hospitalId,
  userId,
  onCreated,
  onCancel,
}: {
  hospitalId: string | null;
  userId: string | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<"individual" | "multi_pj">("individual");
  const [doctorId, setDoctorId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [multiCompanyIds, setMultiCompanyIds] = useState<string[]>([]);
  const [multiDoctorIds, setMultiDoctorIds] = useState<string[]>([]);
  const [docOpen, setDocOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ReconMode>("alegacao_medico");
  // Lotes elegíveis no período (só usado em TASY vs Repasse).
  type LoteOpt = {
    id: string;
    label: string;
    competence: string;
    reference: string;
    company_ids: string[];
    doctor_ids: string[];
    // Centro de custos e trilha (prioritária/habitual/padrao) do lote —
    // herdados pela apuração para casar com o lote vigente na hora da glosa.
    cost_center_code: string | null;
    analysis_mode: string | null;
  };
  const [availableLotes, setAvailableLotes] = useState<LoteOpt[]>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(false);

  useEffect(() => {
    void (async () => {
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const [all, cs] = await Promise.all([
        fetchAllPaginated<Doctor>((from, to) =>
          supabase
            .from("doctors")
            .select("id, full_name, crm, crm_uf")
            .eq("active", true)
            .order("full_name")
            .range(from, to),
        ),
        fetchAllPaginated<Company>((from, to) =>
          supabase
            .from("companies")
            .select("id, name, document")
            .eq("active", true)
            .order("name")
            .range(from, to),
        ),
      ]);
      setDoctors(all);
      setCompanies(cs);
    })();
  }, []);

  // Busca lotes elegíveis no período (qualquer escopo de TASY vs Repasse).
  // Um lote é elegível quando seu competence_month cai entre start..end.
  // Necessário também no escopo individual para o analista fixar o universo —
  // sem lote fixo, o motor cai no fallback por competência e mistura outros lotes.
  useEffect(() => {
    if (mode !== "tasy_vs_repasse") {
      setAvailableLotes([]);
      setSelectedPaymentIds([]);
      return;
    }
    if (!hospitalId || !start || !end) {
      setAvailableLotes([]);
      setSelectedPaymentIds([]);
      return;
    }
    let cancelled = false;
    setLoadingLotes(true);
    void (async () => {
      try {
        const startComp = start.slice(0, 7);
        const endComp = end.slice(0, 7);
        const { data: payments } = await supabase
          .from("payments")
          .select("id, reference, competence_month, cost_center_code, analysis_mode")
          .eq("hospital_id", hospitalId)
          .gte("competence_month", `${startComp}-01`)
          .lte("competence_month", `${endComp}-01`)
          .order("competence_month", { ascending: false })
          .order("reference", { ascending: true });
        if (cancelled) return;
        const paymentRows = (payments ?? []) as Array<{
          id: string;
          reference: string | null;
          competence_month: string | null;
          cost_center_code: string | null;
          analysis_mode: string | null;
        }>;
        if (paymentRows.length === 0) {
          setAvailableLotes([]);
          setSelectedPaymentIds([]);
          setLoadingLotes(false);
          return;
        }
        const paymentIds = paymentRows.map((p) => p.id);
        const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
        const items = await fetchAllPaginated<{ payment_id: string; company_id: string | null; doctor_id: string | null }>(
          (from, to) =>
            supabase
              .from("payment_items")
              .select("payment_id, company_id, doctor_id")
              .in("payment_id", paymentIds)
              .range(from, to),
        );
        if (cancelled) return;
        const compsByPayment = new Map<string, Set<string>>();
        const docsByPayment = new Map<string, Set<string>>();
        for (const it of items) {
          if (!it.payment_id) continue;
          if (it.company_id) {
            const s = compsByPayment.get(it.payment_id) ?? new Set<string>();
            s.add(it.company_id);
            compsByPayment.set(it.payment_id, s);
          }
          if (it.doctor_id) {
            const s = docsByPayment.get(it.payment_id) ?? new Set<string>();
            s.add(it.doctor_id);
            docsByPayment.set(it.payment_id, s);
          }
        }
        const opts: LoteOpt[] = paymentRows.map((p) => {
          const comp = p.competence_month ? String(p.competence_month).slice(0, 7) : "";
          const ref = String(p.reference ?? "").trim();
          const label = ref
            ? `${comp || "?"} · ${ref}`
            : `${comp || "?"} · ${p.id.slice(0, 8)}`;
          return {
            id: p.id,
            label,
            competence: comp,
            reference: ref,
            company_ids: Array.from(compsByPayment.get(p.id) ?? []),
            doctor_ids: Array.from(docsByPayment.get(p.id) ?? []),
            cost_center_code: p.cost_center_code,
            analysis_mode: p.analysis_mode,
          };
        });
        setAvailableLotes(opts);
        // Padrão: nenhum lote pré-selecionado — analista decide.
        setSelectedPaymentIds([]);
      } finally {
        if (!cancelled) setLoadingLotes(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, hospitalId, start, end]);

  // Deriva PJs/médicos candidatos a partir dos lotes selecionados.
  // PJs padrão = todas dos lotes escolhidos; médicos padrão = nenhum (opcional).
  useEffect(() => {
    if (mode !== "tasy_vs_repasse" || scope !== "multi_pj") return;
    if (selectedPaymentIds.length === 0) {
      setMultiCompanyIds([]);
      setMultiDoctorIds([]);
      return;
    }
    const selected = availableLotes.filter((l) => selectedPaymentIds.includes(l.id));
    const comps = new Set<string>();
    for (const l of selected) for (const cid of l.company_ids) comps.add(cid);
    setMultiCompanyIds(Array.from(comps));
    setMultiDoctorIds([]);
  }, [selectedPaymentIds, availableLotes, mode, scope]);

  // Médicos candidatos derivados dos lotes selecionados.
  const candidateDoctorIds = React.useMemo(() => {
    if (mode !== "tasy_vs_repasse" || scope !== "multi_pj") return new Set<string>();
    const set = new Set<string>();
    for (const l of availableLotes) {
      if (!selectedPaymentIds.includes(l.id)) continue;
      for (const did of l.doctor_ids) set.add(did);
    }
    return set;
  }, [availableLotes, selectedPaymentIds, mode, scope]);

  const selectedDoctor = doctors.find((d) => d.id === doctorId);
  const selectedCompany = companies.find((c) => c.id === companyId);

  const submit = async () => {
    if (!hospitalId) {
      toast({ title: "Selecione um hospital ativo", variant: "destructive" });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const effStart = mode === "tasy_vs_repasse" ? (start || today) : start;
    const effEnd = mode === "tasy_vs_repasse" ? (end || today) : end;
    // "Múltiplas empresas" só existe em TASY vs Repasse. Em Alegação do
    // médico o escopo é sempre individual (1 médico e/ou 1 PJ).
    const isMulti = mode === "tasy_vs_repasse" && scope === "multi_pj";
    if (!title.trim()) {
      toast({ title: "Informe um título para a apuração", variant: "destructive" });
      return;
    }
    if (mode === "alegacao_medico") {
      if ((!doctorId && !companyId) || !start || !end) {
        toast({ title: "Selecione médico e/ou PJ e o período", variant: "destructive" });
        return;
      }
    } else if (mode === "tasy_vs_repasse") {
      if (!start || !end) {
        toast({ title: "Selecione o período (De/Até) antes de continuar", variant: "destructive" });
        return;
      }
      // Sem lote fixo, o motor cai no fallback por competência do mês e
      // mistura outros lotes na conta — bloqueamos a criação até o analista escolher.
      if (selectedPaymentIds.length === 0) {
        toast({ title: "Selecione ao menos um lote a analisar", variant: "destructive" });
        return;
      }
      if (isMulti && multiCompanyIds.length === 0 && multiDoctorIds.length === 0) {
        toast({ title: "Selecione ao menos uma PJ ou médico no mapeamento", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    const effectiveScope: "individual" | "multi_pj" = isMulti ? "multi_pj" : "individual";
    const summary: Record<string, unknown> = { mode, scope: effectiveScope };
    if (isMulti) {
      summary.multi_company_ids = multiCompanyIds;
      summary.multi_doctor_ids = multiDoctorIds;
      summary.multi_labels = {
        companies: multiCompanyIds.map((cid) => companies.find((c) => c.id === cid)?.name).filter(Boolean),
        doctors: multiDoctorIds.map((did) => doctors.find((d) => d.id === did)?.full_name).filter(Boolean),
      };
    }
    // Persiste os lotes selecionados INDEPENDENTE do modo/escopo — sem isso o
    // motor cai no filtro por competência e mistura outros lotes do mês.
    if (selectedPaymentIds.length > 0) {
      summary.selected_payment_ids = selectedPaymentIds;
      summary.selected_payment_labels = availableLotes
        .filter((l) => selectedPaymentIds.includes(l.id))
        .map((l) => l.label);
    }
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
        };
      };
    })
      .from("retroactive_reconciliations")
      .insert({
        hospital_id: hospitalId,
        doctor_id: isMulti ? null : (doctorId || null),
        company_id: isMulti ? null : (companyId || null),
        period_start: effStart,
        period_end: effEnd,
        title: title.trim(),
        summary,
        created_by: userId,
        // Herda origem do PRIMEIRO lote selecionado — âncora para casar
        // centro de custos + trilha na hora de calcular parcelamento da glosa.
        // Se múltiplos lotes tiverem CC/trilha diferentes, guarda o do primeiro
        // (analista pode revisar depois; a UI da glosa avisa quando divergir).
        source_payment_id: selectedPaymentIds[0] ?? null,
        cost_center_code:
          availableLotes.find((l) => l.id === selectedPaymentIds[0])?.cost_center_code ?? null,
        analysis_mode:
          availableLotes.find((l) => l.id === selectedPaymentIds[0])?.analysis_mode ?? null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao criar apuração", description: error?.message, variant: "destructive" });
      return;
    }
    const newId = (data as { id: string }).id;
    setStoredMode(newId, mode);
    onCreated(newId);
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={onCancel} className="self-start">
        <ArrowLeftIcon className="h-4 w-4 mr-1" /> Voltar
      </Button>
      <h3 className="text-lg font-semibold">Nova apuração retroativa</h3>

      <div className="rounded-lg border border-border bg-card p-3">
        <Label className="text-xs">Modo de apuração</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
          {([
            ["alegacao_medico", "Alegação do médico", "Médico/PJ informa o que faltou — cruza com o que já foi pago no sistema."],
            ["tasy_vs_repasse", "TASY vs Repasse", "Compara base TASY (realizado) com o repasse já gravado no sistema (payment_items). Análise ad-hoc, sem cruzamento via edge function."],
          ] as const).map(([k, lbl, desc]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={cn(
                "text-left rounded-md border px-3 py-2 transition-colors",
                mode === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                {mode === k && <CheckIcon className="h-3.5 w-3.5 text-primary" />}
                {lbl}
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {mode === "tasy_vs_repasse" && (
        <div className="rounded-lg border border-border bg-card p-3">
          <Label className="text-xs">Escopo da apuração</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
            {([
              ["individual", "Análise individual", "1 médico e/ou 1 PJ. Cruzamento restrito a esse par."],
              ["multi_pj", "Múltiplas empresas", "Várias PJs de vários médicos. Você seleciona o mapeamento manual."],
            ] as const).map(([k, lbl, desc]) => (
              <button
                key={k}
                type="button"
                onClick={() => setScope(k)}
                className={cn(
                  "text-left rounded-md border px-3 py-2 transition-colors",
                  scope === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                )}
              >
                <div className="text-sm font-medium flex items-center gap-2">
                  {scope === k && <CheckIcon className="h-3.5 w-3.5 text-primary" />}
                  {lbl}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground -mt-1">
        {mode === "alegacao_medico"
          ? "Informe o médico, a PJ, ou ambos. Selecionar a PJ restringe o cruzamento aos pagamentos daquela empresa."
          : (scope === "multi_pj"
              ? "Escolha primeiro o período. O sistema traz os lotes elegíveis; ao selecionar um ou mais, PJs e médicos ficam restritos ao universo desses lotes."
              : "Médico, PJ e período são opcionais — servem apenas para identificar esta apuração.")}
      </p>

      {/* Passo Data — visível em qualquer TASY vs Repasse (individual e multi_pj).
          Data é pré-requisito pra listar os lotes elegíveis abaixo. */}
      {mode === "tasy_vs_repasse" && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <Label className="text-xs">1. Período da apuração</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">De</Label>
              <DatePickerCombo value={start} onChange={setStart} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Até</Label>
              <DatePickerCombo value={end} onChange={setEnd} />
            </div>
          </div>
        </div>
      )}

      {/* Passo Lotes — visível em qualquer TASY vs Repasse após período preenchido.
          Sem lote fixado, o motor cai no fallback por competência do mês e
          contamina os totais com outros lotes — por isso é obrigatório. */}
      {mode === "tasy_vs_repasse" && start && end && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              2. Lote(s) a analisar {availableLotes.length > 0 && (
                <span className="text-muted-foreground font-normal">
                  · {selectedPaymentIds.length}/{availableLotes.length} selecionado{selectedPaymentIds.length === 1 ? "" : "s"}
                </span>
              )}
            </Label>
            {availableLotes.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => setSelectedPaymentIds(availableLotes.map((l) => l.id))}
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => setSelectedPaymentIds([])}
                >
                  Limpar
                </button>
              </div>
            )}
          </div>
          {loadingLotes ? (
            <div className="text-xs text-muted-foreground py-4 text-center">Buscando lotes no período…</div>
          ) : availableLotes.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Nenhum lote encontrado com competência entre {start.slice(0, 7)} e {end.slice(0, 7)}.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
              {availableLotes.map((l) => {
                const checked = selectedPaymentIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedPaymentIds((cur) =>
                          e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id),
                        );
                      }}
                      className="h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{l.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {l.company_ids.length} PJ{l.company_ids.length === 1 ? "" : "s"} · {l.doctor_ids.length} médico{l.doctor_ids.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {(mode === "alegacao_medico" || scope === "individual") && (
          <div className="md:col-span-2">
            <Label>Médico</Label>
            <Popover open={docOpen} onOpenChange={setDocOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !selectedDoctor && "text-muted-foreground")}>
                    {selectedDoctor
                      ? `${selectedDoctor.full_name} (${selectedDoctor.crm}/${selectedDoctor.crm_uf})`
                      : "Buscar médico por nome ou CRM…"}
                  </span>
                  <ChevronsUpDownIcon className="h-4 w-4 opacity-50 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command
                  filter={(value, search) => {
                    const s = search.toLowerCase();
                    return value.toLowerCase().includes(s) ? 1 : 0;
                  }}
                >
                  <CommandInput placeholder="Digite nome ou CRM…" />
                  <CommandList>
                    <CommandEmpty>Nenhum médico.</CommandEmpty>
                    <CommandGroup>
                      {doctorId && (
                        <CommandItem
                          value="__clear__"
                          onSelect={() => { setDoctorId(""); setDocOpen(false); }}
                        >
                          <span className="text-muted-foreground">Limpar seleção</span>
                        </CommandItem>
                      )}
                      {doctors.map((d) => {
                        const v = `${d.full_name} ${d.crm} ${d.crm_uf}`;
                        return (
                          <CommandItem
                            key={d.id}
                            value={v}
                            onSelect={() => { setDoctorId(d.id); setDocOpen(false); }}
                          >
                            <CheckIcon className={cn("h-4 w-4 mr-2", doctorId === d.id ? "opacity-100" : "opacity-0")} />
                            {d.full_name} <span className="ml-1 text-muted-foreground">({d.crm}/{d.crm_uf})</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
        {(mode === "alegacao_medico" || scope === "individual") && (
          <div className="md:col-span-2">
            <Label>PJ / Empresa</Label>
            <Popover open={compOpen} onOpenChange={setCompOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !selectedCompany && "text-muted-foreground")}>
                    {selectedCompany
                      ? `${selectedCompany.name}${selectedCompany.document ? ` · ${selectedCompany.document}` : ""}`
                      : "Buscar PJ por nome ou CNPJ…"}
                  </span>
                  <ChevronsUpDownIcon className="h-4 w-4 opacity-50 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Digite nome ou CNPJ…" />
                  <CommandList>
                    <CommandEmpty>Nenhuma PJ.</CommandEmpty>
                    <CommandGroup>
                      {companyId && (
                        <CommandItem
                          value="__clear__"
                          onSelect={() => { setCompanyId(""); setCompOpen(false); }}
                        >
                          <span className="text-muted-foreground">Limpar seleção</span>
                        </CommandItem>
                      )}
                      {companies.map((c) => {
                        const v = `${c.name} ${c.document ?? ""}`;
                        return (
                          <CommandItem
                            key={c.id}
                            value={v}
                            onSelect={() => { setCompanyId(c.id); setCompOpen(false); }}
                          >
                            <CheckIcon className={cn("h-4 w-4 mr-2", companyId === c.id ? "opacity-100" : "opacity-0")} />
                            {c.name}
                            {c.document && <span className="ml-1 text-muted-foreground">· {c.document}</span>}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {mode === "tasy_vs_repasse" && scope === "multi_pj" && selectedPaymentIds.length > 0 && (() => {
          const loteCompanyIds = new Set<string>();
          for (const l of availableLotes) {
            if (!selectedPaymentIds.includes(l.id)) continue;
            for (const cid of l.company_ids) loteCompanyIds.add(cid);
          }
          const scopedCompanies = companies.filter((c) => loteCompanyIds.has(c.id));
          return (
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>3. PJs incluídas ({multiCompanyIds.length}/{scopedCompanies.length})</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiCompanyIds(scopedCompanies.map((c) => c.id))}
                  >
                    Marcar todas
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiCompanyIds([])}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                PJs derivadas do(s) lote(s) selecionado(s). Padrão: todas incluídas.
              </p>
              <CompanyMappingList
                variant="checkbox"
                rows={scopedCompanies.map((c) => ({
                  key: c.id,
                  rawLabel: c.document ? `${c.name} · ${c.document}` : c.name,
                  level: null,
                }))}
                value={Object.fromEntries(scopedCompanies.map((c) => [c.id, multiCompanyIds.includes(c.id) ? c.id : null]))}
                onChange={(cid, next) =>
                  setMultiCompanyIds((cur) =>
                    next ? (cur.includes(cid) ? cur : [...cur, cid]) : cur.filter((x) => x !== cid),
                  )
                }
                maxHeight={220}
              />
            </div>
          );
        })()}

        {mode === "tasy_vs_repasse" && scope === "multi_pj" && selectedPaymentIds.length > 0 && (() => {
          const scopedDoctors = doctors.filter((d) => candidateDoctorIds.has(d.id));
          return (
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>
                  4. Médicos ({multiDoctorIds.length}/{scopedDoctors.length}){" "}
                  <span className="text-muted-foreground font-normal">— opcional</span>
                </Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiDoctorIds(scopedDoctors.map((d) => d.id))}
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setMultiDoctorIds([])}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Médicos derivados do(s) lote(s). Deixe todos desmarcados para incluir todos.
              </p>
              <CompanyMappingList
                variant="checkbox"
                rows={scopedDoctors.map((d) => ({
                  key: d.id,
                  rawLabel: `${d.full_name} (${d.crm}/${d.crm_uf})`,
                  level: null,
                }))}
                value={Object.fromEntries(scopedDoctors.map((d) => [d.id, multiDoctorIds.includes(d.id) ? d.id : null]))}
                onChange={(did, next) =>
                  setMultiDoctorIds((cur) =>
                    next ? (cur.includes(did) ? cur : [...cur, did]) : cur.filter((x) => x !== did),
                  )
                }
                maxHeight={220}
              />
            </div>
          );
        })()}

        {/* Datas em modos que não usam o passo de lotes (alegação ou individual) */}
        {!(mode === "tasy_vs_repasse" && scope === "multi_pj") && (
          <>
            <div>
              <Label>De</Label>
              <DatePickerCombo value={start} onChange={setStart} />
            </div>
            <div>
              <Label>Até</Label>
              <DatePickerCombo value={end} onChange={setEnd} />
            </div>
          </>
        )}
        <div className="md:col-span-2">
          <Label>Título <span className="text-destructive">*</span></Label>
          <Input
            placeholder="Ex.: Falta de pagamentos março/2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving}>
          {saving ? "Criando…" : "Criar e seguir"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/* -------------------------- DETAIL -------------------------- */
