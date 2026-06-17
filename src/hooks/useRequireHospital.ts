import { useHospital } from "@/contexts/HospitalContext";
import { toast } from "sonner";

/**
 * Centraliza a checagem "tem unidade ativa antes de gravar?".
 *
 * Uso:
 *   const { hospitalId, ensure } = useRequireHospital();
 *   if (!ensure("salvar regra")) return;
 *   // hospitalId é string garantida a partir daqui
 */
export function useRequireHospital() {
  const { hospital } = useHospital();
  const hospitalId = hospital?.id ?? null;
  const hospitalName = hospital?.name ?? null;

  const ensure = (acao = "executar esta ação"): boolean => {
    if (!hospitalId) {
      toast.error("Selecione uma unidade hospitalar", {
        description: `Necessário escolher a unidade antes de ${acao}. Use o seletor no topo.`,
      });
      return false;
    }
    return true;
  };

  return { hospitalId, hospitalName, ensure };
}
