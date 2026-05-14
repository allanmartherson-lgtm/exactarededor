import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, MessageSquare, Bell } from "lucide-react";

interface NotificationSetting {
  id: string;
  event_type: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  returned: "Lote devolvido/rejeitado",
  ia_concluded: "Análise IA concluída",
  nf_received: "Nota Fiscal recebida",
};

const Profile = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [settings, setSettings] = useState<NotificationSetting[]>([]);

  useEffect(() => {
    document.title = "Meu Perfil | MedPay";
    loadProfile();
    loadSettings();
  }, []);

  const loadProfile = async () => {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    setProfile(data);
  };

  const loadSettings = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("user_notification_settings")
      .select("*")
      .eq("user_id", user.id);
    
    if (error) {
      toast({ title: "Erro ao carregar configurações", description: error.message, variant: "destructive" });
      return;
    }

    // Garante que todos os eventos básicos existem no estado
    const events = ["returned", "ia_concluded", "nf_received"];
    const existingSettings = data || [];
    const completeSettings = events.map(evt => {
      const existing = existingSettings.find(s => s.event_type === evt);
      return existing || { event_type: evt, email_enabled: true, whatsapp_enabled: true };
    });

    setSettings(completeSettings as any);
    setLoading(false);
  };

  const toggleSetting = async (eventType: string, field: 'email_enabled' | 'whatsapp_enabled', value: boolean) => {
    if (!user) return;
    
    const current = settings.find(s => s.event_type === eventType);
    const newSettings = settings.map(s => 
      s.event_type === eventType ? { ...s, [field]: value } : s
    );
    setSettings(newSettings);

    const { error } = await supabase
      .from("user_notification_settings")
      .upsert({
        user_id: user.id,
        event_type: eventType,
        [field]: value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,event_type' });

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      // Reverte estado local em caso de erro
      setSettings(settings);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Meu Perfil" 
        description="Gerencie seus dados e preferências de notificação." 
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-lg">Dados Pessoais</CardTitle>
            <CardDescription>Informações básicas da sua conta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome Completo</Label>
              <Input value={profile?.full_name || ""} readOnly disabled className="bg-muted/50" />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input value={user?.email || ""} readOnly disabled className="bg-muted/50" />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={profile?.phone || ""} readOnly disabled className="bg-muted/50" />
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              * Para alterar seus dados cadastrais, entre em contato com um administrador.
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Notificações
            </CardTitle>
            <CardDescription>Escolha como e quando quer ser avisado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {settings.map((s) => (
              <div key={s.event_type} className="space-y-3 pb-4 border-b last:border-0">
                <h4 className="text-sm font-medium">{EVENT_LABELS[s.event_type] || s.event_type}</h4>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">E-mail</span>
                  </div>
                  <Switch 
                    checked={s.email_enabled} 
                    onCheckedChange={(val) => toggleSetting(s.event_type, 'email_enabled', val)} 
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">WhatsApp</span>
                  </div>
                  <Switch 
                    checked={s.whatsapp_enabled} 
                    onCheckedChange={(val) => toggleSetting(s.event_type, 'whatsapp_enabled', val)} 
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Profile;
