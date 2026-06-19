import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { Plus, Loader2, Pencil } from "lucide-react";

interface TypeRow {
  id: string;
  code: string;
  label: string;
  description: string | null;
  requires_justification: boolean;
  active: boolean;
  hospital_id: string | null;
}

export default function SpecialCaseTypesAdmin() {
  const { toast } = useToast();
  const hospitalId = useActiveHospitalId();
  const [rows, setRows] = useState<TypeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TypeRow | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // form fields
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [requiresJustification, setRequiresJustification] = useState(true);
  const [active, setActive] = useState(true);
  const [scopeHospital, setScopeHospital] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("special_case_types")
      .select("id, code, label, description, requires_justification, active, hospital_id")
      .order("label");
    setRows((data as TypeRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setEditing(null);
    setCode("");
    setLabel("");
    setDescription("");
    setRequiresJustification(true);
    setActive(true);
    setScopeHospital(true);
  };

  const startEdit = (row: TypeRow) => {
    setEditing(row);
    setCode(row.code);
    setLabel(row.label);
    setDescription(row.description ?? "");
    setRequiresJustification(row.requires_justification);
    setActive(row.active);
    setScopeHospital(!!row.hospital_id);
    setOpen(true);
  };

  const save = async () => {
    if (!code.trim() || !label.trim()) {
      toast({ title: "Preencha código e rótulo", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: code.trim().toLowerCase().replace(/\s+/g, "_"),
        label: label.trim(),
        description: description.trim() || null,
        requires_justification: requiresJustification,
        active,
        hospital_id: scopeHospital ? hospitalId : null,
      };
      let err;
      if (editing) {
        ({ error: err } = await supabase
          .from("special_case_types")
          .update(payload)
          .eq("id", editing.id));
      } else {
        ({ error: err } = await supabase.from("special_case_types").insert(payload));
      }
      if (err) throw err;
      toast({ title: editing ? "Tipo atualizado" : "Tipo criado" });
      setOpen(false);
      resetForm();
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao salvar", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: TypeRow) => {
    const { error } = await supabase
      .from("special_case_types")
      .update({ active: !row.active })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Falha", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Tipos de caso especial"
        description="Catálogo de patologias/contextos (oncológico, pediátrico, etc.) que habilitam regras diferenciadas"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Tipos cadastrados</CardTitle>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo tipo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Editar tipo" : "Novo tipo de caso especial"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Código</Label>
                  <Input
                    placeholder="ex: oncologico"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={!!editing}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Identificador técnico (sem espaços). Usado nas regras (`special_case_filter`).
                  </p>
                </div>
                <div>
                  <Label>Rótulo</Label>
                  <Input
                    placeholder="ex: Oncológico"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea
                    placeholder="Quando usar este tipo, critérios, etc."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="rj">Exige justificativa ao marcar</Label>
                  <Switch id="rj" checked={requiresJustification} onCheckedChange={setRequiresJustification} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="ac">Ativo</Label>
                  <Switch id="ac" checked={active} onCheckedChange={setActive} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="sc">Restrito a este hospital</Label>
                  <Switch id="sc" checked={scopeHospital} onCheckedChange={setScopeHospital} disabled={!hospitalId} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Desligado = tipo global, visível em todos os hospitais.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {editing ? "Salvar" : "Criar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground text-sm">Nenhum tipo cadastrado ainda.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead>Justificativa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>
                      <div>{row.label}</div>
                      {row.description && <div className="text-xs text-muted-foreground">{row.description}</div>}
                    </TableCell>
                    <TableCell>
                      {row.hospital_id ? <Badge variant="outline">Hospital</Badge> : <Badge variant="secondary">Global</Badge>}
                    </TableCell>
                    <TableCell>{row.requires_justification ? "Obrigatória" : "Opcional"}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleActive(row)}
                        className="text-left"
                      >
                        <Badge variant={row.active ? "default" : "outline"}>
                          {row.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
