// Tela de consentimento OAuth 2.1 para conexões MCP.
// Roteada em /.lovable/oauth/consent — Supabase redireciona para cá com ?authorization_id=...
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExactaLogo } from "@/components/brand/ExactaLogo";

// A API supabase.auth.oauth é beta; tipagem local mínima só para os 3 métodos.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: { client?: { name?: string }; redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<{ client?: { name?: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("authorization_id ausente na URL.");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data ?? {});
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError("O servidor de autorização não devolveu URL de retorno."); }
    window.location.href = target;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2"><ExactaLogo /></div>
          <CardTitle>Conectar aplicativo</CardTitle>
          <CardDescription>
            {details?.client?.name
              ? `${details.client.name} quer se conectar à sua conta Exacta via MCP.`
              : "Um aplicativo quer se conectar à sua conta Exacta via MCP."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && !details && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!error && details && (
            <>
              <p className="text-sm text-muted-foreground">
                O aplicativo poderá acessar as ferramentas do Exacta em seu nome, respeitando suas permissões
                (RLS). Você pode revogar o acesso a qualquer momento pelo seu provedor.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Recusar</Button>
                <Button disabled={busy} onClick={() => decide(true)}>Aprovar</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
