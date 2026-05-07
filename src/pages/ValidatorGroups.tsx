import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Users2, Plus, Trash2, Pencil } from "lucide-react";

type Group = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
};

type Member = { id: string; group_id: string; user_id: string };

type ValidatorUser = { id: string; full_name: string | null; email: string };

const ValidatorGroups = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [validators, setValidators] = useState<ValidatorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [form, setForm] = useState<{ name: string; description: string; active: boolean; memberIds: Set<string> }>({
    name: "",
    description: "",
    active: true,
    memberIds: new Set(),
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [gRes, mRes, rolesRes] = await Promise.all([
      supabase.from("validator_groups").select("*").order("name"),
      supabase.from("validator_group_members").select("*"),
      supabase.from("user_roles").select("user_id").eq("role", "validador"),
    ]);
    if (gRes.error) toast({ title: "Erro ao carregar grupos", description: gRes.error.message, variant: "destructive" });
    if (mRes.error) toast({ title: "Erro ao carregar membros", description: mRes.error.message, variant: "destructive" });
    setGroups((gRes.data ?? []) as Group[]);
    setMembers((mRes.data ?? []) as Member[]);

    const validatorIds = Array.from(new Set((rolesRes.data ?? []).map((r) => r.user_id)));
    if (validatorIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", validatorIds);
      setValidators(((profs ?? []) as ValidatorUser[]).sort((a, b) =>
        (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email),
      ));
    } else {
      setValidators([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, Member[]>();
    for (const x of members) {
      const arr = m.get(x.group_id) ?? [];
      arr.push(x);
      m.set(x.group_id, arr);
    }
    return m;
  }, [members]);

  const validatorById = useMemo(() => {
    const m = new Map<string, ValidatorUser>();
    for (const v of validators) m.set(v.id, v);
    return m;
  }, [validators]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", description: "", active: true, memberIds: new Set() });
    setDialogOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditing(g);
    const memberIds = new Set((membersByGroup.get(g.id) ?? []).map((x) => x.user_id));
    setForm({ name: g.name, description: g.description ?? "", active: g.active, memberIds });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    setSaving(true);
    let groupId = editing?.id;
    if (editing) {
      const { error } = await supabase
        .from("validator_groups")
        .update({ name: form.name.trim(), description: form.description.trim() || null, active: form.active })
        .eq("id", editing.id);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("validator_groups")
        .insert({ name: form.name.trim(), description: form.description.trim() || null, active: form.active })
        .select("id")
        .single();
      if (error || !data) {
        toast({ title: "Erro ao criar", description: error?.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      groupId = data.id;
    }

    if (groupId) {
      const current = new Set((membersByGroup.get(groupId) ?? []).map((x) => x.user_id));
      const desired = form.memberIds;
      const toAdd = Array.from(desired).filter((u) => !current.has(u));
      const toRemove = Array.from(current).filter((u) => !desired.has(u));
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("validator_group_members")
          .insert(toAdd.map((user_id) => ({ group_id: groupId!, user_id })));
        if (error) toast({ title: "Erro ao adicionar membros", description: error.message, variant: "destructive" });
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("validator_group_members")
          .delete()
          .eq("group_id", groupId)
          .in("user_id", toRemove);
        if (error) toast({ title: "Erro ao remover membros", description: error.message, variant: "destructive" });
      }
    }

    setSaving(false);
    setDialogOpen(false);
    toast({ title: editing ? "Grupo atualizado" : "Grupo criado" });
    await load();
  };

  const remove = async (g: Group) => {
    if (!confirm(`Excluir o grupo "${g.name}"?`)) return;
    const { error } = await supabase.from("validator_groups").delete().eq("id", g.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Grupo excluído" });
    await load();
  };

  const toggleMember = (userId: string) => {
    setForm((f) => {
      const next = new Set(f.memberIds);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return { ...f, memberIds: next };
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users2}
        title="Grupos de validadores"
        description="Organize os validadores em grupos. Ao enviar um pagamento para validação, o analista pode escolher um validador específico, um grupo, ou deixar na fila geral."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Novo grupo
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grupos cadastrados ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum grupo criado ainda. Crie o primeiro grupo para começar a rotear pagamentos.
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => {
                const gm = membersByGroup.get(g.id) ?? [];
                return (
                  <div
                    key={g.id}
                    className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-4 border rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{g.name}</span>
                        {!g.active && <Badge variant="secondary">Inativo</Badge>}
                        <Badge variant="outline">{gm.length} membro(s)</Badge>
                      </div>
                      {g.description && (
                        <p className="text-sm text-muted-foreground mt-1">{g.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {gm.map((m) => {
                          const v = validatorById.get(m.user_id);
                          return (
                            <Badge key={m.id} variant="secondary" className="text-xs">
                              {v?.full_name ?? v?.email ?? m.user_id.slice(0, 8)}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(g)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => remove(g)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar grupo" : "Novo grupo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="vg-name">Nome</Label>
              <Input
                id="vg-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex.: Validadores SP"
              />
            </div>
            <div>
              <Label htmlFor="vg-desc">Descrição</Label>
              <Textarea
                id="vg-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="vg-active">Ativo</Label>
              <Switch
                id="vg-active"
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
            <div>
              <Label>Membros (validadores)</Label>
              {validators.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">
                  Nenhum usuário com papel de validador cadastrado.
                </p>
              ) : (
                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto border rounded p-2">
                  {validators.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.memberIds.has(v.id)}
                        onCheckedChange={() => toggleMember(v.id)}
                      />
                      <span className="text-sm">
                        {v.full_name ?? v.email}{" "}
                        <span className="text-muted-foreground">({v.email})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ValidatorGroups;
