/**
 * Aba "Internas" da página /conversas.
 *
 * Lista threads de `payment_questions` (chat interno analista ↔ validador ↔ diretor)
 * agrupadas por lote. Clique navega para /pagamentos/{id}?conversas=1 que abre
 * automaticamente o ConversationsSheet do detalhe do lote.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Inbox, FileText, MessageSquare } from "lucide-react";

type QRow = {
  id: string;
  payment_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  message: string;
  status: "pendente" | "respondida" | "encerrada";
  created_at: string;
};

type PaymentInfo = {
  id: string;
  reference: string | null;
  competence_month: string | null;
  status: string | null;
};

type ThreadGroup = {
  paymentId: string;
  paymentLabel: string;
  paymentStatus: string | null;
  totalMessages: number;
  unread: number;
  lastAt: string;
  lastPreview: string;
  lastAuthor: string;
  status: QRow["status"];
};

export function ConversasInternasTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<QRow[]>([]);
  const [reads, setReads] = useState<Set<string>>(new Set());
  const [payments, setPayments] = useState<Record<string, PaymentInfo>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: msgs } = await supabase
      .from("payment_questions")
      .select("id,payment_id,parent_id,author_id,author_name,message,status,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    const list = (msgs ?? []) as QRow[];
    setRows(list);

    const paymentIds = Array.from(new Set(list.map((m) => m.payment_id)));
    if (paymentIds.length) {
      const { data: ps } = await supabase
        .from("payments")
        .select("id,reference,competence_month,status")
        .in("id", paymentIds);
      const map: Record<string, PaymentInfo> = {};
      (ps ?? []).forEach((p: PaymentInfo) => {
        map[p.id] = p;
      });
      setPayments(map);
    }

    const msgIds = list.map((m) => m.id);
    if (msgIds.length) {
      const { data: rds } = await supabase
        .from("payment_question_reads" as never)
        .select("message_id")
        .eq("user_id", user.id)
        .in("message_id", msgIds);
      setReads(new Set(((rds ?? []) as Array<{ message_id: string }>).map((r) => r.message_id)));
    } else {
      setReads(new Set());
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("conversas-internas")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_questions" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_question_reads" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const groups = useMemo<ThreadGroup[]>(() => {
    if (!user) return [];
    const byPayment = new Map<string, QRow[]>();
    rows.forEach((r) => {
      const arr = byPayment.get(r.payment_id) ?? [];
      arr.push(r);
      byPayment.set(r.payment_id, arr);
    });
    const out: ThreadGroup[] = [];
    byPayment.forEach((msgs, paymentId) => {
      const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const last = sorted[sorted.length - 1];
      const unread = msgs.filter((m) => m.author_id !== user.id && !reads.has(m.id)).length;
      const root = sorted.find((m) => !m.parent_id) ?? sorted[0];
      const p = payments[paymentId];
      const label = p?.reference || p?.competence_month || paymentId.slice(0, 8);
      out.push({
        paymentId,
        paymentLabel: label,
        paymentStatus: p?.status ?? null,
        totalMessages: msgs.length,
        unread,
        lastAt: last.created_at,
        lastPreview: last.message,
        lastAuthor: last.author_name,
        status: root.status,
      });
    });
    out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return out;
  }, [rows, reads, payments, user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.paymentLabel.toLowerCase().includes(q) ||
        g.lastPreview.toLowerCase().includes(q) ||
        g.lastAuthor.toLowerCase().includes(q),
    );
  }, [groups, search]);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <Input
        placeholder="Buscar lote, mensagem, autor…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="md:max-w-sm"
      />

      <div className="border border-border rounded-lg bg-card overflow-y-auto min-h-0 flex-1">
        {loading && (
          <div className="p-3 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Inbox className="h-6 w-6 opacity-60" />
            Nenhuma conversa interna.
          </div>
        )}
        {!loading &&
          filtered.map((g) => (
            <button
              key={g.paymentId}
              type="button"
              onClick={() => navigate(`/pagamentos/${g.paymentId}?conversas=1`)}
              className={cn(
                "w-full text-left px-3 py-3 border-b border-border/60 last:border-b-0 transition-colors flex flex-col gap-1 hover:bg-muted/50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground min-w-0">
                  <FileText className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">Lote {g.paymentLabel}</span>
                </span>
                <span className="text-[10.5px] text-muted-foreground flex-shrink-0">
                  {format(new Date(g.lastAt), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-[13px] truncate flex items-center gap-1.5",
                    g.unread > 0 ? "font-semibold text-foreground" : "text-foreground",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  {g.lastAuthor}
                </span>
                {g.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center px-1">
                    {g.unread > 9 ? "9+" : g.unread}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-muted-foreground truncate flex-1">
                  {g.lastPreview}
                </span>
                <Badge
                  variant={g.status === "encerrada" ? "muted" : g.status === "respondida" ? "success" : "warning"}
                  className="text-[10px] py-0 px-1.5 h-4"
                >
                  {g.status === "encerrada" ? "Encerrada" : g.status === "respondida" ? "Respondida" : "Pendente"}
                </Badge>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
