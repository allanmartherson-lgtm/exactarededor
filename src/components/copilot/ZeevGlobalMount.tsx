import { useLocation } from "react-router-dom";
import { useMemo } from "react";
import { ZeevAssistant } from "./ZeevAssistant";

/**
 * Mount global do Zeev — fica sempre disponível em qualquer tela autenticada,
 * mas se cala em rotas que montam seu próprio <ZeevAssistant /> com contexto rico
 * (ex.: análise de empresa traz items + filtros).
 */

// rotas que têm Zeev próprio com contexto detalhado
const SUPPRESSED_PATTERNS: RegExp[] = [
  /^\/pagamentos\/[^/]+\/empresa\/[^/]+/, // CompanyAnalysis
];

// mapa de label amigável por rota (prefixo)
const ROUTE_LABELS: Array<{ test: RegExp; label: string }> = [
  { test: /^\/$/, label: "Dashboard" },
  { test: /^\/pagamentos\/novo/, label: "Novo lote de pagamento" },
  { test: /^\/pagamentos\/[^/]+$/, label: "Detalhe do pagamento" },
  { test: /^\/pagamentos$/, label: "Lista de pagamentos" },
  { test: /^\/bi\/diretoria/, label: "BI · Diretoria" },
  { test: /^\/bi\/pagamentos/, label: "BI · Pagamentos" },
  { test: /^\/bi\/lote/, label: "BI · Lote" },
  { test: /^\/inteligencia-financeira/, label: "Inteligência financeira" },
  { test: /^\/recebiveis/, label: "Aging de recebíveis" },
  { test: /^\/glosas/, label: "Glosas" },
  { test: /^\/financeiro\/conciliacao/, label: "Conciliação bancária" },
  { test: /^\/pendencias\/[^/]+/, label: "Detalhe da pendência" },
  { test: /^\/pendencias/, label: "Pendências" },
  { test: /^\/notas-fiscais/, label: "Notas fiscais" },
  { test: /^\/conversas/, label: "Conversas" },
  { test: /^\/comunicacao/, label: "Comunicação em massa" },
  { test: /^\/casos-especiais/, label: "Casos especiais" },
  { test: /^\/kpis/, label: "KPIs" },
  { test: /^\/relatorios\/intervencoes/, label: "Relatório de intervenções" },
  { test: /^\/relatorios\/evolucao-pagamentos/, label: "Evolução de pagamentos" },
  { test: /^\/relatorios\/central/, label: "Central de relatórios" },
  { test: /^\/medicos/, label: "Médicos" },
  { test: /^\/empresas/, label: "Empresas" },
  { test: /^\/convenios/, label: "Convênios" },
  { test: /^\/setores/, label: "Setores" },
  { test: /^\/regras/, label: "Regras de repasse" },
  { test: /^\/auditoria/, label: "Auditoria" },
  { test: /^\/sistema/, label: "Sistema" },
];

// rotas onde o Zeev não deve aparecer (auth, portais externos, etc.)
const HIDDEN_PATTERNS: RegExp[] = [
  /^\/auth/,
  /^\/definir-senha/,
  /^\/reset-password/,
  /^\/trocar-senha/,
  /^\/portal\//,
  /^\/aprovar\//,
  /^\/selecionar-hospital/,
  /^\/preview-/,
];

export function ZeevGlobalMount() {
  const location = useLocation();
  const pathname = location.pathname;

  const { suppressed, hidden, label } = useMemo(() => {
    const hidden = HIDDEN_PATTERNS.some((r) => r.test(pathname));
    const suppressed = SUPPRESSED_PATTERNS.some((r) => r.test(pathname));
    const match = ROUTE_LABELS.find((m) => m.test.test(pathname));
    return { suppressed, hidden, label: match?.label ?? "Exacta" };
  }, [pathname]);

  if (hidden || suppressed) return null;

  return (
    <ZeevAssistant
      pageLabel={label}
      summary={{ rota: pathname }}
    />
  );
}
