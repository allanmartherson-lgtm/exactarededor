import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";
import { NavLayoutProvider } from "./contexts/NavLayoutContext.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { AppLayout } from "./components/AppLayout.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

// Eagerly loaded critical pages
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import SetPassword from "./pages/SetPassword.tsx";
import ForceChangePassword from "./pages/ForceChangePassword.tsx";

// Lazy loaded feature pages — importers ficam guardados em constantes
// para podermos dispará-los como prefetch em idle (ver IdlePrefetcher abaixo).
const loadDashboard = () => import("./pages/Dashboard.tsx");
const loadExecutiveDashboard = () => import("./pages/ExecutiveDashboard.tsx");
const loadAgingRecebiveis = () => import("./pages/AgingRecebiveis.tsx");
const loadHealthMonitoring = () => import("./pages/HealthMonitoring.tsx");
const loadPayments = () => import("./pages/Payments.tsx");
const loadNewPayment = () => import("./pages/NewPayment.tsx");
const loadPaymentDetail = () => import("./pages/PaymentDetail.tsx");
const loadCompanyAnalysis = () => import("./pages/CompanyAnalysis.tsx");
const loadGlosas = () => import("./pages/Glosas.tsx");
const loadRules = () => import("./pages/Rules.tsx");
const loadValidationRules = () => import("./pages/ValidationRules.tsx");
const loadReferenceTables = () => import("./pages/ReferenceTables.tsx");
const loadRuleSimulator = () => import("./pages/RuleSimulator.tsx");
const loadUsers = () => import("./pages/Users.tsx");
const loadInvoices = () => import("./pages/Invoices.tsx");
const loadInvoicePortal = () => import("./pages/InvoicePortal.tsx");
const loadCompanies = () => import("./pages/Companies.tsx");
const loadCompanyAliases = () => import("./pages/CompanyAliases.tsx");
const loadDoctors = () => import("./pages/Doctors.tsx");
const loadProcedureSpecialtyMap = () => import("./pages/ProcedureSpecialtyMap.tsx");
const loadSectors = () => import("./pages/Sectors.tsx");
const loadCostCenters = () => import("./pages/CostCenters.tsx");
const loadPaymentTypes = () => import("./pages/PaymentTypes.tsx");
const loadPools = () => import("./pages/Pools.tsx");
const loadPoolsReport = () => import("./pages/PoolsReport.tsx");
const loadProfile = () => import("./pages/Profile.tsx");
const loadAuditLog = () => import("./pages/AuditLog.tsx");
const loadStatusAnomalies = () => import("./pages/StatusAnomalies.tsx");
const loadSlaSettings = () => import("./pages/SlaSettings.tsx");
const loadPreviewPalettes = () => import("./pages/PreviewPalettes.tsx");
const loadPreviewDesignSystems = () => import("./pages/PreviewDesignSystems.tsx");
const loadWcagAudit = () => import("./pages/WcagAudit.tsx");
const loadKpis = () => import("./pages/Kpis.tsx");
const loadSidebarDiagnostic = () => import("./pages/SidebarDiagnostic.tsx");
const loadOverflowAudit = () => import("./pages/OverflowAudit.tsx");
const loadFinancialIntelligence = () => import("./pages/FinancialIntelligence.tsx");
const loadNfCycle = () => import("./pages/NfCycle.tsx");
const loadObservationInsights = () => import("./pages/ObservationInsights.tsx");
const loadAnalystProductivity = () => import("./pages/AnalystProductivity.tsx");
const loadAbout = () => import("./pages/About.tsx");
const loadSystemReleases = () => import("./pages/SystemReleases.tsx");
const loadFeatureFlagsAdmin = () => import("./pages/FeatureFlagsAdmin.tsx");
const loadSystemAnnouncementsAdmin = () => import("./pages/SystemAnnouncementsAdmin.tsx");
const loadFinancialJournal = () => import("./pages/FinancialJournal.tsx");
const loadDreReport = () => import("./pages/DreReport.tsx");
const loadMoneyHealth = () => import("./pages/MoneyHealth.tsx");
const loadBusinessObservability = () => import("./pages/BusinessObservability.tsx");
const loadPendencias = () => import("./pages/Pendencias.tsx");

const Dashboard = lazy(loadDashboard);
const ExecutiveDashboard = lazy(loadExecutiveDashboard);
const AgingRecebiveis = lazy(loadAgingRecebiveis);
const HealthMonitoring = lazy(loadHealthMonitoring);
const Payments = lazy(loadPayments);
const NewPayment = lazy(loadNewPayment);
const PaymentDetail = lazy(loadPaymentDetail);
const CompanyAnalysis = lazy(loadCompanyAnalysis);
const Glosas = lazy(loadGlosas);
const Rules = lazy(loadRules);
const ValidationRules = lazy(loadValidationRules);
const ReferenceTables = lazy(loadReferenceTables);
const RuleSimulator = lazy(loadRuleSimulator);
const Users = lazy(loadUsers);
const Invoices = lazy(loadInvoices);
const InvoicePortal = lazy(loadInvoicePortal);
const Companies = lazy(loadCompanies);
const CompanyAliases = lazy(loadCompanyAliases);
const Doctors = lazy(loadDoctors);
const ProcedureSpecialtyMap = lazy(loadProcedureSpecialtyMap);
const Sectors = lazy(loadSectors);
const CostCenters = lazy(loadCostCenters);
const PaymentTypes = lazy(loadPaymentTypes);
const Pools = lazy(loadPools);
const PoolsReport = lazy(loadPoolsReport);
const Profile = lazy(loadProfile);
const AuditLog = lazy(loadAuditLog);
const StatusAnomalies = lazy(loadStatusAnomalies);
const SlaSettings = lazy(loadSlaSettings);
const PreviewPalettes = lazy(loadPreviewPalettes);
const PreviewDesignSystems = lazy(loadPreviewDesignSystems);
const WcagAudit = lazy(loadWcagAudit);
const Kpis = lazy(loadKpis);
const SidebarDiagnostic = lazy(loadSidebarDiagnostic);
const OverflowAudit = lazy(loadOverflowAudit);
const FinancialIntelligence = lazy(loadFinancialIntelligence);
const NfCycle = lazy(loadNfCycle);
const ObservationInsights = lazy(loadObservationInsights);
const AnalystProductivity = lazy(loadAnalystProductivity);
const About = lazy(loadAbout);
const SystemReleases = lazy(loadSystemReleases);
const FeatureFlagsAdmin = lazy(loadFeatureFlagsAdmin);
const SystemAnnouncementsAdmin = lazy(loadSystemAnnouncementsAdmin);
const FinancialJournal = lazy(loadFinancialJournal);
const DreReport = lazy(loadDreReport);
const MoneyHealth = lazy(loadMoneyHealth);
const BusinessObservability = lazy(loadBusinessObservability);
const Pendencias = lazy(loadPendencias);

// Defaults agressivos de cache: evita refetch a cada navegação entre telas,
// mantém os dados "frescos" por 60s e os mantém no cache por 10 min após
// desmontagem (atravessa idas e vindas entre menus sem trip ao servidor).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

// Loader simplificado para o Suspense
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

// Pré-carrega os bundles das telas mais usadas em tempo ocioso, em ondas,
// para que o clique no menu não precise baixar o chunk JS naquele instante.
// Sem isso, cada primeira visita a uma tela espera o download do bundle.
const IdlePrefetcher = () => {
  useEffect(() => {
    const idle: (cb: () => void, opts?: { timeout?: number }) => number =
      (window as any).requestIdleCallback?.bind(window) ??
      ((cb: () => void) => window.setTimeout(cb, 1500) as unknown as number);

    // Ondas: as mais usadas primeiro, depois cadastros, por último relatórios.
    const waves: Array<Array<() => Promise<unknown>>> = [
      [loadPayments, loadPaymentDetail, loadDashboard, loadNfCycle, loadInvoices],
      [loadGlosas, loadCompanies, loadDoctors, loadCompanyAnalysis, loadNewPayment],
      [loadRules, loadValidationRules, loadReferenceTables, loadCostCenters, loadPaymentTypes],
      [loadKpis, loadFinancialIntelligence, loadAgingRecebiveis, loadExecutiveDashboard, loadAnalystProductivity],
      [loadSectors, loadProcedureSpecialtyMap, loadCompanyAliases, loadPools, loadPoolsReport],
      [loadProfile, loadUsers, loadSlaSettings, loadAuditLog, loadStatusAnomalies, loadObservationInsights, loadHealthMonitoring],
    ];

    let waveIndex = 0;
    const runNext = () => {
      if (waveIndex >= waves.length) return;
      const wave = waves[waveIndex++];
      idle(
        () => {
          // Dispara em paralelo dentro da onda; ignora erros silenciosamente.
          wave.forEach((fn) => { fn().catch(() => {}); });
          runNext();
        },
        { timeout: 2500 },
      );
    };
    // Espera o "primeiro paint útil" antes de começar.
    const kickoff = window.setTimeout(runNext, 1200);
    return () => window.clearTimeout(kickoff);
  }, []);
  return null;
};


const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <NavLayoutProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
          <IdlePrefetcher />
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>

              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/reset-password" element={<SetPassword />} />
                <Route path="/definir-senha" element={<SetPassword />} />
                <Route path="/reset-password" element={<SetPassword />} />
                <Route path="/portal/nota/:token" element={<InvoicePortal />} />
                <Route path="/trocar-senha" element={<ForceChangePassword />} />
                <Route path="/preview-paletas" element={<PreviewPalettes />} />
                <Route path="/preview-design-systems" element={<PreviewDesignSystems />} />
                
                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/pagamentos" element={<Payments />} />
                  <Route path="/perfil" element={<Profile />} />
                  <Route path="/pagamentos/novo" element={<ProtectedRoute roles={["analista", "admin", "diretor"]}><NewPayment /></ProtectedRoute>} />
                  <Route path="/pagamentos/:id" element={<PaymentDetail />} />
                  <Route path="/pagamentos/:id/empresa/:groupId" element={<CompanyAnalysis />} />
                  <Route path="/notas-fiscais" element={<Invoices />} />
                  <Route path="/kpis" element={<Kpis />} />
                  <Route path="/executivo" element={<ProtectedRoute roles={["diretor", "admin"]}><ExecutiveDashboard /></ProtectedRoute>} />
                  <Route path="/recebiveis" element={<ProtectedRoute roles={["diretor", "admin", "analista"]}><AgingRecebiveis /></ProtectedRoute>} />
                  <Route path="/inteligencia-financeira" element={<FinancialIntelligence />} />
                  <Route path="/ciclo-nf" element={<NfCycle />} />
                  <Route path="/glosas" element={<ProtectedRoute roles={["diretor", "admin", "analista"]}><Glosas /></ProtectedRoute>} />
                  <Route path="/pendencias" element={<Pendencias />} />
                  <Route path="/saude" element={<ProtectedRoute roles={["diretor", "admin"]}><HealthMonitoring /></ProtectedRoute>} />
                  <Route path="/regras" element={<ProtectedRoute roles={["diretor", "admin"]}><Rules /></ProtectedRoute>} />
                  <Route path="/regras/pagamento" element={<ProtectedRoute roles={["diretor", "admin"]}><Rules /></ProtectedRoute>} />
                  <Route path="/regras/validacao" element={<ProtectedRoute roles={["diretor", "admin"]}><ValidationRules /></ProtectedRoute>} />
                  <Route path="/regras/simulador" element={<ProtectedRoute roles={["diretor", "admin"]}><RuleSimulator /></ProtectedRoute>} />
                  <Route path="/tabelas" element={<ProtectedRoute roles={["diretor", "admin"]}><ReferenceTables /></ProtectedRoute>} />
                  
                  <Route path="/empresas" element={<ProtectedRoute roles={["diretor", "admin"]}><Companies /></ProtectedRoute>} />
                  <Route path="/empresas/apelidos" element={<ProtectedRoute roles={["diretor", "admin"]}><CompanyAliases /></ProtectedRoute>} />
                  <Route path="/medicos" element={<ProtectedRoute roles={["diretor", "admin"]}><Doctors /></ProtectedRoute>} />
                  <Route path="/mapa-especialidades" element={<ProtectedRoute roles={["diretor", "admin"]}><ProcedureSpecialtyMap /></ProtectedRoute>} />
                  <Route path="/setores" element={<ProtectedRoute roles={["diretor", "admin"]}><Sectors /></ProtectedRoute>} />
                  <Route path="/centros-de-custo" element={<CostCenters />} />
                  <Route path="/tipos-pagamento" element={<ProtectedRoute roles={["diretor", "admin"]}><PaymentTypes /></ProtectedRoute>} />
                  <Route path="/pools" element={<ProtectedRoute roles={["diretor", "admin"]}><Pools /></ProtectedRoute>} />
                  <Route path="/pools/relatorios" element={<ProtectedRoute roles={["diretor", "admin"]}><PoolsReport /></ProtectedRoute>} />
                  <Route path="/prazos-sla" element={<ProtectedRoute roles={["diretor", "admin"]}><SlaSettings /></ProtectedRoute>} />
                  <Route path="/usuarios" element={<ProtectedRoute roles={["admin"]}><Users /></ProtectedRoute>} />
                  <Route path="/produtividade-analistas" element={<ProtectedRoute roles={["diretor", "admin"]}><AnalystProductivity /></ProtectedRoute>} />
                  
                  <Route path="/auditoria" element={<ProtectedRoute roles={["diretor", "admin"]}><AuditLog /></ProtectedRoute>} />
                  <Route path="/anomalias-status" element={<ProtectedRoute roles={["diretor", "admin"]}><StatusAnomalies /></ProtectedRoute>} />
                  <Route path="/insights-observacoes" element={<ProtectedRoute roles={["diretor", "admin"]}><ObservationInsights /></ProtectedRoute>} />
                  <Route path="/sobre" element={<About />} />
                  <Route path="/sistema/versoes" element={<ProtectedRoute roles={["admin", "diretor"]}><SystemReleases /></ProtectedRoute>} />
                  <Route path="/sistema/feature-flags" element={<ProtectedRoute roles={["admin", "diretor"]}><FeatureFlagsAdmin /></ProtectedRoute>} />
                  <Route path="/sistema/avisos" element={<ProtectedRoute roles={["admin", "diretor"]}><SystemAnnouncementsAdmin /></ProtectedRoute>} />
                  <Route path="/sistema/journal" element={<ProtectedRoute roles={["admin", "diretor"]}><FinancialJournal /></ProtectedRoute>} />
                  <Route path="/relatorios/dre" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><DreReport /></ProtectedRoute>} />
                  <Route path="/relatorios/saude-dinheiro" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><MoneyHealth /></ProtectedRoute>} />
                  <Route path="/relatorios/observabilidade" element={<ProtectedRoute roles={["diretor", "admin"]}><BusinessObservability /></ProtectedRoute>} />
                  <Route path="/wcag-audit" element={<WcagAudit />} />
                  <Route path="/diagnostico/sidebar" element={<SidebarDiagnostic />} />
                  <Route path="/diagnostico/overflow" element={<OverflowAudit />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
      </NavLayoutProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
