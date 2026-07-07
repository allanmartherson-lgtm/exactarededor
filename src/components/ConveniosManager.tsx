import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, Plus, Pencil, X, Upload, Download, Building2, Globe2 } from "lucide-react";


type Convenio = {
  slug: string;
  code?: string | null;
  name: string;
  aliases: string[];
  active: boolean;
  sort_order: number;
  operator_code: string | null;
  notes: string | null;
  hospital_id: string | null;
};

const empty: Convenio = {
  slug: "",
  code: null,
  name: "",
  aliases: [],
  active: true,
  sort_order: 50,
  operator_code: "",
  notes: "",
  hospital_id: null,
};

function buildSlug(input: string) {
  return input.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Sufixo curto/estável do hospital para desambiguar slugs quando um convênio
// homônimo existe em hospitais diferentes (ex.: unimed_hsl / unimed_hh).
function hospitalSlugSuffix(hospitalName: string) {
  const norm = hospitalName.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "");
  const initials = norm.split(/\s+/).filter(Boolean).map(w => w[0]).join("");
  return initials.slice(0, 4) || norm.slice(0, 4);
}

type Props = { canManage?: boolean };

type ScopeFilter = "all" | "current" | "global";

export default function ConveniosManager({ canManage = true }: Props) {
  const { hospital, availableHospitals } = useHospital() as {
    hospital: { id: string; name: string } | null;
    availableHospitals: { id: string; name: string }[];
  };
  const [list, setList] = useState<Convenio[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Convenio | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const hospitalName = (id: string | null) =>
    id ? (availableHospitals.find(h => h.id === id)?.name ?? "Outro hospital") : "Global";

  const downloadTemplate = () => {
    const rows = [
      { "Convênio": "Bradesco Saúde", "Alias": "bradesco, bradesco saude, bsaude, bradescosaude" },
      { "Convênio": "Sul América", "Alias": "sul america, sulamerica, sul américa" },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["Convênio", "Alias"] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Convênios");
    XLSX.writeFile(wb, "modelo_convenios.xlsx");
  };

  const buildSlugLocal = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  // Importa com o mesmo escopo do filtro atual: se o usuário está vendo
  // "Somente <hospital atual>", os convênios entram vinculados a ele; caso
  // contrário entram como globais (comportamento antigo).
  const importHospitalId = scopeFilter === "current" ? (hospital?.id ?? null) : null;
  const importSuffix = importHospitalId && hospital ? hospitalSlugSuffix(hospital.name) : "";

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      const wb = isCsv
        ? XLSX.read(await file.text(), { type: "string" })
        : XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (rows.length === 0) { toast.error("Planilha vazia"); return; }

      const headers = Object.keys(rows[0]);
      const norm = (s: string) => s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const nameCol = headers.find(h => ["convenio", "nome", "nome canonico", "convênio"].includes(norm(h)))
        ?? headers[0];
      const aliasCol = headers.find(h => ["alias", "aliases", "variacoes", "variações"].includes(norm(h)))
        ?? headers[1];

      const payload = rows
        .map(r => {
          const name = String(r[nameCol] ?? "").trim();
          if (!name) return null;
          const aliases = String(r[aliasCol] ?? "")
            .split(",").map(a => a.trim()).filter(Boolean);
          const baseSlug = buildSlugLocal(name);
          const slug = importHospitalId ? `${baseSlug}_${importSuffix}` : baseSlug;
          return {
            slug,
            name,
            aliases,
            active: true,
            sort_order: 50,
            hospital_id: importHospitalId,
          };
        })
        .filter(Boolean) as any[];

      if (payload.length === 0) { toast.error("Nenhuma linha válida"); return; }

      const { error } = await supabase.from("convenios").upsert(payload, { onConflict: "slug" });
      if (error) { toast.error("Erro ao importar: " + error.message); return; }
      const dest = importHospitalId ? hospital!.name : "cadastro global";
      toast.success(`${payload.length} convênios importados para ${dest}`);
      load();
    } catch (e: any) {
      toast.error("Falha ao ler planilha: " + (e?.message ?? e));
    } finally {
      setImporting(false);
    }
  };


  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("convenios").select("*").order("sort_order").order("name");
    if (error) toast.error("Erro ao carregar convênios: " + error.message);
    else setList((data ?? []) as Convenio[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    // Novo convênio herda o escopo do filtro atual, mas o usuário pode trocar
    // no formulário antes de salvar.
    const initialHospital = scopeFilter === "current" ? (hospital?.id ?? null) : null;
    setEditing({ ...empty, hospital_id: initialHospital });
    setIsNew(true);
    setAliasInput("");
  };
  const openEdit = (c: Convenio) => {
    setEditing({ ...c, aliases: [...c.aliases] });
    setIsNew(false);
    setAliasInput("");
  };

  const save = async () => {
    if (!editing) return;
    let slug = (editing.slug || buildSlug(editing.name)).trim().toLowerCase();
    if (!slug || !editing.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    // Ao criar um convênio vinculado a hospital, garante slug único
    // sufixando com iniciais do hospital caso o base já exista globalmente.
    if (isNew && editing.hospital_id) {
      const h = availableHospitals.find(x => x.id === editing.hospital_id);
      const suffix = h ? hospitalSlugSuffix(h.name) : "";
      if (suffix && !slug.endsWith(`_${suffix}`)) slug = `${slug}_${suffix}`;
    }
    const payload = {
      ...editing,
      slug,
      aliases: editing.aliases.map(a => a.trim()).filter(Boolean),
      operator_code: editing.operator_code?.trim() || null,
      notes: editing.notes?.trim() || null,
      hospital_id: editing.hospital_id ?? null,
    };
    const { error } = isNew
      ? await supabase.from("convenios").insert(payload)
      : await supabase.from("convenios").update(payload).eq("slug", editing.slug);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(isNew ? "Convênio criado" : "Convênio atualizado");
    setEditing(null);
    load();
  };

  const addAlias = () => {
    if (!editing || !aliasInput.trim()) return;
    const v = aliasInput.trim();
    if (editing.aliases.some(a => a.toLowerCase() === v.toLowerCase())) {
      setAliasInput("");
      return;
    }
    setEditing({ ...editing, aliases: [...editing.aliases, v] });
    setAliasInput("");
  };

  const removeAlias = (a: string) => {
    if (!editing) return;
    setEditing({ ...editing, aliases: editing.aliases.filter(x => x !== a) });
  };

  const visible = useMemo(() => {
    // Filtro de escopo: por padrão mostra os do hospital ativo + globais
    // (mesma coisa que o motor enxerga em runtime).
    const activeId = hospital?.id ?? null;
    return list.filter(c => {
      if (scopeFilter === "global") {
        if (c.hospital_id !== null) return false;
      } else if (scopeFilter === "current") {
        if (c.hospital_id !== activeId) return false;
      } else {
        // "all" = escopo real: globais + do hospital ativo. Outros hospitais ficam ocultos.
        if (c.hospital_id !== null && c.hospital_id !== activeId) return false;
      }
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return c.name.toLowerCase().includes(s)
        || c.slug.toLowerCase().includes(s)
        || c.aliases.some(a => a.toLowerCase().includes(s))
        || (c.operator_code ?? "").toLowerCase().includes(s);
    });
  }, [list, scopeFilter, hospital?.id, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Convênios
          </h2>
          <p className="text-sm text-muted-foreground">
            Cada convênio pode ser <strong>global</strong> (compartilhado entre todos os hospitais) ou
            <strong> exclusivo de um hospital</strong>. Santa Luzia e Helena podem ter carteiras diferentes
            de convênios ativos.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />Baixar modelo
            </Button>
            <Button variant="outline" onClick={() => importRef.current?.click()} disabled={importing}>
              <Upload className="h-4 w-4 mr-1" />{importing ? "Importando…" : "Importar planilha"}
            </Button>
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                if (importRef.current) importRef.current.value = "";
              }}
            />
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" />Novo convênio
            </Button>
          </div>
        )}

      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por nome, alias ou código…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as ScopeFilter)}>
          <SelectTrigger className="w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Global + {hospital?.name ?? "hospital atual"}
            </SelectItem>
            <SelectItem value="current">
              Somente {hospital?.name ?? "hospital atual"}
            </SelectItem>
            <SelectItem value="global">Somente globais</SelectItem>
          </SelectContent>
        </Select>
        {scopeFilter === "current" && importHospitalId && (
          <span className="text-xs text-muted-foreground">
            Importações e novos convênios serão vinculados a <strong>{hospital?.name}</strong>.
          </span>
        )}
      </div>

      <div className="grid gap-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum convênio encontrado neste escopo.</p>
        )}
        {visible.map(c => (
          <Card key={c.slug} className={c.active ? "" : "opacity-60"}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.hospital_id ? (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Building2 className="h-3 w-3" />
                      {hospitalName(c.hospital_id)}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Globe2 className="h-3 w-3" />Global
                    </Badge>
                  )}
                  {c.code && (
                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{c.code}</code>
                  )}
                  {c.operator_code && (
                    <code className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                      {c.operator_code}
                    </code>
                  )}
                  <span className="font-semibold">{c.name}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.slug}</code>
                  {!c.active && <Badge variant="destructive" className="text-xs">inativo</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.aliases.length === 0 && (
                    <span className="text-xs text-muted-foreground">Sem aliases</span>
                  )}
                  {c.aliases.map(a => (
                    <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
              </div>
              {canManage && (
                <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? "Novo convênio" : `Editar ${editing?.name}`}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Escopo</Label>
                <Select
                  value={editing.hospital_id ?? "__global__"}
                  onValueChange={(v) =>
                    setEditing({ ...editing, hospital_id: v === "__global__" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__global__">Global — todos os hospitais</SelectItem>
                    {availableHospitals.map(h => (
                      <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Global = visível para todos os hospitais. Um hospital específico = ninguém mais enxerga.
                </p>
              </div>
              <div>
                <Label className="text-xs">Nome canônico</Label>
                <Input
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Bradesco Saúde"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Slug (interno)</Label>
                  <Input
                    value={editing.slug}
                    disabled={!isNew}
                    onChange={e => setEditing({ ...editing, slug: e.target.value })}
                    placeholder="auto a partir do nome"
                  />
                </div>
                <div>
                  <Label className="text-xs">Código operadora (opcional)</Label>
                  <Input
                    value={editing.operator_code ?? ""}
                    onChange={e => setEditing({ ...editing, operator_code: e.target.value })}
                    placeholder="Ex: 005711"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Ordem</Label>
                <Input
                  type="number"
                  value={editing.sort_order}
                  onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Aliases (variações reconhecidas)</Label>
                <div className="flex gap-2">
                  <Input
                    value={aliasInput}
                    onChange={e => setAliasInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                    placeholder="Digite e pressione Enter"
                  />
                  <Button type="button" variant="secondary" onClick={addAlias}>Adicionar</Button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {editing.aliases.map(a => (
                    <Badge key={a} variant="secondary" className="gap-1">
                      {a}
                      <button onClick={() => removeAlias(a)} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Observações</Label>
                <Textarea
                  value={editing.notes ?? ""}
                  rows={2}
                  onChange={e => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editing.active}
                  onCheckedChange={v => setEditing({ ...editing, active: v })}
                />
                <Label className="text-xs">Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
