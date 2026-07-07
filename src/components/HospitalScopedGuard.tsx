import { useNavigate } from "react-router-dom";
import { useHospital } from "@/contexts/HospitalContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, Building2 } from "lucide-react";

interface HospitalScopedGuardProps {
  /** hospital_id do registro carregado (payment, pendencia, pool, etc). */
  recordHospitalId: string | null | undefined;
  /** Rótulo do tipo de registro para a mensagem. Ex: "pagamento", "pendência". */
  entityLabel: string;
  /** Rota do hub para onde voltar (ex: "/pagamentos"). */
  fallbackHub: string;
  children: React.ReactNode;
}

/**
 * Guarda de escopo por hospital para telas de detalhe.
 *
 * Quando o registro carregado pertence a um hospital diferente do ativo,
 * mostra uma tela clara oferecendo: (1) trocar para o hospital dono do
 * registro (se o usuário tem acesso), ou (2) voltar ao hub.
 *
 * Evita loading eterno / "not found" disfarçado após troca de hospital
 * enquanto o usuário está numa rota /:id de outro hospital.
 */
export function HospitalScopedGuard({
  recordHospitalId,
  entityLabel,
  fallbackHub,
  children,
}: HospitalScopedGuardProps) {
  const { hospital, availableHospitals, switchHospital, switching } = useHospital();
  const navigate = useNavigate();

  // Registro ainda não carregou ou não tem hospital_id → deixa passar
  // (a tela mostra seu próprio loading/erro).
  if (!recordHospitalId || !hospital) return <>{children}</>;
  if (recordHospitalId === hospital.id) return <>{children}</>;

  const owner = availableHospitals.find((h) => h.id === recordHospitalId) ?? null;

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-lg w-full shadow-card">
        <CardHeader>
          <div className="flex items-center gap-2 text-amber-600 mb-1">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-xs font-medium uppercase tracking-wide">
              Registro de outra unidade
            </span>
          </div>
          <CardTitle className="text-lg">
            Este {entityLabel} pertence a {owner?.name ?? "outro hospital"}
          </CardTitle>
          <CardDescription>
            Você está atualmente em <strong>{hospital.name}</strong>. Cada hospital
            trabalha com seus próprios dados — para continuar aqui, escolha uma opção:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {owner && (
            <Button
              className="w-full justify-start"
              onClick={() => void switchHospital(owner.id)}
              disabled={switching}
            >
              <Building2 className="h-4 w-4 mr-2" />
              Trocar para {owner.name}
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate(fallbackHub)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar para lista de {entityLabel}s
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
