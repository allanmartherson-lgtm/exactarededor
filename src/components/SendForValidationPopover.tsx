import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type ValidatorAssignment = {
  validator_id: string | null;
  validator_group_id: string | null;
};

type ValidatorUser = { id: string; full_name: string | null; email: string };
type ValidatorGroup = { id: string; name: string; active: boolean };

type Mode = "general" | "user" | "group";

type Props = {
  /** Texto do botão. */
  label?: string;
  /** Renderizar com qual variante de botão. */
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  /** Disparado quando o usuário confirma. Recebe a atribuição final. */
  onConfirm: (assignment: ValidatorAssignment) => Promise<void> | void;
  /** Desabilita o trigger (ex.: nada para enviar). */
  disabled?: boolean;
  /** Texto auxiliar acima dos selects (ex.: "Enviando 3 empresas"). */
  helperText?: string;
};

/**
 * Popover usado pelo analista quando vai enviar um lote/empresa para validação.
 * Permite escolher entre: fila geral, validador específico ou grupo de validadores.
 */
export function SendForValidationPopover({
  label = "Enviar para validação",
  variant = "default",
  size = "default",
  onConfirm,
  disabled,
  helperText,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("general");
  const [validators, setValidators] = useState<ValidatorUser[]>([]);
  const [groups, setGroups] = useState<ValidatorGroup[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      const [rolesRes, gRes] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "validador"),
        supabase.from("validator_groups").select("id, name, active").eq("active", true).order("name"),
      ]);
      const ids = Array.from(new Set((rolesRes.data ?? []).map((r) => r.user_id)));
      let users: ValidatorUser[] = [];
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        users = ((profs ?? []) as ValidatorUser[]).sort((a, b) =>
          (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email),
        );
      }
      setValidators(users);
      setGroups((gRes.data ?? []) as ValidatorGroup[]);
      setLoaded(true);
    })();
  }, [open, loaded]);

  const canConfirm = useMemo(() => {
    if (mode === "general") return true;
    if (mode === "user") return Boolean(selectedUser);
    if (mode === "group") return Boolean(selectedGroup);
    return false;
  }, [mode, selectedUser, selectedGroup]);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    const assignment: ValidatorAssignment = {
      validator_id: mode === "user" ? selectedUser : null,
      validator_group_id: mode === "group" ? selectedGroup : null,
    };
    try {
      await onConfirm(assignment);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          <Send className="h-4 w-4 mr-2" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
          <div>
            <Label className="text-xs">Destinatário</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Fila geral (qualquer validador)</SelectItem>
                <SelectItem value="user">Validador específico</SelectItem>
                <SelectItem value="group">Grupo de validadores</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "user" && (
            <div>
              <Label className="text-xs">Validador</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolher validador..." />
                </SelectTrigger>
                <SelectContent>
                  {validators.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum validador cadastrado
                    </div>
                  ) : (
                    validators.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.full_name ?? v.email}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "group" && (
            <div>
              <Label className="text-xs">Grupo</Label>
              <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolher grupo..." />
                </SelectTrigger>
                <SelectContent>
                  {groups.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum grupo ativo
                    </div>
                  ) : (
                    groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={!canConfirm || submitting}>
              {submitting ? "Enviando..." : "Enviar"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
