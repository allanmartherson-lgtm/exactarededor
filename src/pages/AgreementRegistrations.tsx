// Cadastro de Acordos — listagem dos registros de agreement_registrations
// e ponto de entrada do wizard de 6 etapas (menu Relacionamento).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { useRequireHospital } from "@/hooks/useRequireHospital";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardList, Plus, Search, Pencil, Eye } from "lucide-react";
import { toast } from "sonner";
import { AgreementWizardDialog } from "@/components/relacionamento/AgreementWizardDialog";
import {
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_STATUS_VARIANT,
  PAYMENT_TABLE_BASE_LABEL,
  parseExtraItems,
  type AgreementRegistration,
  type AgreementStatus,
} from "@/lib/agreementRegistrations";

interface CompanyLite {
  id: string;
  name: string;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const fmtDate = (v: string | null) =>
  v ? new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR") : "—";

export default function AgreementRegistrations() {
  const { hospital, loading: hospitalLoading } = useHospital();
  const { hospitalId, ensure } = useRequireHospital();

  const [rows, setRows] = useState<AgreementRegistration[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<AgreementStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [codeFilter, setCodeFilter] = useState("");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AgreementRegistration | null>(null);
  const [tab, setTab] = useState<"todos" | "supervisor" | "diretor" | "analista">("todos");
  const [detail, setDetail] = useState<AgreementRegistration | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);


  const load = useCallback(async () => {
    if (!hospitalId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // Acordos da unidade + acordos replicados para ela (podem ter sido
      // criados em outro hospital da regional).
      const { data: links, error: linkErr } = await supabase
        .from("agreement_registration_hospitals")
        .select("agreement_id")
        .eq("hospital_id", hospitalId);
      if (linkErr) throw linkErr;
      const linkedIds = Array.from(
        new Set((links ?? []).map((l) => (l as { agreement_id: string }).agreement_id)),
      );

      const [{ data, error }, replicated, comps] = await Promise.all([
        supabase
          .from("agreement_registrations")
          .select("*")
          .eq("hospital_id", hospitalId)
          .order("created_at", { ascending: false }),
        linkedIds.length
          ? supabase.from("agreement_registrations").select("*").in("id", linkedIds)
          : Promise.resolve({ data: [], error: null }),
        fetchAllPaginated<CompanyLite>((from, to) =>
          supabase.from("companies").select("id,name").order("name").range(from, to),
        ),
      ]);
      if (error) throw error;
      const byId = new Map<string, AgreementRegistration>();
      [...(data ?? []), ...((replicated.data ?? []) as unknown[])].forEach((r) => {
        const row = {
          ...(r as unknown as AgreementRegistration),
          extra_items: parseExtraItems((r as { extra_items: unknown }).extra_items),
        };
        byId.set(row.id, row);
      });
      setRows(
        Array.from(byId.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      );
      const map: Record<string, string> = {};
      comps.forEach((c) => (map[c.id] = c.name));
      setCompanies(map);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Falha ao carregar cadastros de acordo");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    if (hospitalLoading) return;
    void load();
  }, [hospitalLoading, load]);


  // Cada aba é uma fila do fluxo; "todos" mantém a listagem geral.
  const TAB_STATUS: Record<string, AgreementStatus[] | null> = {
    todos: null,
    supervisor: ["aguardando_supervisor"],
    diretor: ["aguardando_diretor"],
    analista: ["aprovado"],
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: rows.length };
    Object.entries(TAB_STATUS).forEach(([k, sts]) => {
      if (!sts) return;
      c[k] = rows.filter((r) => sts.includes(r.status)).length;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = useMemo(() => {
    const q = norm(search);
    const qc = norm(codeFilter);
    const tabStatuses = TAB_STATUS[tab] ?? null;
    return rows.filter((r) => {
      if (tabStatuses && !tabStatuses.includes(r.status)) return false;
      if (tab === "todos" && statusFilter !== "todos" && r.status !== statusFilter) return false;
      if (qc && !norm(r.code).includes(qc)) return false;
      if (q) {
        const companyName = r.company_id ? companies[r.company_id] ?? "" : "";
        if (!norm(companyName).includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, statusFilter, search, codeFilter, companies, tab]);

  const openNew = () => {
    if (!ensure("criar um cadastro de acordo")) return;
    setEditing(null);
    setWizardOpen(true);
  };

  // Rascunho volta para o wizard; qualquer outro status abre a visão de
  // detalhe read-only com as ações do fluxo.
  const openRecord = (r: AgreementRegistration) => {
    if (r.status === "rascunho") {
      setEditing(r);
      setWizardOpen(true);
      return;
    }
    setDetail(r);
    setDetailOpen(true);
  };


  return (
    <div>
      <PageHeader
        title="Cadastro de Acordos"
        description="Registro estruturado dos acordos comerciais das clínicas, com fluxo de validação até virar regra"
        icon={ClipboardList}
      />
      <div className="p-4 md:p-6 space-y-4">
        {/* Filtros: busca larga; status e código compactos */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por clínica"
              className="pl-9"
            />
          </div>
          <Input
            value={codeFilter}
            onChange={(e) => setCodeFilter(e.target.value)}
            placeholder="ACD-00001"
            className="w-36"
            aria-label="Filtrar por código"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as AgreementStatus | "todos")}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {(Object.keys(AGREEMENT_STATUS_LABEL) as AgreementStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {AGREEMENT_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={openNew} disabled={!hospitalId}>
            <Plus className="h-4 w-4 mr-2" />
            Novo acordo
          </Button>
        </div>

        {hospital && (
          <p className="text-xs text-muted-foreground">
            Acordos da unidade <strong>{hospital.name}</strong>. Rascunhos podem ser retomados a
            qualquer momento.
          </p>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Não foi possível carregar os acordos</p>
            <p className="text-muted-foreground mt-1">{loadError}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              Tentar novamente
            </Button>
          </div>
        ) : !hospitalId ? (
          <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
            Selecione uma unidade hospitalar no topo para ver os acordos.
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Nenhum acordo encontrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Use "Novo acordo" para iniciar o preenchimento em 6 etapas.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Código</TableHead>
                  <TableHead>Clínica</TableHead>
                  <TableHead className="w-44">Vigência</TableHead>
                  <TableHead className="w-44">Tabela base</TableHead>
                  <TableHead className="w-24 text-right">%</TableHead>
                  <TableHead className="w-48">Status</TableHead>
                  <TableHead className="w-28 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isDraft = r.status === "rascunho";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">
                        {r.company_id ? companies[r.company_id] ?? "—" : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDate(r.effective_from)} — {fmtDate(r.effective_to)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.payment_table_base
                          ? PAYMENT_TABLE_BASE_LABEL[r.payment_table_base] ?? r.payment_table_base
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.payment_percentage != null ? `${r.payment_percentage}%` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={AGREEMENT_STATUS_VARIANT[r.status] ?? "secondary"}>
                          {AGREEMENT_STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => openRecord(r)}>
                          {isDraft ? (
                            <>
                              <Pencil className="h-3.5 w-3.5 mr-1.5" />
                              Continuar
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5 mr-1.5" />
                              Abrir
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AgreementWizardDialog
        open={wizardOpen}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) setEditing(null);
        }}
        record={editing}
        onSaved={() => {
          void load();
        }}
      />
    </div>
  );
}
