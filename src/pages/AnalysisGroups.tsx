// Cadastro de "Grupos de análise" — agrupamento livre de especialidades,
// médicos e PJs por hospital, usado depois nos relatórios de pagamento.
//
// Fonte de verdade de especialidade: cadastro (specialties + doctors.specialties).
// O texto livre de payment_items.specialty NÃO é usado aqui.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { useRequireHospital } from "@/hooks/useRequireHospital";
import { useSpecialties } from "@/hooks/useSpecialties";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { formatCNPJ } from "@/lib/cnpj";
import { PageHeader } from "@/components/PageHeader";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Layers, Plus, Pencil, Search, Users, Building2, Stethoscope, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

type MemberType = "specialty" | "doctor" | "company";

export interface AnalysisGroup {
  id: string;
  hospital_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

export interface AnalysisGroupMember {
  id: string;
  group_id: string;
  member_type: MemberType;
  specialty_code: string | null;
  doctor_id: string | null;
  company_id: string | null;
}

interface DoctorOption {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
  specialties: string[] | null;
  active: boolean;
}

interface CompanyOption {
  id: string;
  name: string;
  document: string | null;
  active: boolean;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const MEMBER_LABEL: Record<MemberType, string> = {
  specialty: "Especialidade",
  doctor: "Médico",
  company: "PJ / Empresa",
};

export default function AnalysisGroups({ embedded = false }: { embedded?: boolean } = {}) {
  const { hospital, loading: hospitalLoading } = useHospital();
  const { hospitalId, ensure } = useRequireHospital();
  const { rows: specialtyRows, loading: specialtiesLoading } = useSpecialties();

  const [groups, setGroups] = useState<AnalysisGroup[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // Dialog de criação/edição de grupo
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnalysisGroup | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Dialog de membros
  const [membersGroup, setMembersGroup] = useState<AnalysisGroup | null>(null);

  // Confirmação de exclusão (ação destrutiva sempre confirmada)
  const [deleteTarget, setDeleteTarget] = useState<AnalysisGroup | null>(null);

  const loadGroups = useCallback(async () => {
    if (!hospitalId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from("analysis_groups")
        .select("id,hospital_id,name,description,active,created_at")
        .eq("hospital_id", hospitalId)
        .order("name", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as AnalysisGroup[];
      setGroups(rows);

      if (rows.length > 0) {
        const { data: members, error: mErr } = await supabase
          .from("analysis_group_members")
          .select("group_id")
          .in("group_id", rows.map((g) => g.id));
        if (mErr) throw mErr;
        const counts: Record<string, number> = {};
        (members ?? []).forEach((m: { group_id: string }) => {
          counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;
        });
        setMemberCounts(counts);
      } else {
        setMemberCounts({});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao carregar grupos de análise";
      setLoadError(msg);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    if (hospitalLoading) return;
    void loadGroups();
  }, [hospitalLoading, loadGroups]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return groups.filter((g) => {
      if (!showInactive && !g.active) return false;
      if (!q) return true;
      return norm(g.name).includes(q) || norm(g.description ?? "").includes(q);
    });
  }, [groups, search, showInactive]);

  const openCreate = () => {
    if (!ensure("criar um grupo de análise")) return;
    setEditing(null);
    setDraftName("");
    setDraftDescription("");
    setFormOpen(true);
  };

  const openEdit = (g: AnalysisGroup) => {
    setEditing(g);
    setDraftName(g.name);
    setDraftDescription(g.description ?? "");
    setFormOpen(true);
  };

  const nameError = useMemo(() => {
    const v = draftName.trim();
    if (!v) return "Informe o nome do grupo";
    if (v.length < 2) return "Mínimo 2 caracteres";
    if (v.length > 80) return "Máximo 80 caracteres";
    const dup = groups.some(
      (g) => norm(g.name) === norm(v) && g.id !== editing?.id,
    );
    if (dup) return "Já existe um grupo com esse nome nesta unidade";
    return null;
  }, [draftName, groups, editing]);

  const saveGroup = async () => {
    if (!ensure("salvar o grupo de análise")) return;
    if (nameError) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("analysis_groups")
          .update({ name: draftName.trim(), description: draftDescription.trim() || null })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Grupo atualizado");
      } else {
        const { data: userRes } = await supabase.auth.getUser();
        const { error } = await supabase.from("analysis_groups").insert({
          hospital_id: hospitalId as string,
          name: draftName.trim(),
          description: draftDescription.trim() || null,
          created_by: userRes?.user?.id ?? null,
        });
        if (error) throw error;
        toast.success("Grupo criado");
      }
      setFormOpen(false);
      await loadGroups();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar grupo");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (g: AnalysisGroup) => {
    if (!ensure("alterar a situação do grupo")) return;
    const { error } = await supabase
      .from("analysis_groups")
      .update({ active: !g.active })
      .eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(g.active ? "Grupo desativado" : "Grupo reativado");
    await loadGroups();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("analysis_groups").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Grupo excluído");
    await loadGroups();
  };

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar grupo por nome ou descrição"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Mostrar inativos
        </label>
        <Button type="button" onClick={openCreate} disabled={!hospitalId}>
          <Plus className="h-4 w-4 mr-2" />
          Novo grupo
        </Button>
      </div>

      {hospital && (
        <p className="text-xs text-muted-foreground">
          Grupos exclusivos da unidade <strong>{hospital.name}</strong>. A mesma PJ ou médico pode
          ter grupos diferentes em outras unidades.
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
          <p className="font-medium text-destructive">Não foi possível carregar os grupos</p>
          <p className="text-muted-foreground mt-1">{loadError}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadGroups()}>
            Tentar novamente
          </Button>
        </div>
      ) : !hospitalId ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Selecione uma unidade hospitalar no topo para ver os grupos de análise.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Layers className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">Nenhum grupo de análise</p>
          <p className="text-sm text-muted-foreground mt-1">
            Crie grupos para reunir especialidades, médicos e PJs na análise de pagamentos.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-28 text-right">Membros</TableHead>
                <TableHead className="w-28">Situação</TableHead>
                <TableHead className="w-64 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {g.description || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{memberCounts[g.id] ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={g.active ? "default" : "secondary"}>
                      {g.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    <Button type="button" variant="outline" size="sm" onClick={() => setMembersGroup(g)}>
                      <Users className="h-3.5 w-3.5 mr-1.5" />
                      Membros
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(g)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void toggleActive(g)}>
                      {g.active ? "Desativar" : "Reativar"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(g)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        maxWidth="lg"
        title={editing ? "Editar grupo de análise" : "Novo grupo de análise"}
        description="O grupo pertence apenas à unidade hospitalar ativa."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void saveGroup()} disabled={saving || !!nameError}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ag-name">Nome</Label>
            <Input
              id="ag-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Ex.: Grupo Cirúrgico Noturno"
            />
            {nameError && draftName.length > 0 && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ag-desc">Descrição (opcional)</Label>
            <Textarea
              id="ag-desc"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={3}
              placeholder="Para que serve este agrupamento"
            />
          </div>
        </div>
      </FormDialog>

      {membersGroup && (
        <GroupMembersDialog
          group={membersGroup}
          open={!!membersGroup}
          onOpenChange={(o) => {
            if (!o) {
              setMembersGroup(null);
              void loadGroups();
            }
          }}
          specialtyRows={specialtyRows}
          specialtiesLoading={specialtiesLoading}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir grupo de análise?</AlertDialogTitle>
            <AlertDialogDescription>
              O grupo "{deleteTarget?.name}" e todos os seus membros serão removidos. Esta ação não
              pode ser desfeita — se preferir manter o histórico, use "Desativar".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (embedded) return body;

  return (
    <div>
      <PageHeader
        title="Grupos de análise"
        description="Agrupe especialidades, médicos e PJs da unidade para analisar pagamentos em conjunto."
        icon={Layers}
      />
      <div className="p-4 md:p-6">{body}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Membros do grupo                                                            */
/* -------------------------------------------------------------------------- */

function GroupMembersDialog({
  group,
  open,
  onOpenChange,
  specialtyRows,
  specialtiesLoading,
}: {
  group: AnalysisGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specialtyRows: { id: string; code: string; name: string; active: boolean }[];
  specialtiesLoading: boolean;
}) {
  const [members, setMembers] = useState<AnalysisGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [registriesLoading, setRegistriesLoading] = useState(true);

  const [tab, setTab] = useState<MemberType>("specialty");
  const [query, setQuery] = useState("");

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("analysis_group_members")
        .select("id,group_id,member_type,specialty_code,doctor_id,company_id")
        .eq("group_id", group.id);
      if (err) throw err;
      setMembers((data ?? []) as AnalysisGroupMember[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao carregar membros");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setRegistriesLoading(true);
      try {
        const [docs, comps] = await Promise.all([
          fetchAllPaginated<DoctorOption>((from, to) =>
            supabase
              .from("doctors")
              .select("id,full_name,crm,crm_uf,specialties,active")
              .order("full_name")
              .range(from, to),
          ),
          fetchAllPaginated<CompanyOption>((from, to) =>
            supabase
              .from("companies")
              .select("id,name,document,active")
              .order("name")
              .range(from, to),
          ),
        ]);
        if (cancel) return;
        setDoctors(docs);
        setCompanies(comps);
      } catch (e: unknown) {
        if (!cancel) toast.error(e instanceof Error ? e.message : "Falha ao carregar cadastros");
      } finally {
        if (!cancel) setRegistriesLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const specialtyByCode = useMemo(() => {
    const m = new Map<string, string>();
    specialtyRows.forEach((s) => m.set(s.code, s.name));
    return m;
  }, [specialtyRows]);
  const doctorById = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const selectedSpecialties = useMemo(
    () => new Set(members.filter((m) => m.specialty_code).map((m) => m.specialty_code as string)),
    [members],
  );
  const selectedDoctors = useMemo(
    () => new Set(members.filter((m) => m.doctor_id).map((m) => m.doctor_id as string)),
    [members],
  );
  const selectedCompanies = useMemo(
    () => new Set(members.filter((m) => m.company_id).map((m) => m.company_id as string)),
    [members],
  );

  const addMember = async (payload: Partial<AnalysisGroupMember> & { member_type: MemberType }, key: string) => {
    setBusyKey(key);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("analysis_group_members").insert({
        group_id: group.id,
        hospital_id: group.hospital_id, // trigger no banco reescreve a partir do grupo
        member_type: payload.member_type,
        specialty_code: payload.specialty_code ?? null,
        doctor_id: payload.doctor_id ?? null,
        company_id: payload.company_id ?? null,
        created_by: userRes?.user?.id ?? null,
      });
      if (err) throw err;
      await loadMembers();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao adicionar membro");
    } finally {
      setBusyKey(null);
    }
  };

  const removeMember = async (id: string) => {
    setBusyKey(id);
    try {
      const { error: err } = await supabase.from("analysis_group_members").delete().eq("id", id);
      if (err) throw err;
      await loadMembers();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover membro");
    } finally {
      setBusyKey(null);
    }
  };

  const q = norm(query);

  const specialtyResults = useMemo(
    () => specialtyRows.filter((s) => !q || norm(s.name).includes(q)).slice(0, 60),
    [specialtyRows, q],
  );

  const doctorResults = useMemo(
    () =>
      doctors
        .filter((d) => d.active)
        .filter(
          (d) =>
            !q ||
            norm(d.full_name).includes(q) ||
            norm(`${d.crm ?? ""}${d.crm_uf ?? ""}`).includes(q.replace(/[^a-z0-9]/g, "")),
        )
        .slice(0, 60),
    [doctors, q],
  );

  const companyResults = useMemo(
    () =>
      companies
        .filter((c) => c.active)
        .filter(
          (c) =>
            !q ||
            norm(c.name).includes(q) ||
            (c.document ?? "").replace(/\D/g, "").includes(query.replace(/\D/g, "")),
        )
        .slice(0, 60),
    [companies, q, query],
  );

  const memberLabel = (m: AnalysisGroupMember): string => {
    if (m.member_type === "specialty") {
      return specialtyByCode.get(m.specialty_code ?? "") ?? m.specialty_code ?? "—";
    }
    if (m.member_type === "doctor") {
      const d = doctorById.get(m.doctor_id ?? "");
      return d ? `${d.full_name}${d.crm ? ` — CRM ${d.crm}/${d.crm_uf ?? ""}` : ""}` : "Médico";
    }
    const c = companyById.get(m.company_id ?? "");
    return c ? `${c.name}${c.document ? ` — ${formatCNPJ(c.document)}` : ""}` : "PJ";
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="3xl"
      title={`Membros — ${group.name}`}
      description="Um grupo pode misturar especialidades, médicos e PJs."
      footer={
        <Button type="button" onClick={() => onOpenChange(false)}>
          Concluir
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">
            Membros do grupo {loading ? "" : `(${members.length})`}
          </p>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="text-destructive">{error}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void loadMembers()}>
                Tentar novamente
              </Button>
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
              Nenhum membro ainda. Use a busca abaixo para adicionar.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <Badge key={m.id} variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {MEMBER_LABEL[m.member_type]}
                  </span>
                  <span>{memberLabel(m)}</span>
                  <button
                    type="button"
                    aria-label="Remover membro"
                    className="rounded p-0.5 hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
                    disabled={busyKey === m.id}
                    onClick={() => void removeMember(m.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as MemberType); setQuery(""); }}>
          <TabsList>
            <TabsTrigger value="specialty">
              <Stethoscope className="h-3.5 w-3.5 mr-1.5" />
              Especialidades
            </TabsTrigger>
            <TabsTrigger value="doctor">
              <Users className="h-3.5 w-3.5 mr-1.5" />
              Médicos
            </TabsTrigger>
            <TabsTrigger value="company">
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              PJs
            </TabsTrigger>
          </TabsList>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              placeholder={
                tab === "specialty"
                  ? "Buscar especialidade pelo nome"
                  : tab === "doctor"
                    ? "Buscar médico por nome ou CRM"
                    : "Buscar PJ por nome ou CNPJ"
              }
            />
          </div>

          <TabsContent value="specialty" className="mt-3">
            <ResultList
              loading={specialtiesLoading}
              empty="Nenhuma especialidade encontrada"
              items={specialtyResults.map((s) => ({
                key: s.code,
                primary: s.name,
                secondary: s.code,
                selected: selectedSpecialties.has(s.code),
                onAdd: () => addMember({ member_type: "specialty", specialty_code: s.code }, s.code),
              }))}
              busyKey={busyKey}
            />
          </TabsContent>

          <TabsContent value="doctor" className="mt-3">
            <ResultList
              loading={registriesLoading}
              empty="Nenhum médico encontrado"
              items={doctorResults.map((d) => ({
                key: d.id,
                primary: d.full_name,
                // Especialidade sempre do cadastro do médico (doctors.specialties)
                secondary: [
                  d.crm ? `CRM ${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : null,
                  (d.specialties ?? []).join(", ") || null,
                ]
                  .filter(Boolean)
                  .join(" • "),
                selected: selectedDoctors.has(d.id),
                onAdd: () => addMember({ member_type: "doctor", doctor_id: d.id }, d.id),
              }))}
              busyKey={busyKey}
            />
          </TabsContent>

          <TabsContent value="company" className="mt-3">
            <ResultList
              loading={registriesLoading}
              empty="Nenhuma PJ encontrada"
              items={companyResults.map((c) => ({
                key: c.id,
                primary: c.name,
                secondary: c.document ? formatCNPJ(c.document) : "",
                selected: selectedCompanies.has(c.id),
                onAdd: () => addMember({ member_type: "company", company_id: c.id }, c.id),
              }))}
              busyKey={busyKey}
            />
          </TabsContent>
        </Tabs>
      </div>
    </FormDialog>
  );
}

function ResultList({
  loading,
  empty,
  items,
  busyKey,
}: {
  loading: boolean;
  empty: string;
  items: {
    key: string;
    primary: string;
    secondary: string;
    selected: boolean;
    onAdd: () => void;
  }[];
  busyKey: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center">
        {empty}
      </p>
    );
  }
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y">
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{it.primary}</p>
            {it.secondary && (
              <p className="text-xs text-muted-foreground truncate">{it.secondary}</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant={it.selected ? "ghost" : "outline"}
            disabled={it.selected || busyKey === it.key}
            onClick={it.onAdd}
          >
            {it.selected ? "Adicionado" : "Adicionar"}
          </Button>
        </div>
      ))}
    </div>
  );
}
