import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { Sparkles, Loader2 } from "lucide-react";

interface MarkRow {
  id: string;
  attendance_number: string;
  item_id: string | null;
  special_case_type_code: string;
  status: string;
  origin: string;
  payment_id: string | null;
  doctor_id: string | null;
  marked_at: string;
  approved_at: string | null;
  rejected_at: string | null;
}

interface TypeRow { code: string; label: string }
interface DoctorRow { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  revoked: "Revogado",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  revoked: "outline",
};

const ORIGIN_LABEL: Record<string, string> = {
  medico_portal: "Médico (portal)",
  analista: "Analista",
  gestao_medica: "Gestão médica",
};

export default function SpecialCasesReport() {
  const activeHospitalId = useActiveHospitalId();
  const [loading, setLoading] = useState(false);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!activeHospitalId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const [marksRes, typesRes, doctorsRes] = await Promise.all([
        supabase
          .from("special_case_marks")
          .select("id, attendance_number, item_id, special_case_type_code, status, origin, payment_id, doctor_id, marked_at, approved_at, rejected_at")
          .eq("hospital_id", activeHospitalId)
          .order("marked_at", { ascending: false })
          .limit(2000),
        supabase
          .from("special_case_types")
          .select("code, label")
          .or(`hospital_id.eq.${activeHospitalId},hospital_id.is.null`),
        supabase.from("doctors").select("id, full_name").eq("active", true).limit(5000),
      ]);
      if (!alive) return;
      setMarks((marksRes.data as MarkRow[]) ?? []);
      setTypes((typesRes.data as TypeRow[]) ?? []);
      const docs = ((doctorsRes.data as Array<{ id: string; full_name: string }> | null) ?? [])
        .map((d) => ({ id: d.id, name: d.full_name }));
      setDoctors(docs);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [activeHospitalId]);

  const typeMap = useMemo(() => new Map(types.map((t) => [t.code, t.label])), [types]);
  const doctorMap = useMemo(() => new Map(doctors.map((d) => [d.id, d.name])), [doctors]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return marks.filter((m) => {
      if (filterType !== "all" && m.special_case_type_code !== filterType) return false;
      if (filterStatus !== "all" && m.status !== filterStatus) return false;
      if (!s) return true;
      const doctor = (m.doctor_id ? doctorMap.get(m.doctor_id) : "") ?? "";
      return (
        m.attendance_number.toLowerCase().includes(s) ||
        doctor.toLowerCase().includes(s)
      );
    });
  }, [marks, filterType, filterStatus, search, doctorMap]);

  const kpis = useMemo(() => {
    const byStatus: Record<string, number> = { pending: 0, approved: 0, rejected: 0, revoked: 0 };
    const byType: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    for (const m of marks) {
      byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
      byType[m.special_case_type_code] = (byType[m.special_case_type_code] ?? 0) + 1;
      byOrigin[m.origin] = (byOrigin[m.origin] ?? 0) + 1;
    }
    return { byStatus, byType, byOrigin, total: marks.length };
  }, [marks]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Casos especiais — relatório"
        description="Marcações de oncológico, pediátrico e outras patologias com tratamento diferenciado"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{kpis.total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Aprovados</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold text-emerald-600">{kpis.byStatus.approved}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pendentes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold text-amber-600">{kpis.byStatus.pending}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Rejeitados / revogados</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold text-muted-foreground">{kpis.byStatus.rejected + kpis.byStatus.revoked}</div></CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Por tipo</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.entries(kpis.byType).length === 0 && <div className="text-muted-foreground">Sem marcações.</div>}
            {Object.entries(kpis.byType).map(([code, count]) => (
              <div key={code} className="flex items-center justify-between">
                <span className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-primary" />{typeMap.get(code) ?? code}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Por origem</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.entries(kpis.byOrigin).map(([o, count]) => (
              <div key={o} className="flex items-center justify-between">
                <span>{ORIGIN_LABEL[o] ?? o}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marcações</CardTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Input
              placeholder="Buscar atendimento ou médico…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {types.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="approved">Aprovados</SelectItem>
                <SelectItem value="rejected">Rejeitados</SelectItem>
                <SelectItem value="revoked">Revogados</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-sm">Nenhuma marcação encontrada.</div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Atendimento</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Médico</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Marcado em</TableHead>
                    <TableHead>Pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 500).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono">{m.attendance_number}</TableCell>
                      <TableCell>{typeMap.get(m.special_case_type_code) ?? m.special_case_type_code}</TableCell>
                      <TableCell>{m.doctor_id ? doctorMap.get(m.doctor_id) ?? "—" : "—"}</TableCell>
                      <TableCell>{ORIGIN_LABEL[m.origin] ?? m.origin}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[m.status] ?? "secondary"}>{STATUS_LABEL[m.status] ?? m.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.marked_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        {m.payment_id ? (
                          <Link to={`/pagamentos/${m.payment_id}`} className="text-primary hover:underline text-xs">
                            Abrir
                          </Link>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 500 && (
                <div className="text-xs text-muted-foreground mt-2">
                  Exibindo 500 de {filtered.length} marcações. Refine os filtros para ver mais.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
