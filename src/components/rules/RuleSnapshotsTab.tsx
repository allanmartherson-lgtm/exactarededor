import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { formatDateTimeBR } from "@/lib/dateUtils";
import { toast } from "@/hooks/use-toast";
import { confirmDialog } from "@/lib/confirm";

type Snapshot = {
  id: string;
  rule_id: string;
  reason: string | null;
  calc_count: number | null;
  actor_id: string | null;
  created_at: string;
};

type Profile = { id: string; email: string; full_name: string | null };

const REASON_LABELS: Record<string, string> = {
  before_edit: "Antes da edição",
  after_save: "Após salvar",
  manual: "Manual",
  pre_restore: "Antes de restaurar",
};

const REASON_VARIANTS: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  before_edit: "outline",
  after_save: "default",
  manual: "secondary",
  pre_restore: "destructive",
};

interface Props {
  ruleId: string;
  onRestored?: () => void;
}

export function RuleSnapshotsTab({ ruleId, onRestored }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rule_snapshots")
      .select("id, rule_id, reason, calc_count, actor_id, created_at")
      .eq("rule_id", ruleId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast({ title: "Erro ao carregar snapshots", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rows = (data || []) as Snapshot[];
    setSnapshots(rows);
    const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter(Boolean))) as string[];
    if (actorIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", actorIds);
      const map: Record<string, Profile> = {};
      (profs || []).forEach(p => { map[p.id] = p as Profile; });
      setProfiles(map);
    }
    setLoading(false);
  }, [ruleId]);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (snap: Snapshot) => {
    const ok = await confirmDialog({
      title: "Restaurar este snapshot?",
      description: `Esta ação substitui a regra atual e seus ${snap.calc_count ?? 0} cálculo(s) pelo estado salvo em ${formatDateTimeBR(snap.created_at)}. Um snapshot de segurança do estado atual será criado automaticamente antes de aplicar.`,
      confirmText: "Restaurar",
      tone: "danger",
    });
    if (!ok) return;
    setRestoringId(snap.id);
    const { error } = await supabase.rpc("restore_rule_from_snapshot", { _snapshot_id: snap.id });
    setRestoringId(null);
    if (error) {
      toast({ title: "Falha ao restaurar", description: error.message, variant: "destructive" });
      return;
    }
    const { recomputeDoctorSpecificExclusions } = await import("@/lib/recomputeDoctorSpecificExclusions");
    await recomputeDoctorSpecificExclusions();
    toast({ title: "Snapshot restaurado", description: "A regra foi revertida com sucesso." });
    await load();
    onRestored?.();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando snapshots…
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
        <AlertCircle className="h-6 w-6 mb-2" />
        <p className="text-sm">Nenhum snapshot disponível ainda.</p>
        <p className="text-xs">Os snapshots são gerados automaticamente a cada edição.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Camera className="h-3.5 w-3.5" />
        <span>{snapshots.length} snapshot(s) — backup automático a cada edição</span>
      </div>
      {snapshots.map((snap) => {
        const actor = snap.actor_id ? profiles[snap.actor_id] : null;
        const actorLabel = actor?.full_name || actor?.email || (snap.actor_id ? "Usuário" : "Sistema");
        const reasonLabel = REASON_LABELS[snap.reason || ""] || snap.reason || "Snapshot";
        const variant = REASON_VARIANTS[snap.reason || ""] || "outline";
        return (
          <div key={snap.id} className="rounded-md border bg-card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={variant} className="text-[10px]">{reasonLabel}</Badge>
                <span className="text-sm font-medium">{formatDateTimeBR(snap.created_at)}</span>
                <span className="text-xs text-muted-foreground">por {actorLabel}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {snap.calc_count ?? 0} cálculo(s) salvos no snapshot
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={restoringId === snap.id}
              onClick={() => handleRestore(snap)}
            >
              {restoringId === snap.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Restaurar
            </Button>
          </div>
        );
      })}
    </div>
  );
}
