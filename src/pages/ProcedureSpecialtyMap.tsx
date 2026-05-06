import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "@/hooks/use-toast";
import { Stethoscope, Check, X, Wand2, Plus, CheckCheck, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Row = {
  procedure_code: string;
  medical_specialty: string;
  status: "sugerido" | "aprovado" | "rejeitado";
  confidence_pct: number | null;
  sample_size: number | null;
  description: string | null;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
};

const STATUS_ORDER: Record<Row["status"], number> = { sugerido: 0, aprovado: 1, rejeitado: 2 };

const STATUS_BADGE: Record<Row["status"], string> = {
  sugerido: "bg-warning-soft text-warning-foreground border-warning/30",
  aprovado: "bg-success-soft text-success-foreground border-success/30",
  rejeitado: "bg-muted text-muted-foreground border-border",
};

export default function ProcedureSpecialtyMap() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState("");
  const [newSpec, setNewSpec] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("procedure_specialty_map" as any)
      .select("*")
      .order("status")
      .order("confidence_pct", { ascending: false });
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? rows.filter((r) =>
          r.procedure_code.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          r.medical_specialty.toLowerCase().includes(q))
      : rows;
    return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }, [rows, filter]);

  const counts = useMemo(() => ({
    sugerido: rows.filter((r) => r.status === "sugerido").length,
    aprovado: rows.filter((r) => r.status === "aprovado").length,
    rejeitado: rows.filter((r) => r.status === "rejeitado").length,
  }), [rows]);

  const update = async (code: string, patch: Partial<Row>) => {
    const userRes = await supabase.auth.getUser();
    const uid = userRes.data.user?.id ?? null;
    const payload: any = { ...patch };
    if (patch.status === "aprovado") {
      payload.approved_by = uid;
      payload.approved_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("procedure_specialty_map" as any)
      .update(payload)
      .eq("procedure_code", code);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  const generate = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-procedure-specialties", { body: {} });
      if (error) throw error;
      toast({ title: "Sugestões geradas", description: `${(data as any)?.suggested ?? 0} sugestões a partir de ${(data as any)?.codes_analyzed ?? 0} códigos.` });
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao gerar sugestões", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const addManual = async () => {
    const code = newCode.trim();
    const spec = newSpec.trim();
    if (!code || !spec) return;
    const userRes = await supabase.auth.getUser();
    const uid = userRes.data.user?.id ?? null;
    const { error } = await supabase
      .from("procedure_specialty_map" as any)
      .upsert({
        procedure_code: code,
        medical_specialty: spec,
        status: "aprovado",
        approved_by: uid,
        approved_at: new Date().toISOString(),
      }, { onConflict: "procedure_code" });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setNewCode(""); setNewSpec("");
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mapa Código → Especialidade Médica"
        description="O motor de regras usa este mapa para inferir a especialidade médica de cada item, independente do tipo de ato (Cirurgia/Anestesia/Visita) trazido na base."
        icon={Stethoscope}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={STATUS_BADGE.sugerido}>{counts.sugerido} sugeridas</Badge>
        <Badge variant="outline" className={STATUS_BADGE.aprovado}>{counts.aprovado} aprovadas</Badge>
        <Badge variant="outline" className={STATUS_BADGE.rejeitado}>{counts.rejeitado} rejeitadas</Badge>
        <div className="flex-1" />
        <Button variant="outline" onClick={generate} disabled={running}>
          <Wand2 className="h-4 w-4 mr-2" />
          {running ? "Gerando..." : "Gerar sugestões agora"}
        </Button>
      </div>

      <div className="flex gap-2 items-center border rounded-md p-3 bg-muted/30">
        <Plus className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Código TUSS" value={newCode} onChange={(e) => setNewCode(e.target.value)} className="max-w-[160px]" />
        <Input placeholder="Especialidade médica (ex.: Urologia)" value={newSpec} onChange={(e) => setNewSpec(e.target.value)} className="max-w-[280px]" />
        <Button onClick={addManual} disabled={!newCode.trim() || !newSpec.trim()}>Adicionar manual</Button>
      </div>

      <Input placeholder="Filtrar por código, especialidade ou descrição…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-3">Código</th>
              <th className="p-3">Descrição</th>
              <th className="p-3">Especialidade</th>
              <th className="p-3">Confiança</th>
              <th className="p-3">Amostra</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Carregando…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhum mapeamento ainda. Clique em "Gerar sugestões agora" para popular a partir do histórico.</td></tr>
            )}
            {filtered.map((r) => {
              const editVal = edits[r.procedure_code] ?? r.medical_specialty;
              const dirty = editVal !== r.medical_specialty;
              return (
                <tr key={r.procedure_code} className="border-t">
                  <td className="p-3 font-mono">{r.procedure_code}</td>
                  <td className="p-3 text-muted-foreground max-w-[320px] truncate" title={r.description ?? ""}>{r.description ?? "—"}</td>
                  <td className="p-3">
                    <Input
                      value={editVal}
                      onChange={(e) => setEdits((p) => ({ ...p, [r.procedure_code]: e.target.value }))}
                      className="h-8"
                    />
                  </td>
                  <td className="p-3">{r.confidence_pct != null ? `${r.confidence_pct}%` : "—"}</td>
                  <td className="p-3">{r.sample_size ?? "—"}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={STATUS_BADGE[r.status]}>{r.status}</Badge>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    {dirty && (
                      <Button size="sm" variant="outline" onClick={() => update(r.procedure_code, { medical_specialty: editVal, status: "aprovado" })}>
                        Salvar e aprovar
                      </Button>
                    )}
                    {!dirty && r.status !== "aprovado" && (
                      <Button size="sm" variant="default" onClick={() => update(r.procedure_code, { status: "aprovado" })}>
                        <Check className="h-3 w-3 mr-1" /> Aprovar
                      </Button>
                    )}
                    {r.status !== "rejeitado" && (
                      <Button size="sm" variant="ghost" onClick={() => update(r.procedure_code, { status: "rejeitado" })}>
                        <X className="h-3 w-3 mr-1" /> Rejeitar
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
  );
}
