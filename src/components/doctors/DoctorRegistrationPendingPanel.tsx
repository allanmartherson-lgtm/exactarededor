import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Building2, Stethoscope, Link2, RefreshCw, Search, Loader2, ArrowRightLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveActiveHospitalId } from "@/lib/resolveActiveHospitalId";

type Row = {
  kind: "doctor_unregistered" | "pj_not_linked";
  doctor_name: string | null;
  doctor_document: string | null;
  doctor_id: string | null;
  company_id: string | null;
  company_name: string | null;
  items_count: number;
  total_amount: number;
  last_seen_at: string | null;
};

type ActiveLink = { doctor_id: string; company_id: string; company_name: string };

interface Props {
  onCreateDoctor?: (seed: { full_name: string; doctor_document: string | null }) => void;
  onLinkCompany?: (doctorId: string, companyId: string, companyName: string) => void;
}

export function DoctorRegistrationPendingPanel({ onCreateDoctor, onLinkCompany }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [activeLinks, setActiveLinks] = useState<Map<string, ActiveLink>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [bulkLinking, setBulkLinking] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<{ rows: Row[]; mode: "single" | "bulk" } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as unknown as {
      rpc: (n: string) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
    }).rpc("get_registration_pending_doctors");
    const pend = (error ? [] : (data ?? [])) as Row[];
    setRows(pend);

    // Buscar PJ ativa atual de cada médico pendente — para detectar divergência
    const doctorIds = Array.from(new Set(pend.filter(r => r.kind === "pj_not_linked" && r.doctor_id).map(r => r.doctor_id!)));
    if (doctorIds.length) {
      const { data: links } = await supabase
        .from("doctor_companies")
        .select("doctor_id, company_id, companies(name)")
        .in("doctor_id", doctorIds)
        .is("end_date", null);
      const m = new Map<string, ActiveLink>();
      (links ?? []).forEach((l: { doctor_id: string; company_id: string; companies: { name: string } | null }) => {
        if (!m.has(l.doctor_id)) {
          m.set(l.doctor_id, { doctor_id: l.doctor_id, company_id: l.company_id, company_name: l.companies?.name ?? "" });
        }
      });
      setActiveLinks(m);
    } else {
      setActiveLinks(new Map());
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.doctor_name, r.doctor_document, r.company_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  const unregistered = filtered.filter((r) => r.kind === "doctor_unregistered");
  const unlinked = filtered.filter((r) => r.kind === "pj_not_linked");
  const divergentCount = unlinked.filter(r => {
    const link = r.doctor_id ? activeLinks.get(r.doctor_id) : null;
    return link && link.company_id !== r.company_id;
  }).length;

  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Encerra vínculos ativos conflitantes (≠ targetCompanyId) e cria novo vínculo
  // Regra: pagamento prevalece — se o médico recebeu por uma PJ diferente da vinculada,
  // encerramos a antiga (end_reason=troca_pj_pagamento) e abrimos a nova.
  const upsertLink = async (doctorId: string, companyId: string): Promise<boolean> => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const link = activeLinks.get(doctorId);
    const divergent = link && link.company_id !== companyId;

    if (divergent) {
      const { error: endErr } = await supabase
        .from("doctor_companies")
        .update({ end_date: today, end_reason: "troca_pj_pagamento" })
        .eq("doctor_id", doctorId)
        .eq("company_id", link!.company_id)
        .is("end_date", null);
      if (endErr) return false;
    }

    const { error } = await supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctorId, company_id: companyId, start_date: divergent ? tomorrow : today });
    return !error;
  };

  const executeLinks = async (targets: Row[]) => {
    setBulkLinking(true);
    let ok = 0, skipped = 0;
    const resolved = new Set<string>();
    for (const r of targets) {
      if (!r.doctor_id || !r.company_id) { skipped++; continue; }
      const success = await upsertLink(r.doctor_id, r.company_id);
      if (!success) { skipped++; continue; }
      ok++;
      resolved.add(`${r.doctor_id}|${r.company_id}`);
    }
    setRows((prev) => prev.filter((r) => !resolved.has(`${r.doctor_id}|${r.company_id}`)));
    setBulkLinking(false);
    toast({
      title: targets.length === 1 ? "Vínculo atualizado" : "Vínculos atualizados",
      description: `${ok} criado(s)${skipped ? ` · ${skipped} ignorado(s)` : ""}.`,
    });
    load();
  };

  const linkPj = async (row: Row) => {
    if (!row.doctor_id || !row.company_id) return;
    const link = activeLinks.get(row.doctor_id);
    const divergent = !!(link && link.company_id !== row.company_id);
    if (divergent) {
      setConfirmPayload({ rows: [row], mode: "single" });
      return;
    }
    setLinking(`${row.doctor_id}|${row.company_id}`);
    const ok = await upsertLink(row.doctor_id, row.company_id);
    setLinking(null);
    if (!ok) {
      toast({ title: "Não foi possível vincular", description: "Verifique sobreposição de vigência.", variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => !(r.doctor_id === row.doctor_id && r.company_id === row.company_id)));
  };

  const bulkLinkAll = () => {
    if (!unlinked.length) return;
    setConfirmPayload({ rows: unlinked, mode: "bulk" });
  };


  const totalItems = unlinked.reduce((s, r) => s + Number(r.items_count || 0), 0);

  return (
    <>
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>Pendências de cadastro</span>
            <Badge variant="outline" className="text-[10px]">
              {unregistered.length} médico(s) • {unlinked.length} PJ(s) • {totalItems} item(s)
            </Badge>
            {divergentCount > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <ArrowRightLeft className="h-3 w-3" />
                {divergentCount} divergente(s) de cadastro
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
        <div className="relative pt-2">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, CRM ou empresa..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-7 h-8 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="doctors" className="w-full">
          <TabsList className="mx-4 mt-2">
            <TabsTrigger value="doctors">
              <Stethoscope className="h-3.5 w-3.5 mr-1.5" />
              Médicos não cadastrados ({unregistered.length})
            </TabsTrigger>
            <TabsTrigger value="pjs">
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              PJs sem vínculo ({unlinked.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="doctors" className="mt-0">
            {unregistered.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma pendência. Todos os médicos pagos estão cadastrados.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {unregistered.map((r, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.doctor_name || "—"}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {r.doctor_document || "Sem CRM no pagamento"}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold">{fmtBRL(Number(r.total_amount))}</p>
                      <p className="text-muted-foreground">{r.items_count} item(s)</p>
                    </div>
                    {onCreateDoctor && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onCreateDoctor({ full_name: r.doctor_name || "", doctor_document: r.doctor_document })}
                      >
                        Cadastrar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="pjs" className="mt-0">
            {unlinked.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma PJ pagadora sem vínculo no cadastro do médico.
              </p>
            ) : (
              <>
                <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-border bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    Médico e PJ já cadastrados, mas o vínculo nunca foi criado. Divergências encerram a PJ atual automaticamente — o pagamento prevalece.
                  </p>
                  <Button size="sm" variant="default" disabled={bulkLinking} onClick={bulkLinkAll}>
                    {bulkLinking ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Link2 className="h-3.5 w-3.5 mr-1" />}
                    Vincular todos ({unlinked.length})
                  </Button>
                </div>
                <div className="divide-y divide-border">
                {unlinked.map((r, i) => {
                  const link = r.doctor_id ? activeLinks.get(r.doctor_id) : null;
                  const divergent = !!(link && link.company_id !== r.company_id);
                  return (
                  <div key={i} className={`px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 ${divergent ? "bg-destructive/5" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.doctor_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{r.doctor_document}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        <Building2 className="inline h-3 w-3 mr-1" />{r.company_name}
                      </p>
                      {divergent && (
                        <p className="text-[11px] text-destructive mt-1 flex items-center gap-1">
                          <ArrowRightLeft className="h-3 w-3" />
                          Cadastrado em <strong className="font-semibold">{link!.company_name}</strong> — será trocado pela PJ pagadora
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold">{fmtBRL(Number(r.total_amount))}</p>
                      <p className="text-muted-foreground">{r.items_count} item(s)</p>
                    </div>
                    <Button
                      size="sm"
                      variant={divergent ? "destructive" : "outline"}
                      disabled={linking === `${r.doctor_id}|${r.company_id}`}
                      onClick={() => {
                        if (r.doctor_id && r.company_id) {
                          if (onLinkCompany && !divergent) onLinkCompany(r.doctor_id, r.company_id, r.company_name || "");
                          else linkPj(r);
                        }
                      }}
                    >
                      {divergent ? <ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> : <Link2 className="h-3.5 w-3.5 mr-1" />}
                      {divergent ? "Trocar PJ" : "Vincular"}
                    </Button>
                  </div>
                  );
                })}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    <AlertDialog open={!!confirmPayload} onOpenChange={(o) => !o && setConfirmPayload(null)}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-destructive" />
            {confirmPayload?.mode === "single" ? "Confirmar troca de PJ" : `Confirmar ${confirmPayload?.rows.length ?? 0} vínculo(s)`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            O pagamento prevalece sobre o cadastro. Os vínculos abaixo serão aplicados agora — vínculos divergentes serão encerrados hoje e os novos abertos a partir de amanhã.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[50vh] border border-border rounded-md">
          <div className="divide-y divide-border">
            {(confirmPayload?.rows ?? []).map((r, i) => {
              const link = r.doctor_id ? activeLinks.get(r.doctor_id) : null;
              const divergent = !!(link && link.company_id !== r.company_id);
              return (
                <div key={i} className={`px-3 py-2 text-xs ${divergent ? "bg-destructive/5" : ""}`}>
                  <p className="font-medium text-sm">{r.doctor_name} <span className="text-muted-foreground font-mono text-[10px] ml-1">{r.doctor_document}</span></p>
                  {divergent ? (
                    <p className="mt-1 text-[11px] leading-relaxed">
                      <span className="text-destructive">✕ Encerrar:</span> <strong>{link!.company_name}</strong>
                      <br />
                      <span className="text-green-700 dark:text-green-500">✓ Abrir:</span> <strong>{r.company_name}</strong>
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px]">
                      <span className="text-green-700 dark:text-green-500">✓ Abrir:</span> <strong>{r.company_name}</strong>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={bulkLinking}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={bulkLinking}
            onClick={async (e) => {
              e.preventDefault();
              const payload = confirmPayload;
              if (!payload) return;
              await executeLinks(payload.rows);
              setConfirmPayload(null);
            }}
          >
            {bulkLinking ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            Confirmar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

