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
  const reqId = useRef(0);

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

  const insertLink = async (doctorId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    return supabase
      .from("doctor_companies")
      .insert({ doctor id: doctorId, company_id: companyId, start_date: today } as any);
  };

  const add = async (doctor: Doctor) => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctor.id, company_id: companyId, start_date: today });

    if (!error) {
      await loadLinks();
      setSearch("");
      setShowPicker(false);
      toast({ title: "Médico vinculado", description: doctor.full_name });
      return;
    }

    // Conflito de sobreposição → oferecer transferência
    const msg = (error.message ?? "").toLowerCase();
    const isOverlap = /overlap|exclusion|no_overlap|conflict/.test(msg);
    if (!isOverlap) {
      toast({ title: "Erro ao vincular", description: error.message, variant: "destructive" });
      return;
    }

    // Buscar vínculo aberto atual em outra empresa
    const { data: cur } = await supabase
      .from("doctor_companies")
      .select("id, company_id, start_date, companies:company_id(name)")
      .eq("doctor_id", doctor.id)
      .is("end_date", null)
      .order("start_date", { ascending: false })
      .limit(1);
    const current = (cur ?? [])[0] as
      | { id: string; company_id: string; start_date: string | null; companies?: { name: string } | null }
      | undefined;
    const currentCompanyName = current?.companies?.name ?? "(empresa desconhecida)";

    const ok = await confirmDialog({
      title: "Transferir vínculo do médico?",
      description: (
        <>
          <strong>{doctor.full_name}</strong> já tem vínculo aberto com{" "}
          <strong>{currentCompanyName}</strong>{current?.start_date ? ` (desde ${fmtBR(current.start_date)})` : ""}.
          <br />
          Para vincular a esta empresa, o vínculo anterior precisa ser encerrado hoje.
        </>
      ),
      details: "Esta ação preserva o histórico — o vínculo anterior fica com data de encerramento de hoje, e um novo vínculo é criado começando hoje.",
      tone: "warning",
      confirmText: "Transferir agora",
      cancelText: "Cancelar",
    });
    if (!ok || !current) return;

    // 1) encerra o anterior
    const upd = await supabase
      .from("doctor_companies")
      .update({ end_date: today, end_reason: "transferencia_vinculo" })
      .eq("id", current.id);
    if (upd.error) {
      toast({ title: "Falha ao encerrar vínculo anterior", description: upd.error.message, variant: "destructive" });
      return;
    }
    // 2) cria o novo
    const ins = await supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctor.id, company_id: companyId, start_date: today });
    if (ins.error) {
      toast({ title: "Falha ao criar novo vínculo", description: ins.error.message, variant: "destructive" });
      return;
    }
    await loadLinks();
    setSearch("");
    setShowPicker(false);
    toast({ title: "Vínculo transferido", description: `${doctor.full_name} agora está vinculado a esta empresa.` });
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
