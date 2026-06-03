import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { AppRole } from "@/lib/status";

interface HospitalOption {
  id: string;
  name: string;
  state_uf: string;
}

interface Props {
  userId: string;
  /** Papéis do usuário — define a role gravada em user_hospitals (validador > analista). */
  userRoles: AppRole[];
  /** Hospital marcado como principal em profiles — exibido como tal e não removível. */
  primaryHospitalId: string | null;
  /** Lista global de hospitais ativos (já carregada na página). */
  hospitals: HospitalOption[];
}

/** Resolve a role armazenada em user_hospitals a partir dos papéis do usuário. */
const resolveLinkRole = (roles: AppRole[]): AppRole => {
  if (roles.includes("validador")) return "validador";
  if (roles.includes("diretor")) return "diretor";
  if (roles.includes("admin")) return "admin";
  return "analista";
};

export const UserHospitalsManager = ({ userId, userRoles, primaryHospitalId, hospitals }: Props) => {
  const [links, setLinks] = useState<{ hospital_id: string; role: AppRole }[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_hospitals")
      .select("hospital_id, role")
      .eq("user_id", userId);
    if (error) {
      toast({ title: "Erro ao carregar hospitais", description: error.message, variant: "destructive" });
      setLinks([]);
    } else {
      setLinks((data ?? []) as { hospital_id: string; role: AppRole }[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const linkedIds = new Set(links.map((l) => l.hospital_id));
  const available = hospitals.filter((h) => !linkedIds.has(h.id));

  const add = async () => {
    if (!addingId) return;
    setBusy(addingId);
    const role = resolveLinkRole(userRoles);
    const { data, error } = await supabase.functions.invoke("admin-manage-user-hospitals", {
      body: { action: "link", user_id: userId, hospital_id: addingId, role },
    });
    setBusy(null);
    const errMsg = (error as { message?: string } | null)?.message
      ?? (data as { error?: string } | null)?.error;
    if (errMsg) {
      toast({ title: "Falha ao vincular", description: errMsg, variant: "destructive" });
      return;
    }
    setAddingId("");
    await load();
    toast({ title: "Hospital vinculado" });
  };

  const remove = async (hospitalId: string) => {
    if (hospitalId === primaryHospitalId) {
      toast({
        title: "Hospital principal",
        description: "Defina outro hospital principal antes de remover este vínculo.",
        variant: "destructive",
      });
      return;
    }
    setBusy(hospitalId);
    const { data, error } = await supabase.functions.invoke("admin-manage-user-hospitals", {
      body: { action: "unlink", user_id: userId, hospital_id: hospitalId },
    });
    setBusy(null);
    const errMsg = (error as { message?: string } | null)?.message
      ?? (data as { error?: string } | null)?.error;
    if (errMsg) {
      toast({ title: "Falha ao remover", description: errMsg, variant: "destructive" });
      return;
    }
    await load();
    toast({ title: "Vínculo removido" });
  };


  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando hospitais…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {links.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhum hospital vinculado.</span>
        )}
        {links.map((l) => {
          const h = hospitals.find((x) => x.id === l.hospital_id);
          const label = h ? `${h.name} (${h.state_uf})` : l.hospital_id;
          const isPrimary = l.hospital_id === primaryHospitalId;
          return (
            <Badge key={l.hospital_id} variant={isPrimary ? "default" : "secondary"} className="gap-1.5 pr-1">
              <span>{label}</span>
              {isPrimary && <span className="text-[10px] uppercase">principal</span>}
              {!isPrimary && (
                <button
                  type="button"
                  onClick={() => remove(l.hospital_id)}
                  disabled={busy === l.hospital_id}
                  className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5"
                  aria-label="Remover vínculo"
                >
                  {busy === l.hospital_id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <X className="h-3 w-3" />}
                </button>
              )}
            </Badge>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <select
          className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          value={addingId}
          onChange={(e) => setAddingId(e.target.value)}
        >
          <option value="">— Selecionar hospital para vincular —</option>
          {available.map((h) => (
            <option key={h.id} value={h.id}>{h.name} ({h.state_uf})</option>
          ))}
        </select>
        <Button size="sm" onClick={add} disabled={!addingId || busy === addingId}>
          {busy === addingId
            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            : <Plus className="h-3.5 w-3.5 mr-1.5" />}
          Vincular
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        O usuário pode operar em qualquer hospital vinculado e alternar pelo seletor do topo. O hospital principal é o pré-selecionado no login.
      </p>
    </div>
  );
};
