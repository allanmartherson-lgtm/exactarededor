// Seção plugada no diálogo de edição de Usuário (/usuarios).
// Permite marcar o e-mail do usuário como "diretor autorizado a aprovar
// pagamentos por e-mail" — grava em public.hospital_directors para todos
// os hospitais vinculados a esse usuário. Substitui a tela /diretores
// para o fluxo comum (usuário que também é diretor aprovador).
import { useEffect, useState } from "react";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  userId: string;
  email: string;
  fullName: string;
  roleTitle?: string;
}

type HospitalRow = { id: string; name: string; state_uf: string };
type DirectorRow = { id: string; hospital_id: string; active: boolean };

export const UserDirectorApproverSection = ({ userId, email, fullName, roleTitle }: Props) => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hospitals, setHospitals] = useState<HospitalRow[]>([]);
  const [directors, setDirectors] = useState<DirectorRow[]>([]);

  const normalizedEmail = (email ?? "").trim().toLowerCase();

  const load = async () => {
    setLoading(true);

    // 1) Hospitais vinculados: user_hospitals + primary_hospital_id do profile
    const [{ data: links }, { data: profile }] = await Promise.all([
      supabase.from("user_hospitals").select("hospital_id").eq("user_id", userId),
      supabase.from("profiles").select("primary_hospital_id").eq("id", userId).maybeSingle(),
    ]);
    const ids = new Set<string>();
    (links ?? []).forEach((l) => l.hospital_id && ids.add(l.hospital_id));
    if (profile?.primary_hospital_id) ids.add(profile.primary_hospital_id);

    if (ids.size === 0) {
      setHospitals([]);
      setDirectors([]);
      setLoading(false);
      return;
    }

    const { data: hList } = await supabase
      .from("hospitals")
      .select("id, name, state_uf")
      .in("id", Array.from(ids));
    setHospitals((hList ?? []) as HospitalRow[]);

    // 2) Entradas existentes em hospital_directors para esse e-mail nesses hospitais
    if (normalizedEmail) {
      const { data: dList } = await supabase
        .from("hospital_directors")
        .select("id, hospital_id, active")
        .in("hospital_id", Array.from(ids))
        .ilike("email", normalizedEmail);
      setDirectors((dList ?? []) as DirectorRow[]);
    } else {
      setDirectors([]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId, normalizedEmail]);

  const activeCount = directors.filter((d) => d.active).length;
  const isAuthorized = activeCount > 0;

  const enable = async () => {
    if (!normalizedEmail || hospitals.length === 0) return;
    setBusy(true);
    const label = roleTitle?.trim() || "Diretor";
    const rows = hospitals.map((h) => ({
      hospital_id: h.id,
      full_name: fullName || normalizedEmail,
      email: normalizedEmail,
      role_label: label,
      active: true,
      created_by: userId,
    }));
    const { error } = await supabase
      .from("hospital_directors")
      .upsert(rows, { onConflict: "hospital_id,email" });
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao autorizar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Diretor autorizado", description: `Aprovações por e-mail liberadas em ${hospitals.length} hospital(is).` });
    await load();
  };

  const disable = async () => {
    if (directors.length === 0) return;
    setBusy(true);
    const ids = directors.filter((d) => d.active).map((d) => d.id);
    const { error } = await supabase
      .from("hospital_directors")
      .update({ active: false })
      .in("id", ids);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao revogar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Autorização revogada" });
    await load();
  };

  if (loading) {
    return (
      <section className="space-y-2 border-t pt-4">
        <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Aprovação de pagamento por e-mail
        </h4>
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> Aprovação de pagamento por e-mail
      </h4>
      <p className="text-xs text-muted-foreground">
        Quando ativo, o e-mail deste usuário passa a ser aceito como assinatura válida nas aprovações
        de lote recebidas por e-mail (PDF ou print anexado). Vale para todos os hospitais aos quais ele tem acesso.
      </p>

      {hospitals.length === 0 ? (
        <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-md p-2">
          Vincule pelo menos um hospital a este usuário antes de autorizar aprovações por e-mail.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono text-xs">{normalizedEmail || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Switch
                checked={isAuthorized}
                disabled={busy || !normalizedEmail}
                onCheckedChange={(v) => (v ? enable() : disable())}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {hospitals.map((h) => {
              const d = directors.find((x) => x.hospital_id === h.id);
              const on = !!d?.active;
              return (
                <Badge
                  key={h.id}
                  variant={on ? "default" : "outline"}
                  className="text-[10px]"
                  title={on ? "Autorizado neste hospital" : "Não autorizado neste hospital"}
                >
                  {h.name} ({h.state_uf})
                </Badge>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
};
