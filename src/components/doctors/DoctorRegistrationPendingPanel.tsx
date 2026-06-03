import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Building2, Stethoscope, Link2, RefreshCw, Search, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

interface Props {
  onCreateDoctor?: (seed: { full_name: string; doctor_document: string | null }) => void;
  onLinkCompany?: (doctorId: string, companyId: string, companyName: string) => void;
}

export function DoctorRegistrationPendingPanel({ onCreateDoctor, onLinkCompany }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [linking, setLinking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as unknown as {
      rpc: (n: string) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
    }).rpc("get_registration_pending_doctors");
    if (!error) setRows((data ?? []) as Row[]);
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

  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const linkPj = async (doctorId: string, companyId: string) => {
    setLinking(`${doctorId}|${companyId}`);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("doctor_companies")
      .insert({ doctor_id: doctorId, company_id: companyId, start_date: today });
    setLinking(null);
    if (error) {
      // Conflito com vigência aberta de outra PJ
      alert("Não foi possível vincular: este médico já possui PJ vigente em sobreposição. Encerre a anterior primeiro.");
      return;
    }
    setRows((prev) => prev.filter((r) => !(r.doctor_id === doctorId && r.company_id === companyId)));
  };


  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>Pendências de cadastro</span>
            <Badge variant="outline" className="text-[10px]">
              {unregistered.length} médico(s) • {unlinked.length} PJ(s)
            </Badge>
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
              <div className="divide-y divide-border">
                {unlinked.map((r, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.doctor_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{r.doctor_document}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        <Building2 className="inline h-3 w-3 mr-1" />{r.company_name}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold">{fmtBRL(Number(r.total_amount))}</p>
                      <p className="text-muted-foreground">{r.items_count} item(s)</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={linking === `${r.doctor_id}|${r.company_id}`}
                      onClick={() => {
                        if (r.doctor_id && r.company_id) {
                          if (onLinkCompany) onLinkCompany(r.doctor_id, r.company_id, r.company_name || "");
                          else linkPj(r.doctor_id, r.company_id);
                        }
                      }}
                    >
                      <Link2 className="h-3.5 w-3.5 mr-1" />Vincular
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
