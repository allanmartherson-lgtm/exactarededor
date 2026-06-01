import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { CheckCircle2, XCircle, Mail, MessageSquare, KeyRound } from "lucide-react";

type Delivery = {
  id: string;
  channel: string;
  event_key: string;
  target_address: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

type Template = {
  id: string;
  template_key: string;
  event_key: string;
  is_active: boolean;
  language_code: string;
};

export default function IntegrationsAdmin() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [d, t] = await Promise.all([
        supabase.from("notification_deliveries").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("whatsapp_templates").select("*").order("event_key"),
      ]);
      setDeliveries((d.data as Delivery[]) ?? []);
      setTemplates((t.data as Template[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="container py-8 space-y-6">
      <PageHeader title="Integrações de Comunicação" description="Status dos canais, templates e últimas entregas." />

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard
          icon={<Mail className="h-5 w-5" />}
          title="E-mail corporativo"
          subtitle="Microsoft Outlook / Gmail"
          ready={false}
          help="Conectar via Cloud → Conectores"
        />
        <StatusCard
          icon={<MessageSquare className="h-5 w-5" />}
          title="WhatsApp Business"
          subtitle="Twilio"
          ready={false}
          help="Conectar Twilio + cadastrar TWILIO_WHATSAPP_FROM"
        />
        <StatusCard
          icon={<KeyRound className="h-5 w-5" />}
          title="Magic Link"
          subtitle="Aprovação por e-mail"
          ready={true}
          help="Pronto. Tokens com TTL 72h."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates WhatsApp</CardTitle>
          <CardDescription>Cadastre os SIDs aprovados pela Meta via Twilio.</CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum template cadastrado ainda.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Chave</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Idioma</TableHead>
                <TableHead>Ativo</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.template_key}</TableCell>
                    <TableCell>{t.event_key}</TableCell>
                    <TableCell>{t.language_code}</TableCell>
                    <TableCell>
                      {t.is_active ? <Badge>Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas entregas</CardTitle>
          <CardDescription>50 mais recentes (todos os canais).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma entrega registrada ainda.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">{new Date(d.created_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell><Badge variant="outline">{d.channel}</Badge></TableCell>
                    <TableCell className="text-xs">{d.event_key}</TableCell>
                    <TableCell className="text-xs font-mono">{d.target_address}</TableCell>
                    <TableCell>
                      {d.status === "sent" || d.status === "delivered" || d.status === "read" ? (
                        <Badge className="bg-emerald-600">{d.status}</Badge>
                      ) : d.status === "failed" || d.status === "bounced" ? (
                        <Badge variant="destructive" title={d.error_message ?? ""}>{d.status}</Badge>
                      ) : (
                        <Badge variant="secondary">{d.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({ icon, title, subtitle, ready, help }: { icon: React.ReactNode; title: string; subtitle: string; ready: boolean; help: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">{icon}<CardTitle className="text-base">{title}</CardTitle></div>
        {ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <p className="mt-2 text-xs">{help}</p>
      </CardContent>
    </Card>
  );
}
