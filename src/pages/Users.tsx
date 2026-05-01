import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/status";
import { toast } from "@/hooks/use-toast";

const ROLES: AppRole[] = ["admin", "diretor", "validador", "analista"];

const Users = () => {
  const [users, setUsers] = useState<any[]>([]);

  const load = async () => {
    const { data: profiles } = await supabase.from("profiles").select("*");
    const { data: roles } = await supabase.from("user_roles").select("*");
    const map = (profiles ?? []).map((p) => ({ ...p, roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role) }));
    setUsers(map);
  };
  useEffect(() => { document.title = "Usuários | MedPay"; load(); }, []);

  const toggle = async (userId: string, role: AppRole, has: boolean) => {
    if (has) await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    else await supabase.from("user_roles").insert({ user_id: userId, role });
    load(); toast({ title: "Atualizado" });
  };

  return (
    <>
      <PageHeader title="Usuários" description="Atribua papéis para controlar quem valida e aprova." />
      <div className="p-8">
        <Card className="shadow-card"><CardContent className="p-0">
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div><p className="font-medium text-sm">{u.full_name || u.email}</p><p className="text-xs text-muted-foreground">{u.email}</p></div>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((r) => {
                    const has = u.roles.includes(r);
                    return <Button key={r} size="sm" variant={has ? "default" : "outline"} onClick={() => toggle(u.id, r, has)}>{ROLE_LABELS[r]}</Button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      </div>
    </>
  );
};
export default Users;