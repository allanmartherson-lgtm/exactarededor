/**
 * Fila de médicos cadastrados em modo provisório pelos analistas durante
 * a importação. Admin/diretor pode:
 *   - Aprovar: tira `pending_admin_review` e desbloqueia o envio para validação.
 *   - Rejeitar: exclui o registro (e seus aliases criados).
 *   - Editar: ajustar nome/CRM antes de aprovar.
 *
 * Enquanto houver médico pendente vinculado a itens de um pagamento, o
 * gate em `PaymentDetail` bloqueia o envio para validação.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Trash2, Loader2, UserCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Pending = {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
  cpf: string | null;
  created_at: string;
  created_by_user_id: string | null;
  pending_review_note: string | null;
};

type AuthorInfo = { full_name: string | null; email: string | null };

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

export function DoctorPendingReviewPanel() {
  const [rows, setRows] = useState<Pending[]>([]);
  const [authors, setAuthors] = useState<Record<string, AuthorInfo>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Pending>>>({});
  const [rejecting, setRejecting] = useState<Pending | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("doctors")
      .select("id, full_name, crm, crm_uf, created_at, created_by_user_id, pending_review_note")
      .eq("pending_admin_review", true)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Erro ao carregar pendências", description: error.message, variant: "destructive" });
      setRows([]);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Pending[];
    // Enriquecer com CPF via RPC restrita a admin/diretor
    if (list.length) {
      try {
        const { data: pii } = await supabase.rpc("get_doctors_pii", { doctor_ids: list.map((r) => r.id) });
        const piiMap = new Map<string, any>((Array.isArray(pii) ? pii : []).map((p: any) => [p.id, p]));
        list.forEach((r) => { (r as any).cpf = piiMap.get(r.id)?.cpf ?? null; });
      } catch { /* usuário sem permissão para PII */ }
    }
    setRows(list);
    const userIds = Array.from(new Set(list.map((r) => r.created_by_user_id).filter(Boolean))) as string[];
    if (userIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      const map: Record<string, AuthorInfo> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = { full_name: p.full_name, email: p.email }; });
      setAuthors(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("doctor-pending-review")
      .on("postgres_changes", { event: "*", schema: "public", table: "doctors", filter: "pending_admin_review=eq.true" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const setEdit = (id: string, patch: Partial<Pending>) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  };

  const approve = async (row: Pending) => {
    setBusyId(row.id);
    try {
      const e = edits[row.id] ?? {};
      const full_name = String(e.full_name ?? row.full_name).trim();
      const crm = String(e.crm ?? row.crm ?? "").replace(/\D/g, "");
      const crm_uf = String(e.crm_uf ?? row.crm_uf ?? "").toUpperCase().trim();
      if (!full_name) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
      if (!crm) { toast({ title: "CRM obrigatório", variant: "destructive" }); return; }
      if (!crm_uf || !UFS.includes(crm_uf)) { toast({ title: "UF do CRM inválida", variant: "destructive" }); return; }
      const { error } = await supabase
        .from("doctors")
        .update({
          full_name,
          crm,
          crm_uf,
          pending_admin_review: false,
          pending_review_note: null,
        } as any)
        .eq("id", row.id);
      if (error) throw error;
      toast({ title: "Cadastro aprovado", description: `${full_name} liberado para uso.` });
      await load();
    } catch (err: any) {
      toast({ title: "Erro ao aprovar", description: err?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      // Soft-delete: trigger no banco bloqueia DELETE físico em doctors para preservar
      // histórico e vínculos. Marcamos active=false e tiramos da fila de pendentes.
      const { error } = await supabase
        .from("doctors")
        .update({
          active: false,
          pending_admin_review: false,
          pending_review_note: `Rejeitado em ${new Date().toLocaleString("pt-BR")}. ${rejecting.pending_review_note ?? ""}`.trim(),
        })
        .eq("id", rejecting.id);
      if (error) throw error;
      toast({ title: "Cadastro rejeitado", description: `${rejecting.full_name} inativado.` });
      setRejecting(null);
      await load();
    } catch (err: any) {
      toast({ title: "Erro ao rejeitar", description: err?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const fmtAuthor = (uid: string | null) => {
    if (!uid) return "—";
    const a = authors[uid];
    if (!a) return uid.slice(0, 8);
    return a.full_name || a.email || uid.slice(0, 8);
  };

  return (
    <>
      <Card className="border-amber-300">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Cadastros provisórios aguardando validação
              </CardTitle>
              <CardDescription>
                Médicos cadastrados pelos analistas durante a importação. Aprove
                para liberar o envio para validação do pagamento; rejeite para remover.
              </CardDescription>
            </div>
            <Badge variant="outline">{rows.length} pendente{rows.length === 1 ? "" : "s"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum cadastro provisório aguardando validação.
            </p>
          )}
          {!loading && rows.map((row) => {
            const e = edits[row.id] ?? {};
            const name = (e.full_name as string) ?? row.full_name;
            const crm = (e.crm as string) ?? (row.crm ?? "");
            const uf = (e.crm_uf as string) ?? (row.crm_uf ?? "");
            return (
              <div key={row.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    Criado por <span className="font-medium text-foreground">{fmtAuthor(row.created_by_user_id)}</span>
                    {" · "}
                    {new Date(row.created_at).toLocaleString("pt-BR")}
                  </div>
                  <Badge variant="secondary">Provisório</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr,140px,80px] gap-2">
                  <div>
                    <Label className="text-[11px]">Nome</Label>
                    <Input value={name} onChange={(ev) => setEdit(row.id, { full_name: ev.target.value })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-[11px]">CRM</Label>
                    <Input value={crm} onChange={(ev) => setEdit(row.id, { crm: ev.target.value })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-[11px]">UF</Label>
                    <Input value={uf} onChange={(ev) => setEdit(row.id, { crm_uf: ev.target.value.toUpperCase() })} className="h-8" maxLength={2} />
                  </div>
                </div>

                {row.pending_review_note && (
                  <p className="text-xs text-muted-foreground italic">{row.pending_review_note}</p>
                )}

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setRejecting(row)} disabled={busyId === row.id}>
                    <Trash2 className="h-4 w-4 mr-1" /> Rejeitar
                  </Button>
                  <Button size="sm" onClick={() => approve(row)} disabled={busyId === row.id}>
                    {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <UserCheck className="h-4 w-4 mr-1" />}
                    Aprovar
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <AlertDialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar cadastro provisório?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejecting?.full_name} será removido permanentemente. Os itens de
              pagamento que estavam vinculados a este registro ficarão sem
              médico associado e precisarão ser revisados pelo analista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReject}>Confirmar rejeição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
