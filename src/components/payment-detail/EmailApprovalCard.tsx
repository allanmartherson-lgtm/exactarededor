// Card de aprovação por e-mail (modo paralelo ao botão "Aprovar" do diretor).
// Permite ao analista anexar PDF/print da aprovação recebida por e-mail, a IA lê,
// cruza com hospital_directors e — se validado — aplica via apply-email-approval.
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "sonner";
import {
  Mail, Upload, Loader2, CheckCircle2, AlertTriangle, FileText, Trash2, RefreshCw, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Approval = {
  id: string;
  payment_id: string;
  status: "pending_parse" | "parsing" | "validated" | "divergent" | "parse_failed" | "applied" | "rejected";
  file_name: string;
  file_mime: string;
  file_path: string;
  validation_errors: string[];
  extracted: {
    approver_name?: string | null;
    approver_email?: string | null;
    approved_at_text?: string | null;
    approved_at_iso?: string | null;
    approval_phrase?: string | null;
    confidence?: number | null;
  } | null;
  matched_director_id: string | null;
  uploaded_at: string;
  applied_at: string | null;
};

const statusMeta: Record<Approval["status"], { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  pending_parse: { label: "Enviando para leitura…", tone: "bg-muted text-muted-foreground", icon: Loader2 },
  parsing:       { label: "Lendo aprovação…",       tone: "bg-blue-100 text-blue-800",      icon: Loader2 },
  validated:     { label: "Validada — pronta para aplicar", tone: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  divergent:     { label: "Divergente — revise",    tone: "bg-amber-100 text-amber-900",    icon: AlertTriangle },
  parse_failed:  { label: "Falha na leitura",       tone: "bg-red-100 text-red-800",        icon: AlertTriangle },
  applied:       { label: "Aplicada ao lote",       tone: "bg-emerald-600 text-white",      icon: ShieldCheck },
  rejected:      { label: "Descartada",             tone: "bg-muted text-muted-foreground", icon: Trash2 },
};

interface Props {
  paymentId: string;
  hasGroupsAwaitingApproval: boolean;
  onApplied?: () => void;
}

export function EmailApprovalCard({ paymentId, hasGroupsAwaitingApproval, onApplied }: Props) {
  const { user } = useAuth();
  const { hospital } = useHospital();
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase
      .from("payment_email_approvals")
      .select("*")
      .eq("payment_id", paymentId)
      .order("uploaded_at", { ascending: false });
    setItems((data as Approval[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [paymentId]);

  // Realtime simples via refetch a cada 4s enquanto houver item em parsing
  useEffect(() => {
    const stillParsing = items.some((i) => i.status === "pending_parse" || i.status === "parsing");
    if (!stillParsing) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [items]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user || !hospital) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo maior que 20 MB. Compacte antes de anexar.");
      return;
    }
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("Envie PDF, PNG, JPG ou WebP.");
      return;
    }

    setBusy("upload");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${hospital.id}/${paymentId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("payment-email-approvals").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (up.error) throw up.error;

      const { data: created, error: insErr } = await supabase
        .from("payment_email_approvals")
        .insert({
          payment_id: paymentId,
          hospital_id: hospital.id,
          file_path: path,
          file_name: file.name,
          file_mime: file.type,
          file_size_bytes: file.size,
          uploaded_by: user.id,
          status: "pending_parse",
        })
        .select("id")
        .single();
      if (insErr || !created) throw insErr ?? new Error("insert_failed");

      toast.success("Arquivo enviado. A IA está lendo…");
      void load();

      const { error: fnErr } = await supabase.functions.invoke("parse-email-approval", {
        body: { approval_id: created.id },
      });
      if (fnErr) toast.error("Falha na leitura: " + fnErr.message);
      void load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Falha no upload: " + msg);
    } finally {
      setBusy(null);
    }
  };

  const reparse = async (a: Approval) => {
    setBusy(a.id);
    const { error } = await supabase.functions.invoke("parse-email-approval", {
      body: { approval_id: a.id },
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Leitura refeita");
    void load();
  };

  const apply = async (a: Approval) => {
    if (!hasGroupsAwaitingApproval) {
      toast.error("Não há empresas aguardando aprovação neste lote.");
      return;
    }
    const ok = await confirmDialog({
      title: "Aplicar aprovação por e-mail?",
      description: `O lote será aprovado em nome de ${a.extracted?.approver_name ?? "diretor identificado"}.`,
      details:
        "• A aprovação por e-mail tem o mesmo efeito do botão de aprovar no sistema.\n" +
        "• A origem fica registrada no audit (aprovação por e-mail + diretor cadastrado).\n" +
        "• O arquivo anexado permanece guardado como prova.",
      confirmText: "Aplicar aprovação",
      tone: "warning",
    });
    if (!ok) return;
    setBusy(a.id);
    const { error } = await supabase.functions.invoke("apply-email-approval", {
      body: { approval_id: a.id },
    });
    setBusy(null);
    if (error) { toast.error("Falha ao aplicar: " + error.message); return; }
    toast.success("Aprovação aplicada");
    onApplied?.();
    void load();
  };

  const reject = async (a: Approval) => {
    const ok = await confirmDialog({
      title: "Descartar este anexo?",
      description: "O arquivo continua guardado para auditoria, mas não poderá mais ser aplicado.",
      confirmText: "Descartar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(a.id);
    const { error } = await supabase
      .from("payment_email_approvals")
      .update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: user!.id })
      .eq("id", a.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const openFile = async (a: Approval) => {
    const { data, error } = await supabase.storage
      .from("payment-email-approvals")
      .createSignedUrl(a.file_path, 60);
    if (error || !data) { toast.error("Falha ao abrir arquivo"); return; }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> Aprovação por e-mail
            <Badge variant="outline" className="text-[10px]">modo paralelo</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={onFile} />
            <Button size="sm" onClick={onPick} disabled={busy === "upload"}>
              {busy === "upload" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Anexar prova
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Anexe o PDF ou print do e-mail de aprovação. A IA identifica quem aprovou, cruza com os diretores cadastrados
          e — se bater — aplica a aprovação igual ao botão do sistema.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando…
          </div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma aprovação por e-mail anexada ainda.
          </div>
        ) : (
          items.map((a) => {
            const meta = statusMeta[a.status];
            const Icon = meta.icon;
            const spinning = a.status === "pending_parse" || a.status === "parsing";
            return (
              <div key={a.id} className="rounded-md border p-3 space-y-2 bg-card">
                <div className="flex items-start gap-3 flex-wrap">
                  <button onClick={() => openFile(a)} className="flex items-center gap-2 text-sm font-medium hover:underline">
                    <FileText className="h-4 w-4" /> {a.file_name}
                  </button>
                  <Badge className={cn("ml-auto gap-1", meta.tone)}>
                    <Icon className={cn("h-3 w-3", spinning && "animate-spin")} />
                    {meta.label}
                  </Badge>
                </div>
                {a.extracted && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Aprovador: </span><strong>{a.extracted.approver_name ?? "—"}</strong></div>
                    <div><span className="text-muted-foreground">E-mail: </span>{a.extracted.approver_email ?? "—"}</div>
                    <div><span className="text-muted-foreground">Data: </span>{a.extracted.approved_at_text ?? "—"}</div>
                    <div><span className="text-muted-foreground">Frase: </span><em>"{a.extracted.approval_phrase ?? "—"}"</em></div>
                    {a.matched_director_id && (
                      <div className="sm:col-span-2 text-emerald-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Cruzou com diretor cadastrado.
                      </div>
                    )}
                  </div>
                )}
                {a.validation_errors.length > 0 && (
                  <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 space-y-1 list-disc list-inside">
                    {a.validation_errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
                {a.status !== "applied" && a.status !== "rejected" && (
                  <div className="flex items-center gap-2 pt-1">
                    {a.status === "validated" && (
                      <Button size="sm" onClick={() => apply(a)} disabled={busy === a.id || !hasGroupsAwaitingApproval}>
                        {busy === a.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        Aplicar aprovação
                      </Button>
                    )}
                    {(a.status === "divergent" || a.status === "parse_failed") && (
                      <Button size="sm" variant="outline" onClick={() => reparse(a)} disabled={busy === a.id}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", busy === a.id && "animate-spin")} />
                        Tentar ler de novo
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => reject(a)} disabled={busy === a.id} className="text-destructive">
                      <Trash2 className="h-4 w-4 mr-1" /> Descartar
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
