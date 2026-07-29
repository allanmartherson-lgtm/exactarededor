import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stethoscope, X, ExternalLink, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { confirmDialog } from "@/lib/confirm";
import { DoctorCompanySyncFaq } from "@/components/DoctorCompanySyncFaq";
import { DateInput } from "@/components/ui/date-input";
import { resolveActiveHospitalId } from "@/lib/resolveActiveHospitalId";

interface Doctor {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
}

interface LinkRow {
  doctor_id: string;
  start_date: string | null;
  end_date: string | null;
}

const fmtBR = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—";

const PAGE = 30;

/**
 * Lista, adiciona e encerra vínculos de médicos a uma empresa.
 *
 * Busca server-side (debounced + paginada) — necessário porque a base
 * tem milhares de médicos e o fetch único cliente-side ficava capado em 1000.
 *
 * Conflito de vigência (constraint `doctor_companies_no_overlap`): quando o
 * médico já tem vínculo aberto em outra empresa, oferecemos transferir
 * (encerra o anterior + cria o novo) em vez de só bloquear.
 */
export function CompanyDoctorsSection({ companyId }: { companyId: string }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linkedDoctors, setLinkedDoctors] = useState<Record<string, Doctor>>({});
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<Doctor[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const reqId = useRef(0);

  const addDays = (iso: string, days: number) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };


  // carrega vínculos atuais + nomes dos médicos vinculados
  const loadLinks = async () => {
    const { data } = await supabase
      .from("doctor_companies")
      .select("doctor_id,start_date,end_date")
      .eq("company_id", companyId);
    const ls = (data ?? []) as LinkRow[];
    setLinks(ls);
    const ids = Array.from(new Set(ls.filter((l) => !l.end_date).map((l) => l.doctor_id)));
    if (ids.length) {
      const { data: docs } = await supabase
        .from("doctors")
        .select("id,full_name,crm,crm_uf")
        .in("id", ids);
      const map: Record<string, Doctor> = {};
      for (const d of (docs ?? []) as Doctor[]) map[d.id] = d;
      setLinkedDoctors(map);
    } else {
      setLinkedDoctors({});
    }
  };

  useEffect(() => {
    if (!companyId) return;
    void loadLinks();

    // Realtime: vínculos editados na tela de Médicos (ou outra aba) refletem aqui.
    const ch = supabase
      .channel(`doctor_companies:${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "doctor_companies", filter: `company_id=eq.${companyId}` },
        () => { void loadLinks(); },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);


  // debounce de busca
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (showPicker) setPage(0);
  }, [debounced, showPicker]);

  // busca server-side
  useEffect(() => {
    if (!showPicker) return;
    const myId = ++reqId.current;
    setSearching(true);
    const from = page * PAGE;
    const to = from + PAGE - 1;
    let q = supabase
      .from("doctors")
      .select("id,full_name,crm,crm_uf", { count: "exact" })
      .eq("active", true);
    const term = debounced.trim();
    if (term) {
      const safe = term.replace(/[%,]/g, " ");
      const ors = [`full_name.ilike.%${safe}%`];
      if (/^\d+$/.test(term)) ors.push(`crm.ilike.%${term}%`);
      q = q.or(ors.join(","));
    }
    q.order("full_name").range(from, to).then(({ data, count }) => {
      if (reqId.current !== myId) return;
      const next = (data ?? []) as Doctor[];
      setResults((prev) => (page === 0 ? next : [...prev, ...next]));
      setHasMore((count ?? 0) > to + 1);
      setSearching(false);
    });
  }, [debounced, page, showPicker]);

  const activeLinks = useMemo(() => links.filter((l) => !l.end_date), [links]);
  const activeIds = useMemo(() => new Set(activeLinks.map((l) => l.doctor_id)), [activeLinks]);

  const linked = useMemo(
    () =>
      activeLinks
        .map((l) => {
          const d = linkedDoctors[l.doctor_id];
          return d ? { ...d, start_date: l.start_date } : null;
        })
        .filter(Boolean) as (Doctor & { start_date: string | null })[],
    [linkedDoctors, activeLinks],
  );

  const tryInsert = async (doctorId: string, startDate: string) =>
    supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctorId, company_id: companyId, start_date: startDate });

  const finishAdd = async (doctor: Doctor, label: string) => {
    await loadLinks();
    setSearch("");
    setShowPicker(false);
    toast({ title: label, description: doctor.full_name });
  };

  const add = async (doctor: Doctor) => {
    const start = startDate || new Date().toISOString().slice(0, 10);
    const dayBefore = addDays(start, -1);

    const first = await tryInsert(doctor.id, start);
    if (!first.error) { await finishAdd(doctor, "Médico vinculado"); return; }

    const msg = (first.error.message ?? "").toLowerCase();
    const isOverlap = /overlap|exclusion|no_overlap|conflict/.test(msg);
    if (!isOverlap) {
      toast({ title: "Erro ao vincular", description: first.error.message, variant: "destructive" });
      return;
    }

    // Busca TODOS vínculos do médico cujo intervalo toca a data escolhida
    // (constraint usa range inclusivo — vínculos encerrados no próprio "start" também bloqueiam).
    const { data: conflicts } = await supabase
      .from("doctor_companies")
      .select("id, company_id, start_date, end_date, end_reason, companies:company_id(name)")
      .eq("doctor_id", doctor.id)
      .lte("start_date", start)
      .or(`end_date.is.null,end_date.gte.${start}`);

    type Row = {
      id: string;
      company_id: string;
      start_date: string | null;
      end_date: string | null;
      end_reason: string | null;
      companies?: { name: string } | null;
    };
    const rows = (conflicts ?? []) as Row[];
    const active = rows.find((r) => !r.end_date);
    const closed = rows.filter((r) => r.end_date);

    // Caso 1: vínculo ATIVO em outra PJ → pedir confirmação para transferir
    if (active) {
      const prevCompanyName = active.companies?.name ?? "(empresa desconhecida)";
      const willDeletePrev = !!(active.start_date && active.start_date >= start);
      const ok = await confirmDialog({
        title: "Transferir vínculo do médico?",
        description: (
          <div className="space-y-3">
            <p>
              <strong>{doctor.full_name}</strong> tem vínculo aberto com{" "}
              <strong>{prevCompanyName}</strong>
              {active.start_date ? ` desde ${fmtBR(active.start_date)}` : ""}.
            </p>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
              <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                Pré-visualização da vigência
              </div>
              <div className="grid grid-cols-[60px_1fr] gap-x-3 gap-y-2 items-start">
                <span className="text-muted-foreground pt-0.5">Antes</span>
                <div>
                  <Badge variant="outline" className="mr-1.5">{prevCompanyName}</Badge>
                  {fmtBR(active.start_date)} <span className="text-muted-foreground">→</span>{" "}
                  <span className="text-muted-foreground">em aberto</span>
                </div>

                <span className="text-muted-foreground pt-0.5">Depois</span>
                <div className="space-y-1.5">
                  <div>
                    <Badge variant="outline" className="mr-1.5">{prevCompanyName}</Badge>
                    {willDeletePrev ? (
                      <span className="text-destructive">removido (vínculo zero-day em {fmtBR(active.start_date)})</span>
                    ) : (
                      <>
                        {fmtBR(active.start_date)} <span className="text-muted-foreground">→</span>{" "}
                        <strong>{fmtBR(dayBefore)}</strong>
                      </>
                    )}
                  </div>
                  <div>
                    <Badge variant="secondary" className="mr-1.5">Nova PJ</Badge>
                    <strong>{fmtBR(start)}</strong> <span className="text-muted-foreground">→</span>{" "}
                    <span className="text-muted-foreground">em aberto</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ),
        details:
          "O vínculo anterior fica com data de encerramento no dia anterior à nova vigência (para evitar sobreposição) e o novo vínculo começa na data escolhida. O histórico é preservado — pagamentos anteriores continuam atribuídos à PJ correta.",
        tone: "warning",
        confirmText: "Transferir agora",
        cancelText: "Cancelar",
      });
      if (!ok) return;

      // Se o vínculo começou no mesmo dia ou depois, não dá pra encerrar antes.
      // Fazemos soft-close (end_date = start_date, "zero-day") — o trigger block_physical_delete
      // proíbe delete físico, e o soft-close preserva rastro na auditoria.
      if (active.start_date && active.start_date >= start) {
        const upd = await supabase
          .from("doctor_companies")
          .update({ end_date: active.start_date, end_reason: "transferencia_vinculo_zero_day" })
          .eq("id", active.id);
        if (upd.error) {
          toast({ title: "Falha ao encerrar vínculo anterior", description: upd.error.message, variant: "destructive" });
          return;
        }
      } else {
        const upd = await supabase
          .from("doctor_companies")
          .update({ end_date: dayBefore, end_reason: "transferencia_vinculo" })
          .eq("id", active.id);
        if (upd.error) {
          toast({ title: "Falha ao encerrar vínculo anterior", description: upd.error.message, variant: "destructive" });
          return;
        }
      }
    }

    // Caso 2: vínculos JÁ ENCERRADOS que ainda bloqueiam o range inclusivo.
    // Recua end_date em 1 dia; se zero-day, mantém end_date=start_date (não deleta).
    for (const c of closed) {
      if (!c.end_date) continue;
      if (c.start_date && c.start_date >= start) {
        const upd = await supabase
          .from("doctor_companies")
          .update({ end_date: c.start_date, end_reason: c.end_reason ?? "ajuste_zero_day" })
          .eq("id", c.id);
        if (upd.error) {
          toast({ title: "Falha ao limpar vínculo residual", description: upd.error.message, variant: "destructive" });
          return;
        }
      } else if (c.end_date >= start) {
        const upd = await supabase
          .from("doctor_companies")
          .update({ end_date: dayBefore })
          .eq("id", c.id);
        if (upd.error) {
          toast({ title: "Falha ao ajustar vínculo anterior", description: upd.error.message, variant: "destructive" });
          return;
        }
      }
    }

    // Retry insert
    const second = await tryInsert(doctor.id, start);
    if (second.error) {
      toast({ title: "Não foi possível vincular", description: second.error.message, variant: "destructive" });
      return;
    }
    await finishAdd(doctor, active ? "Vínculo transferido" : "Médico vinculado");

  };


  const end = async (doctorId: string) => {
    const ok = await confirmDialog({
      title: "Encerrar vínculo?",
      description: "O vínculo será encerrado hoje. O histórico é preservado para auditoria.",
      tone: "warning",
      confirmText: "Encerrar",
    });
    if (!ok) return;
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("doctor_companies")
      .update({ end_date: today, end_reason: "desvinculo_manual" })
      .eq("doctor_id", doctorId)
      .eq("company_id", companyId)
      .is("end_date", null);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    await loadLinks();
  };


  if (!companyId) {
    return (
      <p className="text-xs text-muted-foreground">
        Salve a empresa primeiro para vincular médicos.
      </p>
    );
  }

  const visibleResults = results.filter((d) => !activeIds.has(d.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Médicos vinculados</Label>
        <Link
          to="/medicos"
          className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
        >
          Gerenciar <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <p className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded px-2 py-1">
        Alterações aqui e no cadastro do médico são sincronizadas automaticamente entre as duas telas.
      </p>
      <DoctorCompanySyncFaq compact />
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {linked.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhum médico vinculado.</span>
        )}
        {linked.map((d) => (
          <Badge key={d.id} variant="secondary" className="gap-1">
            {d.full_name} <span className="text-muted-foreground text-[10px]">{d.crm}/{d.crm_uf}</span>
            <span className="text-muted-foreground text-[10px]">desde {fmtBR(d.start_date)}</span>
            <button onClick={() => end(d.id)} aria-label={`Encerrar vínculo de ${d.full_name}`} title="Encerrar vínculo (hoje)">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

      </div>
      {!showPicker ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setShowPicker(true)}>
          + Adicionar médico
        </Button>
      ) : (
        <div className="border border-border rounded-md p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="link-start-date" className="text-xs text-muted-foreground shrink-0">
              Início do vínculo
            </Label>
            <DateInput value={startDate} onChange={setStartDate} id="link-start-date" className="h-8 w-40" />
            <span className="text-[11px] text-muted-foreground">
              Se houver vínculo em outra PJ, será encerrado no dia anterior a esta data.
            </span>
          </div>
          <div className="flex items-center gap-2 border-b border-border pb-1.5">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              autoFocus
              placeholder="Buscar por nome ou CRM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0 h-8 px-0"
            />
            {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1">
            {!searching && visibleResults.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">
                Nenhum médico encontrado{debounced ? ` para "${debounced}"` : ""}.
              </p>
            ) : (
              visibleResults.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { void add(d); }}
                  className="w-full text-left text-sm hover:bg-muted/50 rounded px-2 py-1 flex items-center justify-between gap-2"
                >
                  <span className="truncate">{d.full_name}</span>
                  <span className="text-xs text-muted-foreground cell-mono shrink-0">{d.crm ?? "—"}/{d.crm_uf ?? ""}</span>
                </button>
              ))
            )}
            {hasMore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={searching}
                onClick={() => setPage((p) => p + 1)}
              >
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
                Carregar mais
              </Button>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setShowPicker(false); setSearch(""); }}>
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
