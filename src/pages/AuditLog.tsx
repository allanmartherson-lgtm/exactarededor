import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/status";
import { formatCNPJ, isValidCNPJ, onlyDigits } from "@/lib/cnpj";
import { ChevronDown, ChevronRight, Search, X, History, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRoleVisual } from "@/lib/observations";

type Entry = {
  id: string;
  entity_type: "rule" | "payment" | string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  company_id: string | null;
  company_name: string | null;
  company_document: string | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  created_at: string;
};

type Profile = { id: string; email: string; full_name: string | null };
type RoleRow = { user_id: string; role: AppRole };

const ENTITY_LABELS: Record<string, string> = {
  rule: "Regra",
  payment: "Pagamento",
};
const ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Alteração",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

const stringify = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

const AuditLog = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [rolesByUser, setRolesByUser] = useState<Map<string, AppRole[]>>(new Map());
  const [ruleNames, setRuleNames] = useState<Map<string, string>>(new Map());
  const [paymentRefs, setPaymentRefs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  // filtros
  const [filterEntity, setFilterEntity] = useState<"todos" | "rule" | "payment">("todos");
  const [filterAction, setFilterAction] = useState<"todos" | "create" | "update">("todos");
  const [filterRole, setFilterRole] = useState<"todos" | AppRole>("todos");
  const [filterCompany, setFilterCompany] = useState<CompanyOption | null>(null);
  const [filterText, setFilterText] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    document.title = "Auditoria | MedPay";
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      const list = (data ?? []) as Entry[];
      setEntries(list);

      const actorIds = Array.from(new Set(list.map((e) => e.actor_id).filter(Boolean) as string[]));
      const ruleIds = Array.from(new Set(list.filter((e) => e.entity_type === "rule").map((e) => e.entity_id)));
      const paymentIds = Array.from(new Set(list.filter((e) => e.entity_type === "payment").map((e) => e.entity_id)));

      const [pr, rr, ru, pa] = await Promise.all([
        actorIds.length
          ? supabase.from("profiles").select("id,email,full_name").in("id", actorIds)
          : Promise.resolve({ data: [] as Profile[] } as any),
        actorIds.length
          ? supabase.from("user_roles").select("user_id,role").in("user_id", actorIds)
          : Promise.resolve({ data: [] as RoleRow[] } as any),
        ruleIds.length
          ? supabase.from("rules").select("id,name").in("id", ruleIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] } as any),
        paymentIds.length
          ? supabase.from("payments").select("id,reference").in("id", paymentIds)
          : Promise.resolve({ data: [] as { id: string; reference: string }[] } as any),
      ]);
      const pmap = new Map<string, Profile>();
      ((pr as any).data ?? []).forEach((p: Profile) => pmap.set(p.id, p));
      setProfiles(pmap);
      const rmap = new Map<string, AppRole[]>();
      ((rr as any).data ?? []).forEach((r: RoleRow) => {
        const arr = rmap.get(r.user_id) ?? [];
        arr.push(r.role);
        rmap.set(r.user_id, arr);
      });
      setRolesByUser(rmap);
      const rnMap = new Map<string, string>();
      ((ru as any).data ?? []).forEach((r: any) => rnMap.set(r.id, r.name));
      setRuleNames(rnMap);
      const prefMap = new Map<string, string>();
      ((pa as any).data ?? []).forEach((p: any) => prefMap.set(p.id, p.reference));
      setPaymentRefs(prefMap);
      setLoading(false);
    })();
  }, []);

  const actorMeta = (actorId: string | null) => {
    if (!actorId) return { label: "Sistema / IA", role: "ia" as const, isSystem: true };
    const p = profiles.get(actorId);
    const userRoles = rolesByUser.get(actorId) ?? [];
    const primary = (["admin", "diretor", "validador", "analista"] as AppRole[]).find((r) => userRoles.includes(r));
    return {
      label: p?.full_name || p?.email || actorId.slice(0, 8),
      email: p?.email,
      role: primary,
      isSystem: false,
    };
  };

  const filtered = useMemo(() => {
    const companyDigits = filterCompany?.document ? onlyDigits(filterCompany.document) : null;
    const term = filterText.trim().toLowerCase();
    return entries.filter((e) => {
      if (filterEntity !== "todos" && e.entity_type !== filterEntity) return false;
      if (filterAction !== "todos" && e.action !== filterAction) return false;
      if (filterRole !== "todos") {
        const m = actorMeta(e.actor_id);
        if (m.role !== filterRole) return false;
      }
      if (filterCompany) {
        const linked = e.company_id === filterCompany.id;
        const byCnpj = !linked && companyDigits && e.company_document && onlyDigits(e.company_document) === companyDigits;
        if (!linked && !byCnpj) return false;
      }
      if (term) {
        const name =
          (e.entity_type === "rule" ? ruleNames.get(e.entity_id) : paymentRefs.get(e.entity_id)) ?? "";
        const m = actorMeta(e.actor_id);
        const haystack = `${e.company_name ?? ""} ${e.company_document ?? ""} ${name} ${m.label} ${m.email ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, profiles, rolesByUser, ruleNames, paymentRefs, filterEntity, filterAction, filterRole, filterCompany, filterText]);

  const clearFilters = () => {
    setFilterEntity("todos");
    setFilterAction("todos");
    setFilterRole("todos");
    setFilterCompany(null);
    setFilterText("");
  };

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Histórico de criações e alterações em regras e pagamentos, com ator, papel e empresa envolvida."
      />
      <div className="p-8 space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <Select value={filterEntity} onValueChange={(v) => setFilterEntity(v as any)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as entidades</SelectItem>
                <SelectItem value="rule">Regras</SelectItem>
                <SelectItem value="payment">Pagamentos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterAction} onValueChange={(v) => setFilterAction(v as any)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as ações</SelectItem>
                <SelectItem value="create">Criação</SelectItem>
                <SelectItem value="update">Alteração</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRole} onValueChange={(v) => setFilterRole(v as any)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os papéis</SelectItem>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="diretor">Diretor</SelectItem>
                <SelectItem value="validador">Validador</SelectItem>
                <SelectItem value="analista">Analista</SelectItem>
              </SelectContent>
            </Select>
            <CompanyCombobox
              value={filterCompany}
              onChange={setFilterCompany}
              placeholder="Filtrar por empresa (CNPJ)…"
              className="min-w-[260px] h-9"
            />
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Buscar nome, ator…"
                className="pl-9 w-[240px]"
              />
            </div>
            {(filterEntity !== "todos" || filterAction !== "todos" || filterRole !== "todos" || filterCompany || filterText) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" /> Limpar filtros
              </Button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              {filtered.length} de {entries.length} eventos
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Carregando histórico…</div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <History className="h-6 w-6 opacity-50" />
                Nenhum evento de auditoria encontrado.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((e) => {
                  const open = !!expanded[e.id];
                  const actor = actorMeta(e.actor_id);
                  const entityLabel =
                    (e.entity_type === "rule" ? ruleNames.get(e.entity_id) : paymentRefs.get(e.entity_id)) ??
                    `${ENTITY_LABELS[e.entity_type] ?? e.entity_type} ${e.entity_id.slice(0, 8)}`;
                  const cnpjDigits = e.company_document ? onlyDigits(e.company_document) : "";
                  const cnpjValid = cnpjDigits ? isValidCNPJ(cnpjDigits) : null;
                  const diffEntries = e.diff ? Object.entries(e.diff) : [];
                  return (
                    <div key={e.id} className="px-6 py-4">
                      <button
                        type="button"
                        className="w-full flex items-start gap-3 text-left"
                        onClick={() => setExpanded((p) => ({ ...p, [e.id]: !p[e.id] }))}
                      >
                        <div className="pt-1">
                          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{ENTITY_LABELS[e.entity_type] ?? e.entity_type}</Badge>
                            <Badge variant={e.action === "create" ? "default" : "secondary"}>
                              {ACTION_LABELS[e.action] ?? e.action}
                            </Badge>
                            <span className="font-medium text-sm truncate">{entityLabel}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              {actor.isSystem ? (
                                <Badge variant="outline" className="font-normal">IA / Sistema</Badge>
                              ) : (
                                <>
                                  <span className="text-foreground">{actor.label}</span>
                                  {actor.role && (
                                    <Badge variant="outline" className="font-normal">{ROLE_LABELS[actor.role]}</Badge>
                                  )}
                                </>
                              )}
                            </span>
                            {e.company_name && (
                              <span className="flex items-center gap-1.5">
                                <span>·</span>
                                <span>{e.company_name}</span>
                                {cnpjDigits && (
                                  <>
                                    <span className="font-mono">{formatCNPJ(cnpjDigits)}</span>
                                    {cnpjValid === true && (
                                      <span title="CNPJ válido" className="inline-flex items-center text-emerald-600">
                                        <ShieldCheck className="h-3.5 w-3.5" />
                                      </span>
                                    )}
                                    {cnpjValid === false && (
                                      <span title="CNPJ inválido" className="inline-flex items-center text-destructive">
                                        <ShieldAlert className="h-3.5 w-3.5" />
                                      </span>
                                    )}
                                  </>
                                )}
                              </span>
                            )}
                            <span>· {fmtDate(e.created_at)}</span>
                            {diffEntries.length > 0 && (
                              <span>· {diffEntries.length} {diffEntries.length === 1 ? "campo" : "campos"} alterado(s)</span>
                            )}
                          </div>
                        </div>
                      </button>
                      {open && (
                        <div className="mt-3 ml-7 rounded-md border border-border bg-muted/40 p-3">
                          {diffEntries.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhuma alteração detalhada registrada.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="text-left text-muted-foreground">
                                  <tr>
                                    <th className="py-1 pr-3 font-medium">Campo</th>
                                    <th className="py-1 pr-3 font-medium">Antes</th>
                                    <th className="py-1 font-medium">Depois</th>
                                  </tr>
                                </thead>
                                <tbody className="align-top">
                                  {diffEntries.map(([field, change]) => (
                                    <tr key={field} className="border-t border-border/60">
                                      <td className="py-1.5 pr-3 font-mono text-foreground">{field}</td>
                                      <td className="py-1.5 pr-3 text-muted-foreground">
                                        <pre className={cn("whitespace-pre-wrap break-all max-w-[28rem]")}>{stringify(change.before)}</pre>
                                      </td>
                                      <td className="py-1.5">
                                        <pre className={cn("whitespace-pre-wrap break-all max-w-[28rem] text-foreground")}>{stringify(change.after)}</pre>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default AuditLog;