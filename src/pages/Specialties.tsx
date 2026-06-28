import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Search, Stethoscope, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, X, History, Clock, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useSpecialties, invalidateSpecialtiesCache, type SpecialtyRow } from "@/hooks/useSpecialties";

type SortKey = "name" | "code" | "count" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "inactive";
type UsageFilter = "all" | "in_use" | "unused";

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const nameSchema = z
  .string()
  .trim()
  .min(2, "Mínimo 2 caracteres")
  .max(80, "Máximo 80 caracteres");

interface Props {
  embedded?: boolean;
}

interface DoctorUsage {
  [name: string]: number; // lowercase name → count
}

function SortButton({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className={`inline-flex items-center gap-1 text-xs font-medium hover:text-foreground transition-colors ${
        active ? "text-foreground" : "text-muted-foreground"
      } ${align === "right" ? "ml-auto" : ""}`}
    >
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}

interface AuditEntry {
  id: string;
  specialty_id: string;
  specialty_code: string;
  action: "created" | "renamed" | "activated" | "inactivated";
  old_name: string | null;
  new_name: string | null;
  old_active: boolean | null;
  new_active: boolean | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
}

const ACTION_LABEL: Record<AuditEntry["action"], string> = {
  created: "Criada",
  renamed: "Renomeada",
  activated: "Reativada",
  inactivated: "Inativada",
};

const ACTION_VARIANT: Record<AuditEntry["action"], "default" | "secondary" | "outline"> = {
  created: "default",
  renamed: "outline",
  activated: "outline",
  inactivated: "secondary",
};

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}



export default function Specialties({ embedded = false }: Props) {
  const { allRows, loading, refetch } = useSpecialties({ includeInactive: true });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [usage, setUsage] = useState<DoctorUsage>({});
  const [editing, setEditing] = useState<SpecialtyRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "count" ? "desc" : "asc");
    }
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("active");
    setUsageFilter("all");
    setSortKey("name");
    setSortDir("asc");
  };

  // Conta uso por médicos (best-effort — limita a 5000 médicos).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("specialties")
        .not("specialties", "is", null)
        .limit(5000);
      if (cancel || error) return;
      const map: DoctorUsage = {};
      (data ?? []).forEach((row: { specialties: string[] | null }) => {
        (row.specialties ?? []).forEach((s) => {
          const k = s.trim().toLowerCase();
          map[k] = (map[k] ?? 0) + 1;
        });
      });
      if (!cancel) setUsage(map);
    })();
    return () => {
      cancel = true;
    };
  }, [allRows.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const filteredRows = allRows
      .filter((r) => {
        if (statusFilter === "active") return r.active;
        if (statusFilter === "inactive") return !r.active;
        return true;
      })
      .filter((r) => {
        if (usageFilter === "all") return true;
        const count = usage[r.name.toLowerCase()] ?? 0;
        return usageFilter === "in_use" ? count > 0 : count === 0;
      })
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q),
      );

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      if (sortKey === "name") return collator.compare(a.name, b.name) * dir;
      if (sortKey === "code") return collator.compare(a.code, b.code) * dir;
      if (sortKey === "count") {
        const ca = usage[a.name.toLowerCase()] ?? 0;
        const cb = usage[b.name.toLowerCase()] ?? 0;
        if (ca !== cb) return (ca - cb) * dir;
        return collator.compare(a.name, b.name);
      }
      // status
      if (a.active !== b.active) return (a.active ? -1 : 1) * dir;
      return collator.compare(a.name, b.name);
    });
  }, [allRows, search, statusFilter, usageFilter, usage, sortKey, sortDir]);

  const totals = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let inUse = 0;
    allRows.forEach((r) => {
      if (r.active) active++;
      else inactive++;
      if ((usage[r.name.toLowerCase()] ?? 0) > 0) inUse++;
    });
    return { total: allRows.length, active, inactive, inUse, unused: allRows.length - inUse };
  }, [allRows, usage]);

  const filtersDirty =
    !!search.trim() ||
    statusFilter !== "active" ||
    usageFilter !== "all" ||
    sortKey !== "name" ||
    sortDir !== "asc";

  const openCreate = () => {
    setEditing(null);
    setDraftName("");
    setCreating(true);
  };

  const openEdit = (row: SpecialtyRow) => {
    setEditing(row);
    setDraftName(row.name);
    setCreating(true);
  };

  const handleSave = async () => {
    const parsed = nameSchema.safeParse(draftName);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Nome inválido");
      return;
    }
    const name = parsed.data;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("specialties")
          .update({ name })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Especialidade atualizada");
      } else {
        const dup = allRows.find(
          (r) => r.name.toLowerCase() === name.toLowerCase(),
        );
        if (dup) {
          toast.error("Já existe uma especialidade com esse nome");
          setSaving(false);
          return;
        }
        const code = slugify(name);
        if (!code) {
          toast.error("Nome inválido para gerar código");
          setSaving(false);
          return;
        }
        const codeDup = allRows.find((r) => r.code === code);
        if (codeDup) {
          toast.error(`Código "${code}" já existe (especialidade "${codeDup.name}")`);
          setSaving(false);
          return;
        }
        const { error } = await supabase.from("specialties").insert({ code, name });
        if (error) throw error;
        toast.success("Especialidade criada");
      }
      invalidateSpecialtiesCache();
      await refetch();
      setCreating(false);
      setEditing(null);
      setDraftName("");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: SpecialtyRow) => {
    const next = !row.active;
    if (!next) {
      const count = usage[row.name.toLowerCase()] ?? 0;
      if (count > 0) {
        const ok = window.confirm(
          `"${row.name}" está sendo usada por ${count} médico(s). Inativar mesmo assim?\n\n` +
            `Os médicos atuais não perdem a especialidade, mas ela deixa de aparecer nos selects.`,
        );
        if (!ok) return;
      }
    }
    const { error } = await supabase
      .from("specialties")
      .update({ active: next })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(next ? "Reativada" : "Inativada");
    invalidateSpecialtiesCache();
    await refetch();
  };

  const body = (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Ativas ({totals.active})</SelectItem>
            <SelectItem value="inactive">Inativas ({totals.inactive})</SelectItem>
            <SelectItem value="all">Todas ({totals.total})</SelectItem>
          </SelectContent>
        </Select>
        <Select value={usageFilter} onValueChange={(v) => setUsageFilter(v as UsageFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Uso" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Qualquer uso</SelectItem>
            <SelectItem value="in_use">Em uso ({totals.inUse})</SelectItem>
            <SelectItem value="unused">Sem médicos ({totals.unused})</SelectItem>
          </SelectContent>
        </Select>
        {filtersDirty && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5 mr-1" /> Limpar
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} de {totals.total}
          </span>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Nova especialidade
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" />
        Especialidades não podem ser excluídas — apenas inativadas. O código é
        gerado a partir do nome e é imutável depois da criação.
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortButton label="Nome" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <SortButton label="Código" k="code" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="text-right">
                <SortButton label="Médicos" k="count" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </TableHead>
              <TableHead className="text-right">
                <SortButton label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                  Nenhuma especialidade encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const count = usage[row.name.toLowerCase()] ?? 0;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <code className="text-xs text-muted-foreground">{row.code}</code>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count > 0 ? count : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.active ? (
                        <Badge variant="outline" className="text-success">Ativa</Badge>
                      ) : (
                        <Badge variant="secondary">Inativa</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant={row.active ? "outline" : "secondary"}
                          onClick={() => toggleActive(row)}
                        >
                          {row.active ? "Inativar" : "Reativar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar especialidade" : "Nova especialidade"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Você pode renomear, mas o código permanece o mesmo."
                : "O código é gerado automaticamente a partir do nome e fica imutável."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="esp-name">Nome</Label>
              <Input
                id="esp-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Ex.: Fisioterapia"
                maxLength={80}
                autoFocus
              />
            </div>
            {editing ? (
              <div>
                <Label className="text-xs text-muted-foreground">Código (imutável)</Label>
                <code className="block text-sm mt-1">{editing.code}</code>
              </div>
            ) : draftName.trim() ? (
              <div>
                <Label className="text-xs text-muted-foreground">Pré-visualização do código</Label>
                <code className="block text-sm mt-1">{slugify(draftName) || "—"}</code>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) return body;

  return (
    <div>
      <PageHeader
        title="Especialidades"
        description="Catálogo de especialidades médicas usadas em regras, lotes manuais e cadastro de médicos."
        icon={Stethoscope}
      />
      {body}
    </div>
  );
}
