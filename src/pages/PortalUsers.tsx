import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Building2, Stethoscope, Save, Star } from "lucide-react";
import { toast } from "sonner";

type Hospital = { id: string; name: string; state_uf: string };

type PortalUserRow = {
  id: string;
  user_id: string;
  parent_id: string;
  parent_name: string;
  parent_doc: string | null;
  email: string | null;
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
  icon: typeof Building2;
}> = {
  company: {
    portalTable: "company_portal_users",
    linkTable: "company_portal_user_hospitals",
    parentTable: "companies",
    parentFk: "company_id",
    parentNameCol: "name",
    parentDocCol: "cnpj",
    label: "Empresa",
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
    icon: Stethoscope,
  },
};

function PortalUsersPanel({ kind, hospitals }: { kind: Kind; hospitals: Hospital[] }) {
  const cfg = CONFIG[kind];
  const [rows, setRows] = useState<PortalUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: users, error } = await supabase
      .from(cfg.portalTable)
      .select(`id, user_id, ${cfg.parentFk}, active`)
      .eq("active", true);
    if (error) {
      toast.error("Falha ao carregar usuários do portal");
      setLoading(false);
      return;
    }
    const parentIds = (users ?? []).map((u: any) => u[cfg.parentFk]).filter(Boolean);
    const userIds = (users ?? []).map((u: any) => u.user_id).filter(Boolean);

    const [parentsRes, linksRes, emailsRes] = await Promise.all([
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
        .select("id, email")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    const parentMap = new Map<string, any>((parentsRes.data ?? []).map((p: any) => [p.id, p]));
    const emailMap = new Map<string, string>((emailsRes.data ?? []).map((p: any) => [p.id, p.email]));
    const linksByUser = new Map<string, { hospital_id: string; is_primary: boolean }[]>();
    for (const l of linksRes.data ?? []) {
      const arr = linksByUser.get((l as any).portal_user_id) ?? [];
      arr.push({ hospital_id: (l as any).hospital_id, is_primary: (l as any).is_primary });
      linksByUser.set((l as any).portal_user_id, arr);
    }

    const built: PortalUserRow[] = (users ?? []).map((u: any) => {
      const parent = parentMap.get(u[cfg.parentFk]);
      const links = linksByUser.get(u.id) ?? [];
      return {
        id: u.id,
        user_id: u.user_id,
        parent_id: u[cfg.parentFk],
        parent_name: parent?.[cfg.parentNameCol] ?? "—",
        parent_doc: parent?.[cfg.parentDocCol] ?? null,
        email: emailMap.get(u.user_id) ?? null,
        active: u.active,
        hospital_ids: new Set(links.map((l) => l.hospital_id)),
        primary_hospital_id: links.find((l) => l.is_primary)?.hospital_id ?? null,
      };
    });
    built.sort((a, b) => a.parent_name.localeCompare(b.parent_name));
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.parent_name.toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q) ||
      (r.parent_doc ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder={`Buscar por ${cfg.label.toLowerCase()}, email ou documento…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />
        <Badge variant="secondary">{filtered.length} usuários</Badge>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum usuário de portal {cfg.label.toLowerCase()} encontrado.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => {
            const Icon = cfg.icon;
            return (
              <Card key={row.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-muted p-2"><Icon className="h-4 w-4" /></div>
                      <div>
                        <CardTitle className="text-base">{row.parent_name}</CardTitle>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {row.parent_doc && <span>{row.parent_doc}</span>}
                          {row.email && <span>{row.email}</span>}
                        </div>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => save(row)} disabled={savingId === row.id}>
                      <Save className="mr-2 h-4 w-4" />
                      {savingId === row.id ? "Salvando…" : "Salvar"}
                    </Button>
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
                          className={`flex items-center justify-between rounded-md border p-2 text-sm ${
                            checked ? "border-primary/40 bg-primary/5" : ""
                          }`}
                        >
                          <label className="flex items-center gap-2 cursor-pointer flex-1">
                            <Checkbox
                              checked={checked}
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
                            >
                              <Star
                                className={`h-4 w-4 ${
                                  isPrimary ? "fill-amber-400 text-amber-500" : "text-muted-foreground"
                                }`}
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
        title="Usuários dos Portais"
        description="Defina em quais hospitais cada usuário externo (empresa ou médico) pode operar. Cada hospital é uma visão isolada — sem mistura."
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
