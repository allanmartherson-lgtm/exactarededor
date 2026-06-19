import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, CheckCircle2, XCircle, RotateCcw, Plus, Stethoscope } from "lucide-react";

type Status = "pending" | "approved" | "rejected" | "revoked";

interface Mark {
  id: string;
  payment_id: string | null;
  attendance_number: string;
  item_id: string | null;
  special_case_type_code: string;
  status: Status;
  origin: string;
  justification: string | null;
  marked_at: string;
  approval_note: string | null;
  rejection_reason: string | null;
}

interface TypeRow { code: string; label: string; description: string | null; active: boolean; requires_justification: boolean; }

export default function SpecialCases() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Status>("pending");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [decisionOpen, setDecisionOpen] = useState<{ id: string; kind: "approve" | "reject" | "revoke" } | null>(null);
  const [note, setNote] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: m }, { data: t }] = await Promise.all([
      supabase.from("special_case_marks").select("*").eq("status", tab).order("marked_at", { ascending: false }).limit(200),
      supabase.from("special_case_types").select("code,label,description,active,requires_justification").eq("active", true).order("label"),
    ]);
    setMarks((m as Mark[]) ?? []);
    setTypes((t as TypeRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  const labelOf = (code: string) => types.find(t => t.code === code)?.label ?? code;

  const decide = async () => {
    if (!decisionOpen) return;
    setActing(decisionOpen.id);
    const { data, error } = await supabase.functions.invoke("decide-special-case", {
      body: { mark_id: decisionOpen.id, decision: decisionOpen.kind, note },
    });
    setActing(null);
    if (error || (data as any)?.error) {
      toast({ title: "Erro", description: String(error?.message ?? (data as any)?.error), variant: "destructive" });
      return;
    }
    toast({ title: "Pronto", description: `Marcação ${decisionOpen.kind === "approve" ? "aprovada" : decisionOpen.kind === "reject" ? "rejeitada" : "revogada"}.` });
    setDecisionOpen(null);
    setNote("");
    void load();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Stethoscope className="h-6 w-6 text-primary" /> Casos Especiais</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Marque atendimentos com viés assistencial (oncológico, pediátrico complexo, etc.) que devem receber remuneração diferenciada.
            Gestão médica aprova; o motor então aplica a regra correspondente — sem regra cadastrada, cai na padrão.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nova marcação</Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
        <TabsList>
          <TabsTrigger value="pending">Pendentes</TabsTrigger>
          <TabsTrigger value="approved">Aprovados</TabsTrigger>
          <TabsTrigger value="rejected">Rejeitados</TabsTrigger>
          <TabsTrigger value="revoked">Revogados</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{marks.length} {tab === "pending" ? "aguardando decisão" : "registros"}</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…</div>
              ) : marks.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">Nenhuma marcação nesta fila.</div>
              ) : (
                <div className="space-y-3">
                  {marks.map((m) => (
                    <div key={m.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary">{labelOf(m.special_case_type_code)}</Badge>
                          <Badge variant="outline">Atendimento {m.attendance_number}</Badge>
                          {m.item_id ? <Badge variant="outline">Item específico</Badge> : <Badge variant="outline">Atendimento inteiro</Badge>}
                          <span className="text-xs text-muted-foreground">{format(new Date(m.marked_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} · origem: {m.origin}</span>
                        </div>
                        {m.justification && <p className="text-sm mt-2"><span className="font-medium">Justificativa:</span> {m.justification}</p>}
                        {m.approval_note && <p className="text-sm text-success mt-1">Nota da aprovação: {m.approval_note}</p>}
                        {m.rejection_reason && <p className="text-sm text-destructive mt-1">Motivo da rejeição: {m.rejection_reason}</p>}
                        {m.payment_id && (
                          <a href={`/pagamentos/${m.payment_id}`} className="text-xs text-primary hover:underline mt-1 inline-block">Ver pagamento →</a>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {tab === "pending" && (
                          <>
                            <Button size="sm" onClick={() => { setDecisionOpen({ id: m.id, kind: "approve" }); setNote(""); }} disabled={acting === m.id}>
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setDecisionOpen({ id: m.id, kind: "reject" }); setNote(""); }} disabled={acting === m.id}>
                              <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                            </Button>
                          </>
                        )}
                        {tab === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => { setDecisionOpen({ id: m.id, kind: "revoke" }); setNote(""); }} disabled={acting === m.id}>
                            <RotateCcw className="h-4 w-4 mr-1" /> Revogar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!decisionOpen} onOpenChange={(o) => { if (!o) { setDecisionOpen(null); setNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionOpen?.kind === "approve" && "Aprovar marcação"}
              {decisionOpen?.kind === "reject" && "Rejeitar marcação"}
              {decisionOpen?.kind === "revoke" && "Revogar marcação"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nota {decisionOpen?.kind !== "approve" && "(motivo)"}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDecisionOpen(null); setNote(""); }}>Cancelar</Button>
            <Button onClick={decide} disabled={acting !== null}>
              {acting && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateMarkDialog open={createOpen} onOpenChange={setCreateOpen} types={types} onCreated={() => { setCreateOpen(false); void load(); }} />
    </div>
  );
}

function CreateMarkDialog({ open, onOpenChange, types, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; types: TypeRow[]; onCreated: () => void; }) {
  const { toast } = useToast();
  const [paymentId, setPaymentId] = useState("");
  const [attendance, setAttendance] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setPaymentId(""); setAttendance(""); setTypeCode(""); setJustification(""); };

  const submit = async () => {
    if (!paymentId || !attendance || !typeCode) {
      toast({ title: "Preencha pagamento, atendimento e tipo", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("mark-special-case", {
      body: { payment_id: paymentId, attendance_number: attendance, special_case_type_code: typeCode, justification },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast({ title: "Erro", description: String(error?.message ?? JSON.stringify((data as any)?.error)), variant: "destructive" });
      return;
    }
    toast({ title: "Marcação criada", description: "Aguardando decisão da gestão médica." });
    reset();
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova marcação de caso especial</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>ID do pagamento</Label>
            <Input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="UUID do pagamento" />
            <p className="text-xs text-muted-foreground mt-1">Copie da URL do detalhe do pagamento.</p>
          </div>
          <div>
            <Label>Nº do atendimento</Label>
            <Input value={attendance} onChange={(e) => setAttendance(e.target.value)} />
          </div>
          <div>
            <Label>Tipo de caso especial</Label>
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Justificativa</Label>
            <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={4} placeholder="Descreva o motivo (paciente, diagnóstico, validação)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Criar marcação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
