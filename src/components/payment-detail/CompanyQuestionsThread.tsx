import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageCircle } from "lucide-react";
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
}

export function CompanyQuestionsThread({ paymentId, companyGroupId, isAnalista: isAnalistaProp }: Props) {
  const { user, roles } = useAuth();
  const isAnalista = isAnalistaProp ?? (roles.includes("analista") || roles.includes("admin"));
  const [items, setItems] = useState<QuestionRow[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authorName, setAuthorName] = useState<string>("");

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

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4" /> Questionamentos
          <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem questionamentos ainda.</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {items.map((q) => (
              <div key={q.id} className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-[10px]">
                    {q.author_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{q.author_name}</span>
                    <span className="text-[10px] text-muted-foreground">{formatDate(q.created_at)}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">{q.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 pt-2 border-t">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Escreva uma resposta..."
            rows={3}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={busy || reply.trim().length === 0}>
              Responder
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
