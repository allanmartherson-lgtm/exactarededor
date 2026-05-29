/**
 * Caixa de conversas do portal parceiro.
 *
 * Duas abas:
 *  - Empresas: lista `company_threads` (comportamento original).
 *  - Médicos: lista mensagens de `doctor_messages` agrupadas por médico.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ChatsIcon } from "@/config/icons/navIcons";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyThreadChat } from "@/components/portal/CompanyThreadChat";
import { ConversasDoctorsTab } from "@/components/portal/ConversasDoctorsTab";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Building2, Inbox } from "lucide-react";

type Thread = {
  id: string;
  company_id: string;
  scope: "geral" | "lote" | "nf" | "pendencia";
  subject: string;
  status: "aberta" | "resolvida";
  last_message_at: string;
  last_message_preview: string | null;
  unread_for_internal: number;
  created_at: string;
};

const SCOPE_LABEL: Record<Thread["scope"], string> = {
  geral: "Geral",
  lote: "Lote",
  nf: "NF",
  pendencia: "Pendência",
};

export default function Conversas() {
  const [tab, setTab] = useState<"empresas" | "medicos">("empresas");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("aberta");
  const [scopeFilter, setScopeFilter] = useState<string>("todos");

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("company_threads" as never)
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(500);
    if (error) {
      setError(error.message);
      setThreads([]);
    } else {
      const list = (data ?? []) as unknown as Thread[];
      setThreads(list);
      const ids = Array.from(new Set(list.map((t) => t.company_id)));
      if (ids.length > 0) {
        const { data: cs } = await supabase
          .from("companies")
          .select("id,name")
          .in("id", ids);
        const map: Record<string, string> = {};
        (cs ?? []).forEach((c: { id: string; name: string }) => {
          map[c.id] = c.name;
        });
        setCompanies(map);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("conversas-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_threads" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (statusFilter !== "todas" && t.status !== statusFilter) return false;
      if (scopeFilter !== "todos" && t.scope !== scopeFilter) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        (companies[t.company_id] ?? "").toLowerCase().includes(q) ||
        (t.last_message_preview ?? "").toLowerCase().includes(q)
      );
    });
  }, [threads, search, statusFilter, scopeFilter, companies]);

  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = filtered.find((t) => t.id === selectedId) ?? null;

  const totalUnread = useMemo(
    () => threads.reduce((s, t) => s + (t.unread_for_internal ?? 0), 0),
    [threads],
  );

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-120px)]">
      <PageHeader
        title="Conversas"
        icon={ChatsIcon as never}
        showBack={false}
        description={`${threads.length} thread(s) · ${totalUnread} não lida(s)`}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "empresas" | "medicos")} className="flex flex-col flex-1 min-h-0">
        <TabsList className="self-start">
          <TabsTrigger value="empresas">Empresas</TabsTrigger>
          <TabsTrigger value="medicos">Médicos</TabsTrigger>
        </TabsList>

        <TabsContent value="empresas" className="flex flex-col gap-3 flex-1 min-h-0 mt-3">
          <div className="flex flex-col md:flex-row gap-2">
            <Input
              placeholder="Buscar empresa, assunto, prévia…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="md:max-w-sm"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos status</SelectItem>
                <SelectItem value="aberta">Abertas</SelectItem>
                <SelectItem value="resolvida">Resolvidas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="md:w-[160px]">
                <SelectValue placeholder="Escopo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos escopos</SelectItem>
                <SelectItem value="geral">Geral</SelectItem>
                <SelectItem value="lote">Lote</SelectItem>
                <SelectItem value="nf">Nota fiscal</SelectItem>
                <SelectItem value="pendencia">Pendência</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-3 flex-1 min-h-0">
            <div className="border border-border rounded-lg bg-card overflow-y-auto min-h-0">
              {loading && (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              )}
              {!loading && error && <p className="p-4 text-sm text-destructive">{error}</p>}
              {!loading && !error && filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                  <Inbox className="h-6 w-6 opacity-60" />
                  Nenhuma conversa.
                </div>
              )}
              {!loading &&
                !error &&
                filtered.map((t) => {
                  const isActive = t.id === selectedId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "w-full text-left px-3 py-3 border-b border-border/60 last:border-b-0 transition-colors flex flex-col gap-1",
                        isActive ? "bg-accent" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground min-w-0">
                          <Building2 className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{companies[t.company_id] ?? "Empresa"}</span>
                        </span>
                        <span className="text-[10.5px] text-muted-foreground flex-shrink-0">
                          {format(new Date(t.last_message_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "text-[13px] truncate",
                            t.unread_for_internal > 0
                              ? "font-semibold text-foreground"
                              : "text-foreground",
                          )}
                        >
                          {t.subject}
                        </span>
                        {t.unread_for_internal > 0 && (
                          <span className="min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center px-1">
                            {t.unread_for_internal > 9 ? "9+" : t.unread_for_internal}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-muted-foreground truncate flex-1">
                          {t.last_message_preview ?? "—"}
                        </span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                          {SCOPE_LABEL[t.scope]}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
            </div>

            <div className="min-h-0 flex flex-col">
              {selected ? (
                <CompanyThreadChat
                  key={selected.id}
                  threadId={selected.id}
                  companyId={selected.company_id}
                  className="flex-1 min-h-0"
                />
              ) : (
                <div className="flex-1 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground">
                  Selecione uma conversa à esquerda.
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="medicos" className="flex flex-col flex-1 min-h-0 mt-3">
          <ConversasDoctorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
