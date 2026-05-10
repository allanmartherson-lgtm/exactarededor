import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/FormDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Stethoscope, Plus, Trash2, Pencil, Upload, Download, Building2, X } from "lucide-react";
import { ImportWizard, type ImportProfile } from "@/components/ImportWizard";

const DOCTORS_IMPORT_PROFILE: ImportProfile = {
  entity: "doctors",
  supportedModes: ["append", "update", "replace"],
  fields: [
    { key: "full_name", label: "Nome completo", required: true, aliases: ["nome", "medico", "médico", "nome_completo"] },
    { key: "crm", label: "CRM", required: true, uniqueKey: true, aliases: ["crm", "registro"] },
    { key: "crm_uf", label: "UF do CRM", required: true, uniqueKey: true, aliases: ["uf", "estado", "uf_crm"] },
    { key: "email", label: "E-mail", aliases: ["email", "e-mail"] },
    { key: "phone", label: "Telefone", aliases: ["telefone", "celular", "fone"] },
    { key: "specialties", label: "Especialidades", type: "array", aliases: ["especialidade", "especialidades"] },
    { key: "active", label: "Ativo", type: "boolean", aliases: ["ativo", "status"], defaultValue: true },
    { key: "companies_raw", label: "Empresa(s)/PJ", type: "array", aliases: ["empresa", "empresas", "pj", "pjs", "clinica", "clínica"] },
  ],
};

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

interface Doctor {
  id: string;
  full_name: string;
  crm: string;
  crm_uf: string;
  email: string | null;
  phone: string | null;
  specialties: string[];
  active: boolean;
  notes: string | null;
}
interface Company { id: string; name: string; document: string | null; }
interface Link { doctor_id: string; company_id: string; }

const empty: Doctor = {
  id: "", full_name: "", crm: "", crm_uf: "", email: "", phone: "",
  specialties: [], active: true, notes: "",
};

const norm = (s: string) =>
  (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) for (const rk of Object.keys(row)) {
    if (norm(rk).replace(/[\s_\-./]+/g, "").includes(norm(k).replace(/[\s_\-./]+/g, ""))) return row[rk];
  }
  return undefined;
};
const toStr = (v: unknown): string => v == null ? "" : String(v).trim();

function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const sa = new Set(x.split(/\s+/).filter((p) => p.length > 2));
  const sb = new Set(y.split(/\s+/).filter((p) => p.length > 2));
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  sa.forEach((p) => { if (sb.has(p)) common++; });
  return common / Math.max(sa.size, sb.size);
}

export default function Doctors() {
  const [items, setItems] = useState<Doctor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor>(empty);
  const [editingCompanyIds, setEditingCompanyIds] = useState<string[]>([]);
  const [specInput, setSpecInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");

  useEffect(() => {
    document.title = "Médicos | MedPay";
    load();
  }, []);

  const load = async () => {
    // Médicos e empresas podem passar de 1000 registros, então aumentamos o limite.
    const [d, c, l] = await Promise.all([
      supabase.from("doctors").select("*").order("full_name").limit(10000),
      supabase.from("companies").select("id,name,document").order("name").limit(5000),
      supabase.from("doctor_companies").select("doctor_id,company_id").limit(20000),
    ]);
    setItems((d.data ?? []) as Doctor[]);
    setCompanies((c.data ?? []) as Company[]);
    setLinks((l.data ?? []) as Link[]);
  };

  const linksByDoctor = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      const arr = m.get(l.doctor_id) ?? [];
      arr.push(l.company_id);
      m.set(l.doctor_id, arr);
    }
    return m;
  }, [links]);

  const companiesById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const openNew = () => {
    setEditing(empty);
    setEditingCompanyIds([]);
    setSpecInput("");
    setCompanySearch("");
    setOpen(true);
  };

  const openEdit = (d: Doctor) => {
    setEditing(d);
    setEditingCompanyIds(linksByDoctor.get(d.id) ?? []);
    setSpecInput("");
    setCompanySearch("");
    setOpen(true);
  };

  const save = async () => {
    const name = editing.full_name.trim();
    const crm = editing.crm.trim();
    const uf = editing.crm_uf.trim().toUpperCase();
    if (!name) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (!crm) { toast({ title: "CRM obrigatório", variant: "destructive" }); return; }
    if (!uf) { toast({ title: "UF do CRM obrigatória", variant: "destructive" }); return; }
    if (!UFS.includes(uf)) { toast({ title: "UF inválida", variant: "destructive" }); return; }

    // Duplicidade por nome semelhante (alerta)
    const sims = items.filter((x) => x.id !== editing.id && similarity(x.full_name, name) >= 0.7);
    if (sims.length > 0 && !editing.id) {
      const ok = confirm(`Possível duplicidade encontrada:\n${sims.slice(0, 3).map((s) => `• ${s.full_name} (${s.crm}/${s.crm_uf})`).join("\n")}\n\nDeseja continuar mesmo assim?`);
      if (!ok) return;
    }

    const payload = {
      full_name: name,
      crm,
      crm_uf: uf,
      email: editing.email?.trim() || null,
      phone: editing.phone?.trim() || null,
      specialties: editing.specialties,
      active: editing.active,
      notes: editing.notes?.trim() || null,
    };

    let savedId = editing.id;
    if (editing.id) {
      const { error } = await supabase.from("doctors").update(payload).eq("id", editing.id);
      if (error) { handleErr(error); return; }
    } else {
      const { data, error } = await supabase.from("doctors").insert(payload).select("id").single();
      if (error) { handleErr(error); return; }
      savedId = data.id;
    }

    // Vínculos: substitui pelo set atual
    if (savedId) {
      await supabase.from("doctor_companies").delete().eq("doctor_id", savedId);
      if (editingCompanyIds.length > 0) {
        await supabase.from("doctor_companies").insert(
          editingCompanyIds.map((cid) => ({ doctor_id: savedId!, company_id: cid })),
        );
      }
    }

    toast({ title: editing.id ? "Médico atualizado" : "Médico criado" });
    setOpen(false);
    load();
  };

  const handleErr = (error: any) => {
    if (error.code === "23505") {
      toast({
        title: "CRM duplicado",
        description: "Já existe um médico com este CRM nesta UF.",
        variant: "destructive",
      });
    } else {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir médico?")) return;
    const { error } = await supabase.from("doctors").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["nome", "crm", "uf", "email", "telefone", "especialidades", "ativo", "empresas", "observacoes"],
      ["Dr. João Silva", "12345", "DF", "joao@x.com", "(61) 99999-9999", "Cardiologia; Hemodinâmica", "sim", "Clínica X; Hospital Y", ""],
    ]);
    ws["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 6 }, { wch: 25 }, { wch: 18 }, { wch: 30 }, { wch: 8 }, { wch: 30 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Médicos");
    XLSX.writeFile(wb, "modelo-medicos.xlsx");
  };

  // Importação via wizard padrão (ImportWizard) — fluxo: upload → mapeamento → validação → confirmação → resumo.

  const filtered = useMemo(() => {
    const q = norm(search);
    return items.filter((d) => {
      if (filterCompany) {
        const cids = linksByDoctor.get(d.id) ?? [];
        if (!cids.includes(filterCompany)) return false;
      }
      if (!q) return true;
      const hay = [d.full_name, d.crm, d.crm_uf, d.email ?? "", ...(d.specialties ?? [])].map(norm).join(" ");
      return hay.includes(q);
    });
  }, [items, search, filterCompany, linksByDoctor]);

  // Se houver busca, mostramos apenas os filtrados. 
  // Se não houver busca, mostramos os primeiros 100 para não travar o browser, 
  // mas garantimos que as ações de edição estejam sempre disponíveis.
  const displayItems = useMemo(() => {
    // Aumentamos o limite de exibição inicial para 1000 para que mais médicos sejam visíveis
    // sem precisar de busca imediata, mantendo a performance.
    if (search.trim() || filterCompany) return filtered;
    return filtered.slice(0, 1000);
  }, [filtered, search, filterCompany]);

  const filteredCompaniesForDialog = useMemo(() => {
    const q = norm(companySearch);
    if (!q) return companies;
    return companies.filter((c) => norm(c.name).includes(q));
  }, [companies, companySearch]);

  return (
    <div className="flex flex-col h-full w-full max-w-[100vw] overflow-x-hidden">
      <PageHeader title="Médicos" description="Cadastro mestre de médicos para regras, vínculos com empresas e validações." />
      <div className="p-4 md:p-8 w-full mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <Input
              placeholder="Buscar por nome, CRM, especialidade..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
            <Select value={filterCompany || "_all"} onValueChange={(v) => setFilterCompany(v === "_all" ? "" : v)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Filtrar por empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Todas as empresas</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" /> Modelo
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Importar
            </Button>
            <ImportWizard
              open={importOpen}
              onOpenChange={setImportOpen}
              title="Importar médicos"
              profile={DOCTORS_IMPORT_PROFILE}
              onComplete={() => load()}
            />
            <>
              <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo médico</Button>
              <FormDialog
                open={open}
                onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(empty); setEditingCompanyIds([]); } }}
                title={editing.id ? "Editar médico" : "Novo médico"}
                maxWidth="5xl"
                footer={
                  <div className="w-full flex items-center justify-end gap-3">
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button type="submit" form="doctor-form">Salvar</Button>
                  </div>
                }
              >
                <form id="doctor-form" onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-3 space-y-1.5">
                      <Label>Nome completo *</Label>
                      <Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label>CRM *</Label>
                      <Input value={editing.crm} onChange={(e) => setEditing({ ...editing, crm: e.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>UF *</Label>
                      <Select value={editing.crm_uf} onValueChange={(v) => setEditing({ ...editing, crm_uf: v })}>
                        <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                        <SelectContent>
                          {UFS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>E-mail</Label>
                      <Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Telefone</Label>
                      <Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Especialidade(s)</Label>
                    <Input
                      value={specInput}
                      onChange={(e) => setSpecInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && specInput.trim()) {
                          e.preventDefault();
                          setEditing({ ...editing, specialties: [...editing.specialties, specInput.trim()] });
                          setSpecInput("");
                        }
                      }}
                      placeholder="Pressione Enter para adicionar"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {editing.specialties.map((s, i) => (
                        <Badge key={i} variant="secondary" className="gap-1">
                          {s}
                          <button onClick={() => setEditing({ ...editing, specialties: editing.specialties.filter((_, j) => j !== i) })}>×</button>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                    <Label>Ativo</Label>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Empresas / PJs vinculadas</Label>
                    <Input
                      placeholder="Buscar empresa..."
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                    />
                    <div className="border border-border rounded-md max-h-48 overflow-y-auto p-2 space-y-1">
                      {filteredCompaniesForDialog.length === 0 && (
                        <p className="text-xs text-muted-foreground p-2">Nenhuma empresa.</p>
                      )}
                      {filteredCompaniesForDialog.map((c) => {
                        const checked = editingCompanyIds.includes(c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/50 rounded px-2 py-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setEditingCompanyIds(
                                checked
                                  ? editingCompanyIds.filter((id) => id !== c.id)
                                  : [...editingCompanyIds, c.id]
                              )}
                            />
                            <span>{c.name}</span>
                            {c.document && <span className="text-xs text-muted-foreground">{c.document}</span>}
                          </label>
                        );
                      })}
                    </div>
                    {editingCompanyIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {editingCompanyIds.map((cid) => {
                          const c = companiesById.get(cid);
                          if (!c) return null;
                          return (
                            <Badge key={cid} variant="outline" className="gap-1">
                              {c.name}
                              <button onClick={() => setEditingCompanyIds(editingCompanyIds.filter((id) => id !== cid))}>
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Observações internas</Label>
                    <Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="Notas, contatos adicionais..." />
                  </div>
                </form>
              </FormDialog>
            </>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">
              {filtered.length} médico(s) {filtered.length > displayItems.length && `(mostrando primeiros ${displayItems.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {displayItems.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">Nenhum médico encontrado.</p>
            ) : (
              <div className="divide-y divide-border">
                {displayItems.map((d) => (
                  <div key={d.id} className="p-4 flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center">
                      <div className="sm:col-span-4 min-w-0">
                        <div className="flex items-center gap-2">
                          <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
                          <p className="font-semibold text-sm truncate" title={d.full_name}>{d.full_name}</p>
                          {!d.active && <Badge variant="outline" className="text-[10px] h-4">Inativo</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-1">{d.crm}/{d.crm_uf}</p>
                      </div>
                      <div className="sm:col-span-4 min-w-0">
                        <div className="flex flex-wrap gap-1">
                          {d.specialties?.map((s, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] break-all whitespace-normal">
                              {s}
                            </Badge>
                          ))}
                          {!d.specialties?.length && <span className="text-xs text-muted-foreground italic">Sem especialidade</span>}
                        </div>
                      </div>
                      <div className="sm:col-span-4 min-w-0 flex sm:justify-end">
                        <div className="flex flex-col sm:items-end gap-0.5 min-w-0">
                          <p className="text-xs truncate max-w-full" title={d.email || ""}>{d.email || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{d.phone || "—"}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(d)} className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(d.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
