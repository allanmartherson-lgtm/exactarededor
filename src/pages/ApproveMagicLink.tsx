import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Clock, ShieldAlert, AlertTriangle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

const FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/approve-via-magic-link`;

type GroupDiff = {
  id: string;
  company_name: string | null;
  company_id: string | null;
  approval_version: number;
  reapproval_pending: boolean;
  reapproval_reason: string | null;
  reapproval_trigger_source: string | null;
  bruto_total: number | null;
  liquido_total: number | null;
  last_approved_bruto: number | null;
  last_approved_liquido: number | null;
  last_approved_company_id: string | null;
  last_approved_company_name: string | null;
};

type Preview = {
  preview: true;
  action:
    | "approve"
    | "reject"
    | "return_to_analyst"
    | "return_to_validator"
    | "view"
    | "approve_reapproval"
    | "reject_reapproval";
  payment: { id: string; status: string; competence_month: string; total_amount: number; batch_number?: string };
  issued_to_email: string;
  expires_at: string;
  group_diff?: GroupDiff | null;
};

const ACTION_LABEL: Record<string, { label: string; tone: string; icon: any }> = {
  approve: { label: "Aprovar lote", tone: "text-emerald-600", icon: CheckCircle2 },
  reject: { label: "Rejeitar lote", tone: "text-destructive", icon: XCircle },
  return_to_analyst: { label: "Devolver ao analista", tone: "text-amber-600", icon: Clock },
  return_to_validator: { label: "Devolver ao validador", tone: "text-amber-600", icon: Clock },
  view: { label: "Visualizar lote", tone: "text-muted-foreground", icon: ShieldAlert },
  approve_reapproval: { label: "Re-aprovar grupo", tone: "text-amber-700", icon: AlertTriangle },
  reject_reapproval: { label: "Rejeitar re-aprovação", tone: "text-destructive", icon: XCircle },
};

const TRIGGER_LABEL: Record<string, string> = {
  analyst_edit: "Ajuste do analista",
  invoice_pendency: "Pendência sinalizada pela empresa",
  company_change_source: "Troca de empresa (origem)",
  company_change_destination: "Troca de empresa (destino)",
};

export default function ApproveMagicLink() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { success: boolean; new_status?: string }>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(FUNCTIONS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, confirm: false }),
        });
        const data = await r.json();
        if (!r.ok) setError(data.error ?? "Erro ao validar o link.");
        else setPreview(data);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function confirm() {
    if (!token) return;
    setSubmitting(true);
    try {
      const r = await fetch(FUNCTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, confirm: true, comment }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast({ title: "Erro", description: data.error ?? "Falha ao executar ação.", variant: "destructive" });
      } else {
        setDone({ success: true, new_status: data.new_status });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="container max-w-xl py-16">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="container max-w-xl py-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Link inválido
            </CardTitle>
            <CardDescription>{error ?? "Este link de aprovação não é mais válido."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/")}>Ir para o MedPay</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="container max-w-xl py-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              Ação registrada
            </CardTitle>
            <CardDescription>
              Status atualizado para <strong>{done.new_status}</strong>. Você pode fechar esta janela.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate(`/pagamentos/${preview.payment.id}`)}>Ver lote no MedPay</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const meta = ACTION_LABEL[preview.action];
  const Icon = meta.icon;

  return (
    <div className="container max-w-xl py-16">
      <Card>
        <CardHeader>
          <CardTitle className={`flex items-center gap-2 ${meta.tone}`}>
            <Icon className="h-5 w-5" />
            {meta.label}
          </CardTitle>
          <CardDescription>
            Confirme abaixo para registrar a ação. Esta ação fica auditada com seu IP e dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Lote:</span>
              <span className="font-medium">{preview.payment.batch_number ?? preview.payment.id.slice(0, 8)}</span>
              <span className="text-muted-foreground">Competência:</span>
              <span className="font-medium">{preview.payment.competence_month}</span>
              <span className="text-muted-foreground">Valor total:</span>
              <span className="font-medium">{formatBRL(preview.payment.total_amount)}</span>
              <span className="text-muted-foreground">Status atual:</span>
              <span className="font-medium">{preview.payment.status}</span>
              <span className="text-muted-foreground">Destinatário:</span>
              <span className="font-medium">{preview.issued_to_email}</span>
              <span className="text-muted-foreground">Link válido até:</span>
              <span className="font-medium">{new Date(preview.expires_at).toLocaleString("pt-BR")}</span>
            </div>
          </div>

          {preview.group_diff && (
            <ReapprovalDiffPanel diff={preview.group_diff} />
          )}

          {preview.action !== "view" && preview.action !== "approve" && (
            <Textarea
              placeholder={
                preview.action === "reject_reapproval"
                  ? "Motivo da rejeição (será registrado e visível ao analista)"
                  : "Comentário (opcional)"
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
            />
          )}

          <div className="flex gap-2">
            <Button
              onClick={confirm}
              disabled={
                submitting ||
                (preview.action === "reject_reapproval" && comment.trim().length < 4)
              }
              className={
                preview.action === "reject" || preview.action === "reject_reapproval"
                  ? "bg-destructive hover:bg-destructive/90"
                  : ""
              }
            >
              {submitting ? "Processando..." : `Confirmar ${meta.label.toLowerCase()}`}
            </Button>
            <Button variant="outline" onClick={() => navigate("/")}>Cancelar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReapprovalDiffPanel({ diff }: { diff: GroupDiff }) {
  const beforeBruto = Number(diff.last_approved_bruto ?? 0);
  const afterBruto = Number(diff.bruto_total ?? 0);
  const beforeLiq = Number(diff.last_approved_liquido ?? 0);
  const afterLiq = Number(diff.liquido_total ?? 0);
  const deltaBruto = afterBruto - beforeBruto;
  const deltaLiq = afterLiq - beforeLiq;
  const companyChanged =
    !!diff.last_approved_company_id && diff.last_approved_company_id !== diff.company_id;

  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-700">Re-aprovação pendente</div>
            <div className="text-xs text-muted-foreground">
              {TRIGGER_LABEL[diff.reapproval_trigger_source ?? ""] ?? "Alteração após aprovação"}
              {diff.reapproval_reason ? ` — ${diff.reapproval_reason}` : ""}
            </div>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          v{diff.approval_version} → v{diff.approval_version + 1}
        </Badge>
      </div>

      {companyChanged && (
        <div className="flex items-center gap-2 text-xs rounded-md border border-amber-500/30 bg-background px-3 py-2">
          <span className="text-muted-foreground">PJ:</span>
          <span className="font-medium line-through text-muted-foreground">
            {diff.last_approved_company_name ?? "—"}
          </span>
          <ArrowRight className="h-3 w-3 text-amber-600" />
          <span className="font-semibold">{diff.company_name ?? "—"}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div />
        <div className="text-muted-foreground uppercase tracking-wide">Antes</div>
        <div className="text-muted-foreground uppercase tracking-wide">Depois</div>

        <div className="text-muted-foreground">Bruto</div>
        <div className="font-mono">{formatBRL(beforeBruto)}</div>
        <div className="font-mono font-semibold">{formatBRL(afterBruto)}</div>

        <div className="text-muted-foreground">Líquido</div>
        <div className="font-mono">{formatBRL(beforeLiq)}</div>
        <div className="font-mono font-semibold">{formatBRL(afterLiq)}</div>

        <div className="text-muted-foreground border-t border-amber-500/20 pt-2">Δ Bruto</div>
        <div
          className={`col-span-2 font-mono font-semibold border-t border-amber-500/20 pt-2 ${
            deltaBruto >= 0 ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          {deltaBruto >= 0 ? "+" : ""}
          {formatBRL(deltaBruto)}
          <span className="ml-2 text-muted-foreground font-normal">
            (líquido: {deltaLiq >= 0 ? "+" : ""}
            {formatBRL(deltaLiq)})
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Apenas este grupo retorna para aprovação. Outros grupos do lote seguem inalterados.
        Avanço para NF, lançamento e pagamento bloqueado até decisão.
      </p>
    </div>
  );
}

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);
}
