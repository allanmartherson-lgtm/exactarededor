import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type EventDef = { key: string; label: string };
type Channel = "email" | "whatsapp" | "both" | "off";

export default function NotificationPreferences() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventDef[]>([]);
  const [prefs, setPrefs] = useState<Record<string, Channel>>({});
  const [phone, setPhone] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [cat, ch, prof] = await Promise.all([
        supabase.from("system_configurations").select("value").eq("key", "notification.event_catalog").maybeSingle(),
        supabase.from("notification_channels").select("event_key, channel").eq("user_id", user.id),
        supabase.from("profiles").select("phone_e164, whatsapp_opt_in").eq("id", user.id).maybeSingle(),
      ]);
      setEvents((cat.data?.value as EventDef[]) ?? []);
      const map: Record<string, Channel> = {};
      (ch.data ?? []).forEach((r: any) => (map[r.event_key] = r.channel));
      setPrefs(map);
      setPhone(prof.data?.phone_e164 ?? "");
      setOptIn(prof.data?.whatsapp_opt_in ?? false);
      setLoading(false);
    })();
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      // Upsert profile fields
      await supabase.from("profiles").update({
        phone_e164: phone || null,
        whatsapp_opt_in: optIn,
        whatsapp_opt_in_at: optIn ? new Date().toISOString() : null,
      }).eq("id", user.id);

      // Upsert each preference
      const rows = events.map((e) => ({
        user_id: user.id,
        event_key: e.key,
        channel: prefs[e.key] ?? "email",
      }));
      for (const r of rows) {
        await supabase.from("notification_channels").upsert(r, { onConflict: "user_id,event_key" });
      }

      toast({ title: "Preferências salvas." });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="container py-8"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <PageHeader title="Notificações" subtitle="Configure por onde você quer ser avisado em cada etapa do fluxo." />

      <Card>
        <CardHeader>
          <CardTitle>Canal de WhatsApp</CardTitle>
          <CardDescription>Necessário para receber mensagens fora do e-mail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="phone">Telefone (E.164, ex: +5561999998888)</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5561999998888" />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={optIn} onCheckedChange={setOptIn} id="optin" />
            <Label htmlFor="optin">Aceito receber notificações no WhatsApp</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Por evento</CardTitle>
          <CardDescription>Escolha o canal preferido para cada tipo de notificação.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.map((ev) => (
            <div key={ev.key} className="flex items-center justify-between gap-4 border-b pb-3 last:border-0">
              <Label className="flex-1">{ev.label}</Label>
              <Select
                value={prefs[ev.key] ?? "email"}
                onValueChange={(v) => setPrefs((p) => ({ ...p, [ev.key]: v as Channel }))}
              >
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp" disabled={!optIn}>WhatsApp</SelectItem>
                  <SelectItem value="both" disabled={!optIn}>E-mail + WhatsApp</SelectItem>
                  <SelectItem value="off">Desligado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Salvar preferências
      </Button>
    </div>
  );
}
