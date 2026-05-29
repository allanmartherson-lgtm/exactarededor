import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ListChecksIcon } from "@/config/icons/navIcons";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Pendencia = {
  id: string;
  company_id: string;
  created_by_name: string;
  patient_name: string;
  event_date: string;
  event_type: "cirurgia" | "parecer" | "atendimento" | "outro";
  attendance_number: string | null;
  agreement_name: string;
  doctor_name: string;
  subject: string;
  description: string;
  status:
    | "aberta"
    | "em_analise"
    | "respondida"
    | "resolvida"
    | "cancelada";
  priority: "baixa" | "normal" | "alta";
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
  const [items, setItems] = useState<Pendencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("pendencias" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setItems([]);
      } else {
        setItems((data ?? []) as unknown as Pendencia[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (statusFilter !== "todas" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.subject.toLowerCase().includes(q) ||
        p.patient_name.toLowerCase().includes(q) ||
        p.doctor_name.toLowerCase().includes(q) ||
        p.agreement_name.toLowerCase().includes(q) ||
        (p.attendance_number?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, statusFilter, search]);

  const counts = useMemo(() => {
    const c = { aberta: 0, em_analise: 0, respondida: 0, resolvida: 0, cancelada: 0 };
    items.forEach((p) => {
      c[p.status] = (c[p.status] ?? 0) + 1;
    });
    return c;
  }, [items]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pendências"
        icon={ListChecksIcon as never}
        showBack={false}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(["aberta", "em_analise", "respondida", "resolvida", "cancelada"] as const).map(
          (s) => (
            <div
              key={s}
              className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col gap-0.5"
            >
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {STATUS_LABEL[s]}
              </span>
              <span className="text-xl font-semibold text-foreground">
                {counts[s] ?? 0}
              </span>
            </div>
          ),
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <Input
          placeholder="Buscar por assunto, paciente, médico, convênio…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-md"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos os status</SelectItem>
            <SelectItem value="aberta">Aberta</SelectItem>
            <SelectItem value="em_analise">Em análise</SelectItem>
            <SelectItem value="respondida">Respondida</SelectItem>
            <SelectItem value="resolvida">Resolvida</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aberta em</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Médico</TableHead>
              <TableHead>Convênio</TableHead>
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
                <TableRow key={p.id}>
                  <TableCell className="text-[12.5px] text-muted-foreground whitespace-nowrap">
                    {format(new Date(p.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    <div className="flex flex-col">
                      <span>{p.subject}</span>
                      <span className="text-[11px] text-muted-foreground">
                        por {p.created_by_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{p.patient_name}</TableCell>
                  <TableCell>{p.doctor_name}</TableCell>
                  <TableCell>{p.agreement_name}</TableCell>
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
    </div>
  );
}
