import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Building2, ArrowRight, Star } from "lucide-react";
import { useHospital } from "@/contexts/HospitalContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function SelectHospital() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const { availableHospitals, hospital, switchHospital, loading, primaryHospitalId } = useHospital();

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";

  // Se só tem 1 hospital ou já há um selecionado, segue
  useEffect(() => {
    if (loading) return;
    if (availableHospitals.length === 1) {
      switchHospital(availableHospitals[0].id);
      navigate(redirectTo, { replace: true });
    }
  }, [loading, availableHospitals, switchHospital, navigate, redirectTo]);

  const choose = (id: string) => {
    switchHospital(id);
    navigate(redirectTo, { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (availableHospitals.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Nenhum hospital disponível</h1>
            <p className="text-sm text-muted-foreground">
              Sua conta ainda não está vinculada a nenhum hospital. Solicite acesso ao administrador.
            </p>
            <Button variant="outline" onClick={() => signOut()}>Sair</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background to-muted/30">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <Building2 className="h-10 w-10 mx-auto text-primary" />
          <h1 className="text-2xl font-semibold">Selecione o hospital</h1>
          <p className="text-sm text-muted-foreground">
            Escolha em qual hospital deseja trabalhar agora. Você pode trocar a qualquer momento pelo seletor no topo.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {availableHospitals.map((h) => {
            const isPrimary = h.id === primaryHospitalId;
            const isCurrent = h.id === hospital?.id;
            return (
              <button
                key={h.id}
                onClick={() => choose(h.id)}
                className={cn(
                  "group text-left rounded-lg border bg-card p-5 transition-all hover:border-primary hover:shadow-md",
                  isCurrent && "border-primary ring-2 ring-primary/20",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="rounded-md bg-primary/10 p-2">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{h.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {h.state_uf}
                        {h.cnpj && <> · {h.cnpj}</>}
                      </p>
                      {isPrimary && (
                        <Badge variant="secondary" className="mt-2 gap-1">
                          <Star className="h-3 w-3" /> Principal
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={() => signOut()}>Sair</Button>
        </div>
      </div>
    </div>
  );
}
