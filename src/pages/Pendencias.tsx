import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { ListChecksIcon } from "@/config/icons/navIcons";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RetroactiveReconciliationsTab from "@/components/retroactive/RetroactiveReconciliationsTab";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Pendencia = {
  id: string;
  company_id: string;
  created_by_user_id: string | null;
  created_by_name: string;
  patient_name: string;
  event_date: string;
  event_type: "cirurgia" | "parecer" | "atendimento" | "outro";
  attendance_number: string | null;
  agreement_name: string;
  doctor_name: string;
  subject: string;
  description: string;
  status: "aberta" | "em_analise" | "respondida" | "resolvida" | "cancelada";
  priority: "baixa" | "normal" | "alta";
  assigned_to: string | null;
  payment_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

const STATUS_LABEL: Record<Pendencia["status"], string> = {
  aberta: "Aberta",
  em_analise: "Em análise",
  respondida: "Respondida",
  resolvida: "Resolvida",
  cancelada: "Cancelada",
};

const STATUS_VARIANT: Record<
  Pendencia["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  aberta: "default",
  em_analise: "secondary",
  respondida: "outline",
  resolvida: "outline",
  cancelada: "destructive",
};

const PRIORITY_COLOR: Record<Pendencia["priority"], string> = {
  baixa: "text-muted-foreground",
  normal: "text-foreground",
  alta: "text-destructive font-medium",
};

const EVENT_LABEL: Record<Pendencia["event_type"], string> = {
  cirurgia: "Cirurgia",
  parecer: "Parecer",
  atendimento: "Atendimento",
  outro: "Outro",
};

export default function Pendencias() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Pendencia[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("abertas");
  const [priorityFilter, setPriorityFilter] = useState<string>("todas");
  const [companyFilter, setCompanyFilter] = useState<string>("todas");
  const [mineOnly, setMineOnly] = useState<boolean>(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("pendencias" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setError(error.message);
      setItems([]);
    } else {
      const list = (data ?? []) as unknown as Pendencia[];
      setItems(list);
      const ids = Array.from(new Set(list.map((p) => p.company_id)));
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
      // Resolve nomes reais a partir de profiles (analista/empresa) quando created_by_user_id existe.
      const userIds = Array.from(
        new Set(list.map((p) => p.created_by_user_id).filter((x): x is string => !!x)),
      );
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        const pmap: Record<string, string> = {};
        (profs ?? []).forEach((r: { id: string; full_name: string | null }) => {
          if (r.full_name) pmap[r.id] = r.full_name;
        });
        setProfileNames(pmap);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("pendencias-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pendencias" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (statusFilter === "abertas") {
        if (p.status === "resolvida" || p.status === "cancelada") return false;
      } else if (statusFilter !== "todas" && p.status !== statusFilter) {
        return false;
      }
      if (priorityFilter !== "todas" && p.priority !== priorityFilter) return false;
      if (companyFilter !== "todas" && p.company_id !== companyFilter) return false;
      if (mineOnly && p.assigned_to !== user?.id) return false;
      if (!q) return true;
      return (
        p.subject.toLowerCase().includes(q) ||
        p.patient_name.toLowerCase().includes(q) ||
        p.doctor_name.toLowerCase().includes(q) ||
        p.agreement_name.toLowerCase().includes(q) ||
        (p.attendance_number?.toLowerCase().includes(q) ?? false) ||
        (companies[p.company_id] ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, statusFilter, priorityFilter, companyFilter, mineOnly, search, user?.id, companies]);

  const counts = useMemo(() => {
    const c = { aberta: 0, em_analise: 0, respondida: 0, resolvida: 0, cancelada: 0 };
    items.forEach((p) => {
      c[p.status] = (c[p.status] ?? 0) + 1;
    });
    return c;
  }, [items]);

  const companyOptions = useMemo(() => {
    const entries = Object.entries(companies);
    entries.sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
    return entries;
  }, [companies]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pendências"
        icon={ListChecksIcon as never}
        showBack={false}
      />

      <PendenciasTabs />

        <TabsContent value="pendencias" className="mt-4 flex flex-col gap-5">



      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(["aberta", "em_analise", "respondida", "resolvida", "cancelada"] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col gap-0.5 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {STATUS_LABEL[s]}
              </span>
              <span className="text-xl font-semibold text-foreground">
                {counts[s] ?? 0}
              </span>
            </button>
          ),
        )}
      </div>

      <div className="flex flex-col md:flex-row md:flex-wrap gap-2 md:items-center">
        <Input
          placeholder="Buscar por assunto, paciente, médico, empresa…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Em aberto</SelectItem>
            <SelectItem value="todas">Todos status</SelectItem>
            <SelectItem value="aberta">Aberta</SelectItem>
            <SelectItem value="em_analise">Em análise</SelectItem>
            <SelectItem value="respondida">Respondida</SelectItem>
            <SelectItem value="resolvida">Resolvida</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="md:w-[140px]">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
          </SelectContent>
        </Select>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="md:w-[200px]">
            <SelectValue placeholder="Empresa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas empresas</SelectItem>
            {companyOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={mineOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setMineOnly((v) => !v)}
        >
          {mineOnly ? "Mostrando minhas" : "Atribuídas a mim"}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aberta em</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Médico</TableHead>
              <TableHead>Evento</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!loading && error && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-destructive py-8">
                  Falha ao carregar pendências: {error}
                </TableCell>
              </TableRow>
            )}

            {!loading && !error && filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-10"
                >
                  Nenhuma pendência encontrada.
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              !error &&
              filtered.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/pendencias/${p.id}`)}
                >
                  <TableCell className="text-[12.5px] text-muted-foreground whitespace-nowrap">
                    {format(new Date(p.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-[12.5px] text-muted-foreground">
                    {companies[p.company_id] ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    <div className="flex flex-col">
                      <span>{p.subject}</span>
                      <span className="text-[11px] text-muted-foreground">
                        por {(p.created_by_user_id && profileNames[p.created_by_user_id]) || p.created_by_name}
                        {p.assigned_to === user?.id && " · você"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{p.patient_name}</TableCell>
                  <TableCell>{p.doctor_name}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{EVENT_LABEL[p.event_type]}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {format(new Date(p.event_date), "dd/MM/yy", { locale: ptBR })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={PRIORITY_COLOR[p.priority]}>
                    {p.priority === "alta"
                      ? "Alta"
                      : p.priority === "baixa"
                        ? "Baixa"
                        : "Normal"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.status]}>
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
        </TabsContent>
        <TabsContent value="retroativa" className="mt-4">
          <RetroactiveReconciliationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

