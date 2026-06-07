import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/status";

interface QuestionRow {
  id: string;
  payment_id: string;
  company_group_id: string | null;
  author_id: string;
  author_name: string;
  message: string;
  created_at: string;
}

interface Props {
  paymentId: string;
  companyGroupId: string;
  isAnalista?: boolean;
  /** Etapa em que a thread está sendo aberta — usada para registrar acionamento do supervisor. */
  analysisMode?: "confeccao" | "analise";
  /** Quando true, o componente não renderiza nada se não houver questionamentos. */
  hideIfEmpty?: boolean;
}

const SUPERVISOR_PREFIX_RE = /^\[Supervisor acionado · (Confecção|Análise)\]/;

export function CompanyQuestionsThread({
  paymentId,
  companyGroupId,
  isAnalista: isAnalistaProp,
  analysisMode = "analise",
  hideIfEmpty,
}: Props) {
  const { user, roles } = useAuth();
  const isAnalista = isAnalistaProp ?? (roles.includes("analista") || roles.includes("admin"));
  const canReply =
    roles.includes("analista") ||
    roles.includes("validador") ||
    roles.includes("diretor") ||
    roles.includes("admin");
  const [items, setItems] = useState<QuestionRow[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authorName, setAuthorName] = useState<string>("");

  // Acionar supervisor
  const [supOpen, setSupOpen] = useState(false);
  const [supNote, setSupNote] = useState("");
  const [supBusy, setSupBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("payment_questions")
      .select("*")
      .eq("company_group_id", companyGroupId)
      .order("created_at", { ascending: true });
    setItems((data ?? []) as QuestionRow[]);
    setLoading(false);
  }, [companyGroupId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`cqt-${companyGroupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_questions", filter: `company_group_id=eq.${companyGroupId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [companyGroupId, load]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name,email")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setAuthorName(data?.full_name ?? data?.email ?? user.email ?? "Usuário");
      });
  }, [user]);

  const submit = async () => {
    if (!user) return;
    if (reply.trim().length < 1) return;
    setBusy(true);
    const { error } = await supabase.rpc("reply_question", {
      p_company_group_id: companyGroupId,
      p_author_id: user.id,
      p_author_name: authorName || user.email || "Usuário",
      p_message: reply.trim(),
      p_is_analista: isAnalista,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao enviar", description: error.message, variant: "destructive" });
      return;
    }
    setReply("");
    await load();
  };

  const callSupervisor = async () => {
    if (!user) return;
    setSupBusy(true);
    const { data, error } = await supabase.rpc("call_supervisor", {
      p_payment_id: paymentId,
      p_company_group_id: companyGroupId,
      p_stage: analysisMode,
      p_note: supNote.trim() || null,
    });
    setSupBusy(false);
    if (error) {
      toast({ title: "Falha ao chamar supervisor", description: error.message, variant: "destructive" });
      return;
    }
    const notified = Array.isArray(data) ? (data[0] as { notified_count?: number } | undefined)?.notified_count ?? 0 : 0;
    toast({
      title: "Supervisor acionado",
      description: notified > 0
        ? `${notified} ${notified === 1 ? "supervisor" : "supervisores"} notificado(s) — etapa ${analysisMode === "confeccao" ? "Confecção" : "Análise"}.`
        : "Nenhum supervisor cadastrado para este hospital — chamado registrado mesmo assim.",
    });
    setSupNote("");
    setSupOpen(false);
    await load();
  };

  // Para o analista, não exibe o card quando ainda não há questionamentos —
  // o painel de questionamento é iniciado por validador/diretor.
  if (hideIfEmpty && !loading && items.length === 0) return null;

  return (
    <Card className="shadow-card" data-testid="company-questions-thread">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Questionamentos
            <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
          </CardTitle>
          {canReply && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSupOpen(true)}
              className="h-7 gap-1.5 border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
              data-testid="call-supervisor-btn"
              title="Aciona diretor/admin e registra a etapa atual"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Chamar supervisor
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem questionamentos ainda.</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {items.map((q) => {
              const isSupervisorCall = SUPERVISOR_PREFIX_RE.test(q.message);
              return (
                <div key={q.id} className="flex gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-[10px]">
                      {q.author_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium">{q.author_name}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDate(q.created_at)}</span>
                      {isSupervisorCall && (
                        <Badge variant="warning" className="text-[10px] py-0 h-4">
                          <ShieldAlert className="h-2.5 w-2.5 mr-1" />
                          Supervisor acionado
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{q.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canReply && (
          <div className="space-y-2 pt-2 border-t">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={isAnalista ? "Escreva uma dúvida ou comentário..." : "Escreva uma resposta..."}
              rows={3}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={busy || reply.trim().length === 0}>
                {isAnalista ? "Enviar" : "Responder"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={supOpen} onOpenChange={(v) => !supBusy && setSupOpen(v)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[min(95vw,520px)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Chamar supervisor
            </DialogTitle>
            <DialogDescription>
              Notifica diretor/admin do hospital e registra o chamado na etapa{" "}
              <strong className="text-foreground">
                {analysisMode === "confeccao" ? "Confecção" : "Análise"}
              </strong>
              . A mensagem fica na thread desta empresa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Contexto do chamado (opcional)
            </label>
            <Textarea
              value={supNote}
              onChange={(e) => setSupNote(e.target.value)}
              placeholder="Ex.: regra ambígua para o convênio X — preciso de orientação."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupOpen(false)} disabled={supBusy}>
              Cancelar
            </Button>
            <Button
              onClick={callSupervisor}
              disabled={supBusy}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {supBusy ? "Acionando..." : "Acionar supervisor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
