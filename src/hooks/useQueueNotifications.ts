import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { notificationStore } from "@/lib/notificationStore";

type GroupRow = {
  id: string;
  payment_id: string;
  status: string;
  company_name: string;
};
type PaymentRow = {
  id: string;
  reference: string | null;
  status: string;
};

/**
 * Notificações em tempo real para a fila do analista.
 *
 * Como a fila é coletiva por perfil (qualquer analista assume qualquer lote),
 * todo analista logado escuta os mesmos eventos:
 *
 *  - Lote/empresa entrou na fila do analista
 *      (status novo ∈ {revisao_analista, devolvido_analista,
 *       em_analise_ia → revisao_analista})
 *  - Lote/empresa foi devolvido pelo validador OU pelo diretor
 *    (sempre devolvido_analista) — destaque porque exige correção
 *
 * Também notifica validadores (entrada em aguardando_validacao) e diretores
 * (entrada em aguardando_aprovacao) para fechar o ciclo do fluxo.
 *
 * Implementação: dois canais postgres_changes em payments e
 * payment_company_groups. Filtragem é client-side por papel/transição — leve
 * porque o evento já vem enriquecido com OLD/NEW (REPLICA IDENTITY FULL).
 */
export function useQueueNotifications() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  // Dedupe: evita disparar a mesma notificação duas vezes (ex.: dois canais
  // entregando o mesmo evento ou refresh agressivo de realtime).
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    const isAnalista = hasRole("analista") || hasRole("admin");
    const isValidador = hasRole("validador") || hasRole("admin");
    const isDiretor = hasRole("diretor") || hasRole("admin");
    if (!isAnalista && !isValidador && !isDiretor) return;

    const fire = (key: string, opts: {
      title: string;
      description?: string;
      kind: "info" | "warning" | "success";
      paymentId: string;
    }) => {
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      // Limpa cache antigo para não crescer indefinidamente.
      if (seenRef.current.size > 200) {
        const arr = Array.from(seenRef.current);
        seenRef.current = new Set(arr.slice(-100));
      }
      const action = {
        label: "Abrir",
        onClick: () => navigate(`/pagamentos/${opts.paymentId}`),
      };
      const payload = { description: opts.description, action };
      if (opts.kind === "warning") toast.warning(opts.title, payload);
      else if (opts.kind === "success") toast.success(opts.title, payload);
      else toast.info(opts.title, payload);
    };

    const handleStatusChange = (
      newStatus: string,
      oldStatus: string | null,
      paymentId: string,
      label: string,
      ownerKey: string,
    ) => {
      if (newStatus === oldStatus) return;
      const baseKey = `${ownerKey}:${oldStatus ?? "null"}->${newStatus}`;

      // Devoluções → analista (alta prioridade, mostra mesmo se não for o autor)
      if (isAnalista && newStatus === "devolvido_analista") {
        fire(baseKey + ":dev-analista", {
          title: "Lote devolvido pelo validador",
          description: `${label} precisa de correção do analista.`,
          kind: "warning",
          paymentId,
        });
        return;
      }
      // Entrou na fila do analista
      if (isAnalista && newStatus === "revisao_analista" && oldStatus !== "revisao_analista") {
        fire(baseKey + ":fila-analista", {
          title: "Novo lote na fila do analista",
          description: `${label} aguardando revisão.`,
          kind: "info",
          paymentId,
        });
        return;
      }
      // Lançado pelo financeiro → analista precisa confirmar e arquivar (Gap 4)
      if (isAnalista && newStatus === "lancado" && oldStatus !== "lancado") {
        fire(baseKey + ":fila-arquivar", {
          title: "Lote pronto para arquivamento",
          description: `${label} lançado no financeiro — confirme para arquivar.`,
          kind: "info",
          paymentId,
        });
        return;
      }

      // Entrou na fila do validador
      if (isValidador && newStatus === "aguardando_validacao" && oldStatus !== "aguardando_validacao") {
        fire(baseKey + ":fila-validador", {
          title: "Novo lote para validar",
          description: `${label} aguardando validação.`,
          kind: "info",
          paymentId,
        });
        return;
      }

      // Entrou na fila do diretor
      if (isDiretor && newStatus === "aguardando_aprovacao" && oldStatus !== "aguardando_aprovacao") {
        fire(baseKey + ":fila-diretor", {
          title: "Novo lote para aprovar",
          description: `${label} aguardando aprovação.`,
          kind: "info",
          paymentId,
        });
      }
    };

    const handleQuestionResolved = async (paymentId: string) => {
      // Busca a referência do lote e verifica se ainda existem outras perguntas abertas
      const [payResp, questResp] = await Promise.all([
        supabase.from("payments").select("reference").eq("id", paymentId).maybeSingle(),
        supabase.from("payment_observations").select("id", { count: "exact", head: true })
          .eq("payment_id", paymentId).eq("is_question", true).is("resolved_at", null)
      ]);

      // Só notifica se for a última do ciclo (nenhuma pergunta aberta sobrando)
      if (questResp.count !== 0) return;

      const p = payResp.data;

      const label = p?.reference ? `Lote ${p.reference}` : "Lote";
      fire(`question-resolved:${paymentId}`, {
        title: "Questionamento resolvido",
        description: `${label} agora pode seguir o fluxo.`,
        kind: "success",
        paymentId,
      });
    };

    const channel = supabase
      .channel(`queue-notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payments" },
        (payload) => {
          const n = payload.new as PaymentRow;
          const o = (payload.old ?? {}) as Partial<PaymentRow>;
          handleStatusChange(
            n.status,
            (o.status as string | undefined) ?? null,
            n.id,
            `Lote ${n.reference ?? n.id.slice(0, 8)}`,
            `payment:${n.id}`,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_company_groups" },
        (payload) => {
          const n = payload.new as GroupRow;
          const o = (payload.old ?? {}) as Partial<GroupRow>;
          handleStatusChange(
            n.status,
            (o.status as string | undefined) ?? null,
            n.payment_id,
            `Empresa ${n.company_name}`,
            `group:${n.id}`,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payment_company_groups" },
        (payload) => {
          const n = payload.new as GroupRow;
          handleStatusChange(n.status, null, n.payment_id, `Empresa ${n.company_name}`, `group:${n.id}:new`);
        },
      )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "payment_observations" },
          (payload) => {
            const n = payload.new as any;
            const o = payload.old as any;
            // Se foi marcada como resolvida agora
            if (n.is_question && n.resolved_at && (!o || !o.resolved_at)) {
              handleQuestionResolved(n.payment_id);
            }
          }
        )
        .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, hasRole, navigate]);
}
