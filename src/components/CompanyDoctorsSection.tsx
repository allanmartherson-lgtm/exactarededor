import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stethoscope, X, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Doctor {
  id: string;
  full_name: string;
  crm: string;
  crm_uf: string;
  active: boolean;
}

interface LinkRow {
  doctor_id: string;
  start_date: string | null;
  end_date: string | null;
}

const norm = (s: string) =>
  (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const fmtBR = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—";

/**
 * Lista, adiciona e encerra vínculos de médicos a uma empresa.
 * Vínculo tem vigência (start_date / end_date). Encerrar = setar end_date,
 * preserva histórico para auditoria e para o motor de pagamento/glosa.
 */
export function CompanyDoctorsSection({ companyId }: { companyId: string }) {
  const [allDoctors, setAllDoctors] = useState<Doctor[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const [d, l] = await Promise.all([
        supabase.from("doctors").select("id,full_name,crm,crm_uf,active").order("full_name").limit(20000),
        supabase
          .from("doctor_companies")
          .select("doctor_id,start_date,end_date")
          .eq("company_id", companyId),
      ]);
      setAllDoctors((d.data ?? []) as Doctor[]);
      setLinks((l.data ?? []) as LinkRow[]);
    })();
  }, [companyId]);

  // Vínculos ativos = end_date IS NULL (em aberto)
  const activeLinks = useMemo(() => links.filter((l) => !l.end_date), [links]);
  const activeIds = useMemo(() => new Set(activeLinks.map((l) => l.doctor_id)), [activeLinks]);

  const linked = useMemo(
    () =>
      activeLinks
        .map((l) => {
          const d = allDoctors.find((x) => x.id === l.doctor_id);
          return d ? { ...d, start_date: l.start_date } : null;
        })
        .filter(Boolean) as (Doctor & { start_date: string | null })[],
    [allDoctors, activeLinks],
  );

  const available = useMemo(() => {
    const q = norm(search);
    return allDoctors
      .filter((d) => !activeIds.has(d.id))
      .filter((d) => !q || norm(`${d.full_name} ${d.crm} ${d.crm_uf}`).includes(q));
  }, [allDoctors, activeIds, search]);

  const add = async (doctorId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctorId, company_id: companyId, start_date: today });
    if (error) {
      toast({
        title: "Não foi possível vincular",
        description: "Este médico já possui PJ vigente em sobreposição. Encerre a anterior primeiro.",
        variant: "destructive",
      });
      return;
    }
    setLinks([...links, { doctor_id: doctorId, start_date: today, end_date: null }]);
  };

  const end = async (doctorId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("doctor_companies")
      .update({ end_date: today, end_reason: "desvinculo_manual" })
      .eq("doctor_id", doctorId)
      .eq("company_id", companyId)
      .is("end_date", null);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setLinks(links.map((l) =>
      l.doctor_id === doctorId && !l.end_date ? { ...l, end_date: today } : l,
    ));
  };


  if (!companyId) {
    return (
      <p className="text-xs text-muted-foreground">
        Salve a empresa primeiro para vincular médicos.
      </p>
    );
  }

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
          <Input
            autoFocus
            placeholder="Buscar por nome ou CRM..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">
                {allDoctors.length === 0
                  ? "Nenhum médico cadastrado ainda."
                  : "Nenhum médico encontrado."}
              </p>
            ) : (
              available.slice(0, 500).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { add(d.id); }}
                  className="w-full text-left text-sm hover:bg-muted/50 rounded px-2 py-1 flex items-center justify-between gap-2"
                >
                  <span>{d.full_name}</span>
                  <span className="text-xs text-muted-foreground cell-mono">{d.crm}/{d.crm_uf}</span>
                </button>
              ))
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
