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

const norm = (s: string) =>
  (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Lista, adiciona e remove vínculos de médicos a uma empresa.
 * Salva imediatamente em doctor_companies (autônomo do form pai).
 */
export function CompanyDoctorsSection({ companyId }: { companyId: string }) {
  const [allDoctors, setAllDoctors] = useState<Doctor[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const [d, l] = await Promise.all([
        supabase.from("doctors").select("id,full_name,crm,crm_uf,active").order("full_name").limit(20000),
        supabase.from("doctor_companies").select("doctor_id").eq("company_id", companyId),
      ]);
      setAllDoctors((d.data ?? []) as Doctor[]);
      setLinkedIds(((l.data ?? []) as { doctor_id: string }[]).map((x) => x.doctor_id));
    })();
  }, [companyId]);

  const linked = useMemo(
    () => allDoctors.filter((d) => linkedIds.includes(d.id)),
    [allDoctors, linkedIds],
  );

  const available = useMemo(() => {
    const q = norm(search);
    return allDoctors
      .filter((d) => !linkedIds.includes(d.id))
      .filter((d) => !q || norm(`${d.full_name} ${d.crm} ${d.crm_uf}`).includes(q));
  }, [allDoctors, linkedIds, search]);

  const add = async (doctorId: string) => {
    const { error } = await supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctorId, company_id: companyId });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setLinkedIds([...linkedIds, doctorId]);
  };

  const remove = async (doctorId: string) => {
    const { error } = await supabase
      .from("doctor_companies")
      .delete()
      .eq("doctor_id", doctorId)
      .eq("company_id", companyId);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setLinkedIds(linkedIds.filter((id) => id !== doctorId));
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
            <button onClick={() => remove(d.id)} aria-label={`Remover ${d.full_name}`}>
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
