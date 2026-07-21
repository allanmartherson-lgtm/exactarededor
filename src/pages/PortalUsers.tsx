import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Building2, Stethoscope, Save, Star, Plus, Check, ChevronsUpDown, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCPF, isValidCPF, onlyDigits } from "@/lib/cpf";
import { formatPhone, phoneSchema } from "@/lib/userFields";
import { formatDateTimeBR } from "@/lib/dateUtils";
import { ScrollArea } from "@/components/ui/scroll-area";

type Hospital = { id: string; name: string; state_uf: string };

type PortalUserRow = {
  id: string;
  user_id: string;
  parent_id: string;
  parent_name: string;
  parent_doc: string | null;
  email: string | null;
  full_name: string | null;
  cpf: string | null;
  phone: string | null;
  active: boolean;
  hospital_ids: Set<string>;
  primary_hospital_id: string | null;
};

type Kind = "company" | "doctor";

const CONFIG: Record<Kind, {
  portalTable: "company_portal_users" | "doctor_portal_users";
  linkTable: "company_portal_user_hospitals" | "doctor_portal_user_hospitals";
  parentTable: "companies" | "doctors";
  parentFk: "company_id" | "doctor_id";
  parentNameCol: string;
  parentDocCol: string;
  label: string;
  entityLabel: string;
  icon: typeof Building2;
}> = {
  company: {
    portalTable: "company_portal_users",
    linkTable: "company_portal_user_hospitals",
    parentTable: "companies",
    parentFk: "company_id",
    parentNameCol: "name",
    parentDocCol: "document",
    label: "Empresa",
    entityLabel: "empresa",
    icon: Building2,
  },
  doctor: {
    portalTable: "doctor_portal_users",
    linkTable: "doctor_portal_user_hospitals",
    parentTable: "doctors",
    parentFk: "doctor_id",
    parentNameCol: "full_name",
    parentDocCol: "crm",
    label: "Médico",
    entityLabel: "médico",
    icon: Stethoscope,
  },
};

// =============================================================================
// Diálogo de cadastro de novo usuário de portal
// =============================================================================
function NewPortalUserDialog({
  kind, hospitals, onCreated,
}: {
  kind: Kind;
  hospitals: Hospital[];
  onCreated: () => void;
}) {
  const cfg = CONFIG[kind];
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityLabel, setEntityLabel] = useState("");
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [entityQuery, setEntityQuery] = useState("");
  const [entityOptions, setEntityOptions] = useState<{ id: string; label: string; doc: string | null }[]>([]);
  const [selectedHospitals, setSelectedHospitals] = useState<Set<string>>(new Set());
  const [primaryHospital, setPrimaryHospital] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importedFromDoctor, setImportedFromDoctor] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const q = entityQuery.trim();
      let query: any = supabase
        .from(cfg.parentTable)
        .select(`id, ${cfg.parentNameCol}, ${cfg.parentDocCol}`)
        .order(cfg.parentNameCol)
        .limit(30);
      if (q) query = query.ilike(cfg.parentNameCol, `%${q}%`);
      if (kind === "doctor") query = query.eq("active", true);
      const { data } = await query;
      setEntityOptions(
        (data ?? []).map((r: any) => ({
          id: r.id,
          label: r[cfg.parentNameCol] ?? "—",
          doc: r[cfg.parentDocCol] ?? null,
        })),
      );
    })();
  }, [open, entityQuery, cfg, kind]);

  const reset = () => {
    setFullName(""); setEmail(""); setCpf(""); setPhone("");
    setEntityId(null); setEntityLabel("");
    setSelectedHospitals(new Set()); setPrimaryHospital(null); setEntityQuery("");
    setImportedFromDoctor(false);
  };

  const handleSelectEntity = async (opt: { id: string; label: string; doc: string | null }) => {
    setEntityId(opt.id);
    setEntityLabel(opt.label);
    setEntityPickerOpen(false);
    if (kind === "doctor") {
      const { data: doc } = await supabase
        .from("doctors")
        .select("full_name")
        .eq("id", opt.id)
        .maybeSingle();
      // PII (CPF, telefone, e-mail) via RPC restrita a admin/diretor
      const { data: piiRows } = await supabase.rpc("get_doctors_pii", { doctor_ids: [opt.id] });
      const pii = Array.isArray(piiRows) ? (piiRows[0] as any) : null;
      if (doc || pii) {
        if (doc?.full_name) setFullName(doc.full_name);
        if (pii?.email) setEmail(pii.email);
        if (pii?.cpf) setCpf(formatCPF(pii.cpf));
        if (pii?.phone) setPhone(formatPhone(pii.phone));
        setImportedFromDoctor(true);
        toast.success("Dados importados do cadastro do médico");
      }
    }
  };

  const submit = async () => {
    if (!email.trim() || !entityId) {
      toast.error("Informe e-mail e selecione a " + cfg.entityLabel);
      return;
    }
    // Validações obrigatórias de CPF e telefone
    if (!isValidCPF(cpf)) {
      toast.error("CPF inválido. Verifique os 11 dígitos.");
      return;
    }
    const phoneCheck = phoneSchema.safeParse(phone);
    if (!phoneCheck.success) {
      toast.error(phoneCheck.error.issues[0]?.message ?? "Telefone inválido");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-create-portal-user", {
      body: {
        kind,
        email: email.trim().toLowerCase(),
        full_name: fullName.trim(),
        cpf: onlyDigits(cpf),
        phone: phoneCheck.data,
        entity_id: entityId,
        hospital_ids: Array.from(selectedHospitals),
        primary_hospital_id: primaryHospital,
        send_invite: true,
        app_origin: window.location.origin,
      },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "Falha ao cadastrar");
      return;
    }
    toast.success("Usuário de portal cadastrado. Convite enviado por e-mail.");
    reset();
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Novo usuário</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadastrar usuário — Portal {cfg.label}</DialogTitle>
          <DialogDescription>
            Cria o acesso de portal para um(a) {cfg.entityLabel}. Este usuário <strong>não recebe permissão no Exacta</strong>;
            o acesso é feito pelo link enviado por e-mail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{cfg.label} vinculada</Label>
            <Popover open={entityPickerOpen} onOpenChange={setEntityPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between mt-1">
                  {entityLabel || `Selecionar ${cfg.entityLabel}…`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Buscar…"
                    value={entityQuery}
                    onValueChange={setEntityQuery}
                  />
                  <CommandList>
                    <CommandEmpty>Nenhum resultado.</CommandEmpty>
                    <CommandGroup>
                      {entityOptions.map((opt) => (
                        <CommandItem
                          key={opt.id}
                          value={opt.id}
                          onSelect={() => handleSelectEntity(opt)}
                        >
                          <Check className={cn("mr-2 h-4 w-4", entityId === opt.id ? "opacity-100" : "opacity-0")} />
                          <span className="flex-1 truncate">{opt.label}</span>
                          {opt.doc && <span className="ml-2 text-xs text-muted-foreground">{opt.doc}</span>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {kind === "doctor" && importedFromDoctor && (
              <p className="text-xs text-muted-foreground mt-2">
                Dados pré-preenchidos a partir do cadastro do médico. Se o médico for inativado, o acesso ao portal será desativado automaticamente.
              </p>
            )}
            {kind === "doctor" && !importedFromDoctor && (
              <p className="text-xs text-muted-foreground mt-2">
                A lista exibe apenas médicos ativos. O acesso ao portal seguirá o status do cadastro.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Nome completo</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ex.: Maria Souza" />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@empresa.com" />
            </div>
            <div>
              <Label>CPF</Label>
              <Input
                value={cpf}
                onChange={(e) => setCpf(formatCPF(e.target.value))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                maxLength={14}
              />
            </div>
            <div>
              <Label>Telefone (celular)</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="tel"
                maxLength={15}
              />
            </div>
          </div>


          <div>
            <Label>Hospitais (visibilidade)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Marque os hospitais que este usuário poderá ver no portal. A estrela define o principal.
            </p>
            <div className="grid gap-2 max-h-56 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {hospitals.map((h) => {
                const checked = selectedHospitals.has(h.id);
                const isPrimary = primaryHospital === h.id;
                return (
                  <div
                    key={h.id}
                    className={cn(
                      "flex items-center justify-between rounded-md border p-2 text-sm",
                      checked && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          setSelectedHospitals((prev) => {
                            const n = new Set(prev);
                            if (n.has(h.id)) { n.delete(h.id); if (primaryHospital === h.id) setPrimaryHospital(null); }
                            else { n.add(h.id); if (!primaryHospital) setPrimaryHospital(h.id); }
                            return n;
                          });
                        }}
                      />
                      <span className="truncate">{h.name}</span>
                      <span className="text-xs text-muted-foreground">{h.state_uf}</span>
                    </label>
                    {checked && (
                      <button type="button" onClick={() => setPrimaryHospital(h.id)} className="ml-2">
                        <Star className={cn("h-4 w-4", isPrimary ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Cadastrando…" : "Cadastrar e enviar convite"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Painel de histórico (audit_log) do usuário do portal e do médico vinculado
// =============================================================================
type AuditRow = {
  id: string;
  created_at: string;
  entity_type: string;
  action: string;
  actor_id: string | null;
  diff: Record<string, unknown> | null;
};

function describeAudit(r: AuditRow): string {
  const d = (r.diff ?? {}) as Record<string, unknown>;
  const reason = typeof d.reason === "string" ? d.reason : (typeof d.context === "string" ? d.context : null);
  const map: Record<string, string> = {
    portal_user_edit_sync: "Sincronização de cadastro via edição no portal",
    portal_user_auto_import: "Importação automática de dados do médico",
    portal_user_auto_import_from_doctor: "Dados importados do cadastro do médico",
    doctor_inactivation_cascade: "Desativação em cascata por inativação do médico",
    portal_user_company: "Criação de usuário do portal (empresa)",
    portal_user_doctor: "Criação de usuário do portal (médico)",
  };
  if (reason && map[reason]) return map[reason];
  if (reason) return reason;
  return `${r.entity_type} • ${r.action}`;
}

function AuditHistoryPanel({ userId, doctorId }: { userId: string; doctorId: string | null }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ids = [userId, ...(doctorId ? [doctorId] : [])];
      const { data } = await supabase
        .from("audit_log")
        .select("id, created_at, entity_type, action, actor_id, diff")
        .in("entity_id", ids)
        .order("created_at", { ascending: false })
        .limit(50);
      const list = (data ?? []) as AuditRow[];
      const actorIds = Array.from(new Set(list.map((r) => r.actor_id).filter(Boolean) as string[]));
      let actorMap: Record<string, string> = {};
      if (actorIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", actorIds);
        actorMap = Object.fromEntries(
          (profs ?? []).map((p: any) => [p.id, p.full_name || p.email || p.id.slice(0, 8)])
        );
      }
      if (cancelled) return;
      setRows(list);
      setActors(actorMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, doctorId]);

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">Histórico de alterações</span>
        <span className="text-xs text-muted-foreground">
          {loading ? "Carregando…" : `${rows.length} evento(s)`}
        </span>
      </div>
      <ScrollArea className="h-56">
        {!loading && rows.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Nenhuma alteração registrada ainda.
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const actor = r.actor_id ? actors[r.actor_id] ?? "—" : "Sistema";
              return (
                <li key={r.id} className="px-3 py-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{describeAudit(r)}</span>
                    <span className="shrink-0 text-muted-foreground">{formatDateTimeBR(r.created_at)}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {r.entity_type === "doctor" ? "Cadastro do médico" : "Usuário do portal"} • por {actor}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// Diálogo de edição de dados cadastrais do usuário de portal
// =============================================================================
function EditPortalUserDialog({
  row, kind, entityLabel, onSaved,
}: {
  row: PortalUserRow;
  kind: Kind;
  entityLabel: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(row.full_name ?? "");
  const [cpf, setCpf] = useState(row.cpf ? formatCPF(row.cpf) : "");
  const [phone, setPhone] = useState(row.phone ? formatPhone(row.phone) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFullName(row.full_name ?? "");
      setCpf(row.cpf ? formatCPF(row.cpf) : "");
      setPhone(row.phone ? formatPhone(row.phone) : "");
    }
  }, [open, row]);

  const isDoctor = kind === "doctor";

  const submit = async () => {
    if (cpf && !isValidCPF(cpf)) {
      toast.error("CPF inválido. Verifique os 11 dígitos.");
      return;
    }
    let phoneDigits = "";
    if (phone.trim()) {
      const r = phoneSchema.safeParse(phone);
      if (!r.success) {
        toast.error(r.error.issues[0]?.message ?? "Telefone inválido");
        return;
      }
      phoneDigits = r.data;
    }
    setSaving(true);
    const cpfDigits = cpf ? onlyDigits(cpf) : null;
    const nameTrim = fullName.trim() || null;

    // 1) Atualiza o profile do usuário do portal
    const { error: profErr } = await supabase
      .from("profiles")
      .update({ full_name: nameTrim, cpf: cpfDigits, phone: phoneDigits || null })
      .eq("id", row.user_id);
    if (profErr) {
      setSaving(false);
      toast.error(profErr.message);
      return;
    }

    // 2) Se for médico, propaga para o cadastro do médico (mantém telas em sincronia)
    if (isDoctor) {
      const { error: docErr } = await supabase
        .from("doctors")
        .update({ full_name: nameTrim, cpf: cpfDigits, phone: phoneDigits || null })
        .eq("id", row.parent_id);
      if (docErr) {
        setSaving(false);
        toast.error("Perfil atualizado, mas falhou ao sincronizar com o cadastro do médico: " + docErr.message);
        return;
      }
      // Log de auditoria da sincronização (best-effort)
      const { data: actor } = await supabase.auth.getUser();
      await supabase.from("audit_log").insert([
        {
          actor_id: actor?.user?.id ?? null,
          entity_type: "doctor",
          entity_id: row.parent_id,
          action: "updated",
          diff: {
            reason: "portal_user_edit_sync",
            portal_user_id: row.user_id,
            full_name: nameTrim,
            cpf: cpfDigits,
            phone: phoneDigits || null,
          },
        },
      ]);
    }

    setSaving(false);
    toast.success(isDoctor ? "Cadastro atualizado no portal e no médico" : "Cadastro atualizado");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="mr-2 h-4 w-4" />Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar usuário de portal</DialogTitle>
          <DialogDescription>
            Atualize os dados cadastrais do usuário vinculado à {entityLabel} <strong>{row.parent_name}</strong>.
            O e-mail é a identidade de acesso e não pode ser alterado aqui.
          </DialogDescription>
        </DialogHeader>

        {isDoctor && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <strong>Atenção:</strong> ao salvar, os dados (nome, CPF e telefone) também serão atualizados no
            <strong> cadastro do médico</strong>. As duas telas ficam em sincronia.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label>E-mail</Label>
              <Input value={row.email ?? ""} disabled />
            </div>
            <div>
              <Label>Nome completo</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label>CPF</Label>
              <Input
                value={cpf}
                onChange={(e) => setCpf(formatCPF(e.target.value))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                maxLength={14}
              />
            </div>
            <div>
              <Label>Telefone (celular)</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="tel"
                maxLength={15}
              />
            </div>
          </div>
          <AuditHistoryPanel userId={row.user_id} doctorId={isDoctor ? row.parent_id : null} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Painel principal por tipo
// =============================================================================
function PortalUsersPanel({ kind, hospitals }: { kind: Kind; hospitals: Hospital[] }) {
  const cfg = CONFIG[kind];
  const [rows, setRows] = useState<PortalUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: users, error } = await supabase
      .from(cfg.portalTable)
      .select(`id, user_id, ${cfg.parentFk}, active`);
    if (error) {
      toast.error("Falha ao carregar usuários do portal");
      setLoading(false);
      return;
    }
    const parentIds = (users ?? []).map((u: any) => u[cfg.parentFk]).filter(Boolean);
    const userIds = (users ?? []).map((u: any) => u.user_id).filter(Boolean);

    const [parentsRes, linksRes, profilesRes] = await Promise.all([
      supabase
        .from(cfg.parentTable)
        .select(`id, ${cfg.parentNameCol}, ${cfg.parentDocCol}`)
        .in("id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]),
      supabase
        .from(cfg.linkTable)
        .select("portal_user_id, hospital_id, is_primary")
        .in("portal_user_id", (users ?? []).map((u: any) => u.id)),
      supabase
        .from("profiles")
        .select("id, email, full_name, cpf, phone")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    const parentMap = new Map<string, any>((parentsRes.data ?? []).map((p: any) => [p.id, p]));
    const profileMap = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const linksByUser = new Map<string, { hospital_id: string; is_primary: boolean }[]>();
    for (const l of linksRes.data ?? []) {
      const arr = linksByUser.get((l as any).portal_user_id) ?? [];
      arr.push({ hospital_id: (l as any).hospital_id, is_primary: (l as any).is_primary });
      linksByUser.set((l as any).portal_user_id, arr);
    }

    const built: PortalUserRow[] = (users ?? []).map((u: any) => {
      const parent = parentMap.get(u[cfg.parentFk]);
      const profile = profileMap.get(u.user_id);
      const links = linksByUser.get(u.id) ?? [];
      return {
        id: u.id,
        user_id: u.user_id,
        parent_id: u[cfg.parentFk],
        parent_name: parent?.[cfg.parentNameCol] ?? "—",
        parent_doc: parent?.[cfg.parentDocCol] ?? null,
        email: profile?.email ?? null,
        full_name: profile?.full_name ?? null,
        cpf: profile?.cpf ?? null,
        phone: profile?.phone ?? null,
        active: u.active,
        hospital_ids: new Set(links.map((l) => l.hospital_id)),
        primary_hospital_id: links.find((l) => l.is_primary)?.hospital_id ?? null,
      };
    });
    built.sort((a, b) => Number(b.active) - Number(a.active) || a.parent_name.localeCompare(b.parent_name));
    setRows(built);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [kind]);

  const toggleHospital = (rowId: string, hospitalId: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const next = new Set(r.hospital_ids);
      if (next.has(hospitalId)) {
        next.delete(hospitalId);
        return {
          ...r,
          hospital_ids: next,
          primary_hospital_id: r.primary_hospital_id === hospitalId ? null : r.primary_hospital_id,
        };
      }
      next.add(hospitalId);
      return { ...r, hospital_ids: next, primary_hospital_id: r.primary_hospital_id ?? hospitalId };
    }));
  };

  const setPrimary = (rowId: string, hospitalId: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const next = new Set(r.hospital_ids);
      next.add(hospitalId);
      return { ...r, hospital_ids: next, primary_hospital_id: hospitalId };
    }));
  };

  const save = async (row: PortalUserRow) => {
    setSavingId(row.id);
    const { error: delErr } = await supabase
      .from(cfg.linkTable)
      .delete()
      .eq("portal_user_id", row.id);
    if (delErr) {
      toast.error("Falha ao salvar (limpeza)");
      setSavingId(null);
      return;
    }
    if (row.hospital_ids.size > 0) {
      const payload = Array.from(row.hospital_ids).map((hid) => ({
        portal_user_id: row.id,
        hospital_id: hid,
        is_primary: hid === row.primary_hospital_id,
      }));
      const { error: insErr } = await supabase.from(cfg.linkTable).insert(payload);
      if (insErr) {
        toast.error("Falha ao salvar vínculos");
        setSavingId(null);
        return;
      }
    }
    toast.success("Vínculos atualizados");
    setSavingId(null);
  };

  const toggleActive = async (row: PortalUserRow) => {
    setTogglingId(row.id);
    const nextActive = !row.active;
    const { error } = await supabase
      .from(cfg.portalTable)
      .update({ active: nextActive })
      .eq("id", row.id);
    setTogglingId(null);
    if (error) {
      toast.error("Falha ao alterar o status do acesso");
      return;
    }
    toast.success(nextActive ? "Acesso habilitado" : "Acesso desabilitado");
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: nextActive } : r)));
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return rows
      .filter((r) => showInactive ? true : r.active)
      .filter((r) => {
        if (!q) return true;
        const textMatch =
          r.parent_name.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.full_name ?? "").toLowerCase().includes(q) ||
          (r.parent_doc ?? "").toLowerCase().includes(q);
        const digitMatch = qDigits.length >= 3 && (
          (r.cpf ?? "").replace(/\D/g, "").includes(qDigits) ||
          (r.phone ?? "").replace(/\D/g, "").includes(qDigits)
        );
        return textMatch || digitMatch;
      });
  }, [rows, filter, showInactive]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3 min-w-[260px]">
          <Input
            placeholder={`Buscar por ${cfg.entityLabel}, nome, e-mail, CPF, telefone ou documento…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-md"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Mostrar desabilitados
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{filtered.length} usuários</Badge>
          <NewPortalUserDialog kind={kind} hospitals={hospitals} onCreated={load} />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum usuário de portal {cfg.entityLabel} encontrado.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => {
            const Icon = cfg.icon;
            return (
              <Card key={row.id} className={cn(!row.active && "opacity-70")}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-muted p-2"><Icon className="h-4 w-4" /></div>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {row.parent_name}
                          {!row.active && <Badge variant="outline" className="text-xs">Desabilitado</Badge>}
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {row.full_name && <span>{row.full_name}</span>}
                          {row.parent_doc && <span>{row.parent_doc}</span>}
                          {row.email && <span>{row.email}</span>}
                          {row.cpf && <span>CPF {formatCPF(row.cpf)}</span>}
                          {row.phone && <span>{formatPhone(row.phone)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={row.active}
                          disabled={togglingId === row.id}
                          onCheckedChange={() => toggleActive(row)}
                        />
                        {row.active ? "Habilitado" : "Desabilitado"}
                      </label>
                      <EditPortalUserDialog row={row} kind={kind} entityLabel={cfg.entityLabel} onSaved={load} />
                      <Button size="sm" onClick={() => save(row)} disabled={savingId === row.id || !row.active}>
                        <Save className="mr-2 h-4 w-4" />
                        {savingId === row.id ? "Salvando…" : "Salvar"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Hospitais que este usuário pode acessar
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {hospitals.map((h) => {
                      const checked = row.hospital_ids.has(h.id);
                      const isPrimary = row.primary_hospital_id === h.id;
                      return (
                        <div
                          key={h.id}
                          className={cn(
                            "flex items-center justify-between rounded-md border p-2 text-sm",
                            checked && "border-primary/40 bg-primary/5",
                          )}
                        >
                          <label className="flex items-center gap-2 cursor-pointer flex-1">
                            <Checkbox
                              checked={checked}
                              disabled={!row.active}
                              onCheckedChange={() => toggleHospital(row.id, h.id)}
                            />
                            <span className="truncate">{h.name}</span>
                            <span className="text-xs text-muted-foreground">{h.state_uf}</span>
                          </label>
                          {checked && (
                            <button
                              type="button"
                              onClick={() => setPrimary(row.id, h.id)}
                              title="Definir como hospital principal"
                              className="ml-2"
                              disabled={!row.active}
                            >
                              <Star
                                className={cn(
                                  "h-4 w-4",
                                  isPrimary ? "fill-amber-400 text-amber-500" : "text-muted-foreground",
                                )}
                              />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PortalUsers() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("hospitals")
        .select("id, name, state_uf")
        .eq("active", true)
        .order("name");
      setHospitals((data ?? []) as Hospital[]);
    })();
  }, []);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Acessos aos Portais"
        description="Cadastre, habilite/desabilite e defina em quais hospitais cada usuário externo (empresa ou médico) pode operar. Usuários de portal não têm acesso ao Exacta — o login é feito pelo link enviado por e-mail."
      />
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company"><Building2 className="mr-2 h-4 w-4" />Portal Empresa</TabsTrigger>
          <TabsTrigger value="doctor"><Stethoscope className="mr-2 h-4 w-4" />Portal Médico</TabsTrigger>
        </TabsList>
        <TabsContent value="company" className="mt-4">
          <PortalUsersPanel kind="company" hospitals={hospitals} />
        </TabsContent>
        <TabsContent value="doctor" className="mt-4">
          <PortalUsersPanel kind="doctor" hospitals={hospitals} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
