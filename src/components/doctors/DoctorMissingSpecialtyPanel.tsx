import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { COMMON_SPECIALTIES } from "@/lib/specialties";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { Stethoscope, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";

type Row = {
  doctor_name_raw: string;
  doctor_name_norm: string;
  total_gross: number;
  n_items: number;
  matched_doctor_id: string | null;
  matched_doctor_name: string | null;
  current_specialties: string[] | null;
};

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);

export function DoctorMissingSpecialtyPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_doctors_missing_specialty" as any);
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
      setDrafts({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.doctor_name_raw.toLowerCase().includes(q) ||
      (r.matched_doctor_name ?? "").toLowerCase().includes(q)
    );
  }, [rows, filter]);

  const totalMissing = useMemo(
    () => rows.reduce((s, r) => s + Number(r.total_gross || 0), 0),
    [rows]
  );

  const save = async (row: Row) => {
    if (!row.matched_doctor_id) return;
    const next = drafts[row.matched_doctor_id] ?? row.current_specialties ?? [];
    if (next.length === 0) {
      toast({ title: "Selecione ao menos uma especialidade", variant: "destructive" });
      return;
    }
    setSavingId(row.matched_doctor_id);
    const { error } = await supabase
      .from("doctors")
      .update({ specialties: next })
      .eq("id", row.matched_doctor_id);
    setSavingId(null);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Especialidades atualizadas", description: row.matched_doctor_name ?? row.doctor_name_raw });
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-md border bg-muted/30">
        <Stethoscope className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="text-sm text-muted-foreground">
          Médicos que aparecem nas bases sem especialidade resolvida (nem no item, nem no cadastro). Atribuir a especialidade aqui atualiza diretamente o cadastro do médico e remove o caso do balde "(sem especialidade)" nos relatórios.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{rows.length} médicos</Badge>
        <Badge variant="outline">{formatBRL(totalMissing)} sem especialidade</Badge>
        <Badge variant="outline" className="bg-warning-soft text-warning-text border-warning/30">
          {rows.filter((r) => !r.matched_doctor_id).length} sem cadastro
        </Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Recarregar
        </Button>
      </div>

      <Input
        placeholder="Filtrar por nome…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="border rounded-lg overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left whitespace-nowrap">
                <th className="p-3">Nome (base)</th>
                <th className="p-3">Médico cadastrado</th>
                <th className="p-3 text-right">Total bruto</th>
                <th className="p-3 text-right">Itens</th>
                <th className="p-3 min-w-[280px]">Especialidades</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">
                  <CheckCircle2 className="h-5 w-5 text-success inline mr-2" />
                  Nenhum médico com especialidade pendente.
                </td></tr>
              )}
              {filtered.map((r) => {
                const key = r.matched_doctor_id ?? r.doctor_name_norm;
                const draft = r.matched_doctor_id
                  ? (drafts[r.matched_doctor_id] ?? r.current_specialties ?? [])
                  : [];
                const dirty = r.matched_doctor_id
                  ? JSON.stringify(draft) !== JSON.stringify(r.current_specialties ?? [])
                  : false;
                return (
                  <tr key={key} className="hover:bg-muted/30 align-top">
                    <td className="p-3 font-medium">{r.doctor_name_raw}</td>
                    <td className="p-3">
                      {r.matched_doctor_id ? (
                        <span className="text-muted-foreground">{r.matched_doctor_name}</span>
                      ) : (
                        <Badge variant="outline" className="bg-warning-soft text-warning-text border-warning/30">
                          <AlertCircle className="h-3 w-3 mr-1" /> Sem cadastro
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap font-mono text-xs">{formatBRL(Number(r.total_gross || 0))}</td>
                    <td className="p-3 text-right whitespace-nowrap">{r.n_items}</td>
                    <td className="p-3">
                      {r.matched_doctor_id ? (
                        <MultiSelectChips
                          options={COMMON_SPECIALTIES}
                          value={draft}
                          onChange={(v) =>
                            setDrafts((p) => ({ ...p, [r.matched_doctor_id as string]: v }))
                          }
                          placeholder="Selecionar especialidades…"
                          allowCreate
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">Cadastre o médico em "Cadastro de médicos" para atribuir especialidade.</span>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {r.matched_doctor_id && (
                        <Button
                          size="sm"
                          onClick={() => save(r)}
                          disabled={!dirty || savingId === r.matched_doctor_id}
                        >
                          {savingId === r.matched_doctor_id ? "Salvando…" : "Salvar"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
