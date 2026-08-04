import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { HospitalProvider } from "./contexts/HospitalContext.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";
import { NavLayoutProvider } from "./contexts/NavLayoutContext.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { AppLayout } from "./components/AppLayout.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { HospitalSwitchingOverlay } from "./components/HospitalSwitchingOverlay.tsx";

// Mount precisa estar DENTRO do <HospitalProvider> para acessar o context.
const HospitalSwitchingOverlayMount = () => <HospitalSwitchingOverlay />;

// Eagerly loaded critical pages
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import SetPassword from "./pages/SetPassword.tsx";
import ForceChangePassword from "./pages/ForceChangePassword.tsx";
import OAuthConsent from "./pages/OAuthConsent.tsx";
import OAuthCallback from "./pages/OAuthCallback.tsx";

// Lazy loaded feature pages — importers ficam guardados em constantes
// para podermos dispará-los como prefetch em idle (ver IdlePrefetcher abaixo).
const loadDashboard = () => import("./pages/Dashboard.tsx");
const loadExecutiveDashboard = () => import("./pages/ExecutiveDashboard.tsx");
const loadBiDiretoria = () => import("./pages/BiDiretoria.tsx");
const loadBiPagamentos = () => import("./pages/BiPagamentos.tsx");
const loadBiLoteDetalhe = () => import("./pages/BiLoteDetalhe.tsx");
const loadAgingRecebiveis = () => import("./pages/AgingRecebiveis.tsx");
const loadHealthMonitoring = () => import("./pages/HealthMonitoring.tsx");
const loadPayments = () => import("./pages/Payments.tsx");
const loadNewPayment = () => import("./pages/NewPayment.tsx");
const loadNewManualPayment = () => import("./pages/NewManualPayment.tsx");
const loadNewManualPaymentComposicao = () => import("./pages/NewManualPaymentComposicao.tsx");
const loadManualPaymentEntry = () => import("./pages/ManualPaymentEntry.tsx");
const loadPaymentDetail = () => import("./pages/PaymentDetail.tsx");
const loadCompanyAnalysis = () => import("./pages/CompanyAnalysis.tsx");
const loadPoolAnalysis = () => import("./pages/PoolAnalysis.tsx");
const loadGlosas = () => import("./pages/Glosas.tsx");
const loadRules = () => import("./pages/Rules.tsx");
const loadValidationRules = () => import("./pages/ValidationRules.tsx");
const loadReferenceTables = () => import("./pages/ReferenceTables.tsx");
const loadRuleSimulator = () => import("./pages/RuleSimulator.tsx");
const loadRuleSimulatorBatch = () => import("./pages/RuleSimulatorBatch.tsx");
const loadUsers = () => import("./pages/Users.tsx");
const loadInvoices = () => import("./pages/Invoices.tsx");
const loadInvoicePortal = () => import("./pages/InvoicePortal.tsx");
const loadCompanies = () => import("./pages/Companies.tsx");
const loadCompanyAliases = () => import("./pages/CompanyAliases.tsx");
const loadLearnedPatterns = () => import("./pages/LearnedPatterns.tsx");
const loadDoctors = () => import("./pages/Doctors.tsx");
const loadProcedureSpecialtyMap = () => import("./pages/ProcedureSpecialtyMap.tsx");
const loadSectors = () => import("./pages/Sectors.tsx");
const loadConvenios = () => import("./pages/Convenios.tsx");
const loadCostCenters = () => import("./pages/CostCenters.tsx");
const loadPaymentTypes = () => import("./pages/PaymentTypes.tsx");
const loadPools = () => import("./pages/Pools.tsx");
const loadPoolsReport = () => import("./pages/PoolsReport.tsx");
const loadPoolsHub = () => import("./pages/PoolsHub.tsx");
const loadPoolMonthlyValues = () => import("./pages/PoolMonthlyValues.tsx");
const loadCreditosDebitos = () => import("./pages/CreditosDebitos.tsx");
const loadProfile = () => import("./pages/Profile.tsx");
const loadAuditLog = () => import("./pages/AuditLog.tsx");
const loadStatusAnomalies = () => import("./pages/StatusAnomalies.tsx");
const loadSlaSettings = () => import("./pages/SlaSettings.tsx");
const loadPreviewPalettes = () => import("./pages/PreviewPalettes.tsx");
const loadPreviewDesignSystems = () => import("./pages/PreviewDesignSystems.tsx");
const loadPreviewCura = () => import("./pages/PreviewCura.tsx");
const loadWcagAudit = () => import("./pages/WcagAudit.tsx");
const loadKpis = () => import("./pages/Kpis.tsx");
const loadInterventionAdjustments = () => import("./pages/InterventionAdjustments.tsx");

const loadInterventionAudit = () => import("./pages/InterventionAudit.tsx");
const loadOverlapAudit = () => import("./pages/OverlapAudit.tsx");
const loadCancelledPayments = () => import("./pages/CancelledPayments.tsx");
const loadInterventionReports = () => import("./pages/InterventionReports.tsx");
const loadLoteInterventionReport = () => import("./pages/LoteInterventionReport.tsx");
const loadSidebarDiagnostic = () => import("./pages/SidebarDiagnostic.tsx");
const loadOverflowAudit = () => import("./pages/OverflowAudit.tsx");
const loadFinancialIntelligence = () => import("./pages/FinancialIntelligence.tsx");
const loadNfCycle = () => import("./pages/NfCycle.tsx");
const loadNotasFiscaisHub = () => import("./pages/NotasFiscaisHub.tsx");
const loadObservationInsights = () => import("./pages/ObservationInsights.tsx");
const loadAnalystProductivity = () => import("./pages/AnalystProductivity.tsx");
const loadAbout = () => import("./pages/About.tsx");
const loadSystemReleases = () => import("./pages/SystemReleases.tsx");
const loadFeatureFlagsAdmin = () => import("./pages/FeatureFlagsAdmin.tsx");
const loadCopilotTelemetry = () => import("./pages/CopilotTelemetry.tsx");

const loadSystemAnnouncementsAdmin = () => import("./pages/SystemAnnouncementsAdmin.tsx");
const loadFinancialJournal = () => import("./pages/FinancialJournal.tsx");
const loadDreReport = () => import("./pages/DreReport.tsx");
const loadMoneyHealth = () => import("./pages/MoneyHealth.tsx");
const loadBusinessObservability = () => import("./pages/BusinessObservability.tsx");
const loadPendencias = () => import("./pages/Pendencias.tsx");
const loadSpecialCases = () => import("./pages/SpecialCases.tsx");
const loadSpecialCasesReport = () => import("./pages/SpecialCasesReport.tsx");
const loadSpecialCaseTypesAdmin = () => import("./pages/SpecialCaseTypesAdmin.tsx");
const loadSpecialCasesHub = () => import("./pages/SpecialCasesHub.tsx");
const loadConciliacao = () => import("./pages/Conciliacao.tsx");
const loadPendenciaDetail = () => import("./pages/PendenciaDetail.tsx");
const loadConversas = () => import("./pages/Conversas.tsx");
const loadSelectHospital = () => import("./pages/SelectHospital.tsx");
const loadPortalUsers = () => import("./pages/PortalUsers.tsx");
const loadPortalHealth = () => import("./pages/PortalHealth.tsx");
const loadHospitalSwitchLog = () => import("./pages/HospitalSwitchLog.tsx");
const loadApproveMagicLink = () => import("./pages/ApproveMagicLink.tsx");
const loadNotificationPreferences = () => import("./pages/NotificationPreferences.tsx");
const loadIntegrationsAdmin = () => import("./pages/IntegrationsAdmin.tsx");
const loadCommunicationSupervision = () => import("./pages/CommunicationSupervision.tsx");
const loadProcessHealth = () => import("./pages/ProcessHealth.tsx");
const loadMedicosHub = () => import("./pages/MedicosHub.tsx");
const loadDirectors = () => import("./pages/Directors.tsx");
const loadCadastrosHub = () => import("./pages/CadastrosHub.tsx");
const loadTussTable = () => import("./pages/TussTable.tsx");
const loadBatchPatterns = () => import("./pages/BatchPatterns.tsx");
const loadReportsCentral = () => import("./pages/ReportsCentral.tsx");
const loadExportAudit = () => import("./pages/ExportAudit.tsx");
const loadPaymentEvolution = () => import("./pages/PaymentEvolution.tsx");
const loadPaymentsBySpecialty = () => import("./pages/PaymentsBySpecialty.tsx");

const Dashboard = lazy(loadDashboard);
const ExecutiveDashboard = lazy(loadExecutiveDashboard);
const BiDiretoria = lazy(loadBiDiretoria);
const BiPagamentos = lazy(loadBiPagamentos);
const BiLoteDetalhe = lazy(loadBiLoteDetalhe);
const AgingRecebiveis = lazy(loadAgingRecebiveis);
const HealthMonitoring = lazy(loadHealthMonitoring);
const Payments = lazy(loadPayments);
const NewPayment = lazy(loadNewPayment);
const NewManualPayment = lazy(loadNewManualPayment);
const NewManualPaymentComposicao = lazy(loadNewManualPaymentComposicao);
const ManualPaymentEntry = lazy(loadManualPaymentEntry);
const PaymentDetail = lazy(loadPaymentDetail);
const CompanyAnalysis = lazy(loadCompanyAnalysis);
const PoolAnalysis = lazy(loadPoolAnalysis);
const Glosas = lazy(loadGlosas);
const Rules = lazy(loadRules);
const ValidationRules = lazy(loadValidationRules);
const ReferenceTables = lazy(loadReferenceTables);
const RuleSimulator = lazy(loadRuleSimulator);
const RuleSimulatorBatch = lazy(loadRuleSimulatorBatch);
const Users = lazy(loadUsers);
const Invoices = lazy(loadInvoices);
const InvoicePortal = lazy(loadInvoicePortal);
const Companies = lazy(loadCompanies);
const CompanyAliases = lazy(loadCompanyAliases);
const LearnedPatterns = lazy(loadLearnedPatterns);
const Doctors = lazy(loadDoctors);
const ProcedureSpecialtyMap = lazy(loadProcedureSpecialtyMap);
const MedicosHub = lazy(loadMedicosHub);
const Directors = lazy(loadDirectors);
const CadastrosHub = lazy(loadCadastrosHub);
const TussTable = lazy(loadTussTable);
const BatchPatterns = lazy(loadBatchPatterns);
const Sectors = lazy(loadSectors);
const Convenios = lazy(loadConvenios);
const CostCenters = lazy(loadCostCenters);
const PaymentTypes = lazy(loadPaymentTypes);
const Pools = lazy(loadPools);
const PoolsReport = lazy(loadPoolsReport);
const PoolsHub = lazy(loadPoolsHub);
const PoolMonthlyValues = lazy(loadPoolMonthlyValues);
const CreditosDebitos = lazy(loadCreditosDebitos);
const Profile = lazy(loadProfile);
const AuditLog = lazy(loadAuditLog);
const StatusAnomalies = lazy(loadStatusAnomalies);
const SlaSettings = lazy(loadSlaSettings);
const HospitaisHub = lazy(() => import("./pages/HospitaisHub.tsx"));
const PreviewPalettes = lazy(loadPreviewPalettes);
const PreviewDesignSystems = lazy(loadPreviewDesignSystems);
const PreviewCura = lazy(loadPreviewCura);
const WcagAudit = lazy(loadWcagAudit);
const Kpis = lazy(loadKpis);
const InterventionAdjustments = lazy(loadInterventionAdjustments);

const InterventionAudit = lazy(loadInterventionAudit);
const OverlapAudit = lazy(loadOverlapAudit);
const CancelledPayments = lazy(loadCancelledPayments);
const InterventionReports = lazy(loadInterventionReports);
const LoteInterventionReport = lazy(loadLoteInterventionReport);
const SidebarDiagnostic = lazy(loadSidebarDiagnostic);
const OverflowAudit = lazy(loadOverflowAudit);
const FinancialIntelligence = lazy(loadFinancialIntelligence);
const NfCycle = lazy(loadNfCycle);
const NotasFiscaisHub = lazy(loadNotasFiscaisHub);
const ObservationInsights = lazy(loadObservationInsights);
const AnalystProductivity = lazy(loadAnalystProductivity);
const About = lazy(loadAbout);
const SystemReleases = lazy(loadSystemReleases);
const FeatureFlagsAdmin = lazy(loadFeatureFlagsAdmin);
const CopilotTelemetry = lazy(loadCopilotTelemetry);

const SystemAnnouncementsAdmin = lazy(loadSystemAnnouncementsAdmin);
const FinancialJournal = lazy(loadFinancialJournal);
const DreReport = lazy(loadDreReport);
const MoneyHealth = lazy(loadMoneyHealth);
const BusinessObservability = lazy(loadBusinessObservability);
const Pendencias = lazy(loadPendencias);
const SpecialCases = lazy(loadSpecialCases);
const SpecialCasesReport = lazy(loadSpecialCasesReport);
const SpecialCaseTypesAdmin = lazy(loadSpecialCaseTypesAdmin);
const SpecialCasesHub = lazy(loadSpecialCasesHub);
const Conciliacao = lazy(loadConciliacao);
const PendenciaDetail = lazy(loadPendenciaDetail);
const Conversas = lazy(loadConversas);
const MassCommunication = lazy(() => import("./pages/MassCommunication.tsx"));
const CampaignApprovalQueue = lazy(() => import("./pages/CampaignApprovalQueue.tsx"));
const NotificationsInbox = lazy(() => import("./pages/NotificationsInbox.tsx"));
const SelectHospital = lazy(loadSelectHospital);
const PortalUsers = lazy(loadPortalUsers);
const PortalHealth = lazy(loadPortalHealth);
const HospitalSwitchLog = lazy(loadHospitalSwitchLog);
const ApproveMagicLink = lazy(loadApproveMagicLink);
const NotificationPreferences = lazy(loadNotificationPreferences);
const IntegrationsAdmin = lazy(loadIntegrationsAdmin);
const CommunicationSupervision = lazy(loadCommunicationSupervision);
const ProcessHealth = lazy(loadProcessHealth);
const ReportsCentral = lazy(loadReportsCentral);
const ExportAudit = lazy(loadExportAudit);
const PaymentEvolution = lazy(loadPaymentEvolution);
const PaymentsBySpecialty = lazy(loadPaymentsBySpecialty);
const AuditoriaTussPrincipal = lazy(() => import("./pages/AuditoriaTussPrincipal.tsx"));
const AuditoriaHub = lazy(() => import("./pages/AuditoriaHub.tsx"));
const BatchTotalsAudit = lazy(() => import("./pages/BatchTotalsAudit.tsx"));
const SaudeHub = lazy(() => import("./pages/SaudeHub.tsx"));
const ComunicacaoHub = lazy(() => import("./pages/ComunicacaoHub.tsx"));
const loadRelacionamentoHub = () => import("./pages/RelacionamentoHub.tsx");
const RelacionamentoHub = lazy(loadRelacionamentoHub);
const RegrasHub = lazy(() => import("./pages/RegrasHub.tsx"));
const SistemaHub = lazy(() => import("./pages/SistemaHub.tsx"));
const SystemParameters = lazy(() => import("./pages/SystemParameters.tsx"));
const ManualInterventionReasonsPage = lazy(() => import("./pages/ManualInterventionReasons.tsx"));

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
      <TooltipProvider>
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
          <NavLayoutProvider>
          <HospitalProvider>
          <IdlePrefetcher />
          <HospitalSwitchingOverlayMount />
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>

              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<OAuthCallback />} />
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                <Route path="/auth/reset-password" element={<SetPassword />} />
                <Route path="/definir-senha" element={<SetPassword />} />
                <Route path="/reset-password" element={<SetPassword />} />
                <Route path="/portal/nota/:token" element={<InvoicePortal />} />
                <Route path="/aprovar/:token" element={<ApproveMagicLink />} />
                <Route path="/trocar-senha" element={<ForceChangePassword />} />
                <Route path="/preview-paletas" element={<PreviewPalettes />} />
                <Route path="/preview-design-systems" element={<PreviewDesignSystems />} />
                <Route path="/preview-cura" element={<PreviewCura />} />
                <Route path="/selecionar-hospital" element={<ProtectedRoute><SelectHospital /></ProtectedRoute>} />
                
                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/pagamentos" element={<Payments />} />
                  <Route path="/perfil" element={<Profile />} />
                  <Route path="/pagamentos/novo" element={<ProtectedRoute roles={["analista", "admin", "diretor"]}><NewPayment /></ProtectedRoute>} />
                  <Route path="/pagamentos/novo-manual" element={<ProtectedRoute roles={["analista", "admin", "diretor"]}><NewManualPayment /></ProtectedRoute>} />
                  <Route path="/pagamentos/novo-manual-modelo" element={<ProtectedRoute roles={["analista", "admin", "diretor"]}><NewManualPaymentComposicao /></ProtectedRoute>} />
                  <Route path="/pagamentos/:id/manual" element={<ProtectedRoute roles={["analista", "admin", "diretor"]}><ManualPaymentEntry /></ProtectedRoute>} />
                  <Route path="/pagamentos/:id/intervencoes" element={<ProtectedRoute roles={["diretor", "admin", "validador", "analista"]}><LoteInterventionReport /></ProtectedRoute>} />
                  <Route path="/pagamentos/:id" element={<PaymentDetail />} />
                  <Route path="/pagamentos/:id/empresa/:groupId" element={<CompanyAnalysis />} />
                  <Route path="/pagamentos/:id/pool" element={<PoolAnalysis />} />
                  <Route path="/notas-fiscais" element={<NotasFiscaisHub />} />
                  <Route path="/kpis" element={<Kpis />} />
                  <Route path="/relatorios/intervencoes" element={<ProtectedRoute roles={["diretor", "admin", "validador", "analista"]}><InterventionReports /></ProtectedRoute>} />
                  <Route path="/auditoria/sobreposicao-assistencial" element={<ProtectedRoute roles={["diretor", "admin", "validador", "analista"]}><OverlapAudit /></ProtectedRoute>} />
                  {/* Compat: rotas antigas redirecionam para a página unificada com a view correta */}
                  <Route path="/relatorios/ajustes-intervencao" element={<Navigate to="/relatorios/intervencoes?view=ajustes" replace />} />
                  <Route path="/relatorios/correcoes-analista" element={<Navigate to="/relatorios/intervencoes?view=ajustes&papel=analista" replace />} />
                  <Route path="/relatorios/auditoria-intervencao" element={<Navigate to="/relatorios/intervencoes?view=auditoria" replace />} />
                  <Route path="/relatorios/pagamentos-cancelados" element={<Navigate to="/relatorios/intervencoes?view=ajustes&role=cancelamento_empresa" replace />} />
                  <Route path="/relatorios/central" element={<ReportsCentral />} />
                  <Route path="/relatorios/auditoria-exportacoes" element={<Navigate to="/auditoria?tab=exportacoes" replace />} />
                  <Route path="/relatorios/evolucao-pagamentos" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><PaymentEvolution /></ProtectedRoute>} />
                  <Route path="/relatorios/pagamentos-por-especialidade" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><PaymentsBySpecialty /></ProtectedRoute>} />
                  <Route path="/executivo" element={<Navigate to="/inteligencia-financeira" replace />} />
                  <Route path="/bi/diretoria" element={<BiDiretoria />} />
                  <Route path="/bi/pagamentos" element={<BiPagamentos />} />
                  <Route path="/bi/lote/:id" element={<BiLoteDetalhe />} />
                  <Route path="/bi/lote" element={<BiLoteDetalhe />} />
                  <Route path="/recebiveis" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><AgingRecebiveis /></ProtectedRoute>} />
                  <Route path="/inteligencia-financeira" element={<FinancialIntelligence />} />
                  <Route path="/ciclo-nf" element={<Navigate to="/notas-fiscais" replace />} />
                  <Route path="/glosas" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><Glosas /></ProtectedRoute>} />
                  <Route path="/financeiro/conciliacao" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><Conciliacao /></ProtectedRoute>} />
                  <Route path="/pendencias" element={<Pendencias />} />
                  <Route path="/pendencias/:id" element={<PendenciaDetail />} />
                  <Route path="/casos-especiais" element={<ProtectedRoute roles={["admin", "diretor", "analista", "validador", "gestao_medica"]}><SpecialCasesHub /></ProtectedRoute>} />
                  <Route path="/casos-especiais/relatorio" element={<Navigate to="/casos-especiais?tab=relatorio" replace />} />
                  <Route path="/admin/tipos-caso-especial" element={<Navigate to="/casos-especiais?tab=tipos" replace />} />
                  <Route path="/conversas" element={<Conversas />} />
                  <Route path="/comunicacao" element={<ProtectedRoute roles={["admin", "diretor", "analista", "validador"]}><ComunicacaoHub /></ProtectedRoute>} />
                  <Route path="/comunicacao/massa" element={<Navigate to="/comunicacao?tab=massa" replace />} />
                  <Route path="/comunicacao/aprovacoes" element={<Navigate to="/comunicacao?tab=aprovacoes" replace />} />
                  <Route path="/comunicacao/supervisao" element={<Navigate to="/comunicacao?tab=supervisao" replace />} />
                  <Route path="/relacionamento" element={<ProtectedRoute><RelacionamentoHub /></ProtectedRoute>} />

                  <Route path="/notificacoes" element={<ProtectedRoute><NotificationsInbox /></ProtectedRoute>} />
                  <Route path="/saude" element={<ProtectedRoute roles={["diretor", "admin"]}><SaudeHub /></ProtectedRoute>} />
                  <Route path="/regras" element={<ProtectedRoute roles={["diretor", "admin"]}><RegrasHub /></ProtectedRoute>} />
                  <Route path="/regras/pagamento" element={<Navigate to="/regras?tab=pagamento" replace />} />
                  <Route path="/regras/validacao" element={<Navigate to="/regras?tab=validacao" replace />} />
                  <Route path="/regras/simulador" element={<Navigate to="/regras?tab=simulador" replace />} />
                  <Route path="/regras/simulador-lote" element={<Navigate to="/regras?tab=simulador-lote" replace />} />
                  <Route path="/tabelas" element={<ProtectedRoute roles={["diretor", "admin"]}><ReferenceTables /></ProtectedRoute>} />
                  
                  <Route path="/cadastros" element={<ProtectedRoute roles={["diretor", "admin"]}><CadastrosHub /></ProtectedRoute>} />
                  <Route path="/padroes-lote" element={<ProtectedRoute roles={["diretor", "admin", "analista"]}><BatchPatterns /></ProtectedRoute>} />
                  <Route path="/empresas" element={<Navigate to="/cadastros?tab=empresas" replace />} />
                  <Route path="/empresas/apelidos" element={<ProtectedRoute roles={["diretor", "admin"]}><CompanyAliases /></ProtectedRoute>} />
                  <Route path="/aprendizado/padroes" element={<ProtectedRoute roles={["diretor", "admin", "analista"]}><LearnedPatterns /></ProtectedRoute>} />
                  <Route path="/medicos" element={<Navigate to="/cadastros?tab=medicos" replace />} />
                  <Route path="/diretores" element={<ProtectedRoute roles={["diretor", "admin"]}><Directors /></ProtectedRoute>} />
                  <Route path="/mapa-especialidades" element={<Navigate to="/cadastros?tab=mapa-especialidades" replace />} />
                  <Route path="/setores" element={<Navigate to="/cadastros?tab=centros-de-custo" replace />} />
                  <Route path="/convenios" element={<Navigate to="/cadastros?tab=convenios" replace />} />
                  <Route path="/centros-de-custo" element={<Navigate to="/cadastros?tab=centros-de-custo" replace />} />
                  <Route path="/tipos-pagamento" element={<Navigate to="/cadastros?tab=tipos-pagamento" replace />} />
                  <Route path="/payment-types" element={<Navigate to="/cadastros?tab=tipos-pagamento" replace />} />
                  <Route path="/modelos-pagamento" element={<Navigate to="/cadastros?tab=modelos-pagamento" replace />} />
                  <Route path="/payment-models" element={<Navigate to="/cadastros?tab=modelos-pagamento" replace />} />
                  <Route path="/tipos-item" element={<Navigate to="/cadastros?tab=tipos-item" replace />} />
                  <Route path="/item-types" element={<Navigate to="/cadastros?tab=tipos-item" replace />} />
                  <Route path="/pools" element={<ProtectedRoute roles={["diretor", "admin"]}><PoolsHub /></ProtectedRoute>} />
                  <Route path="/pools/:id/valores-mensais" element={<ProtectedRoute roles={["diretor", "admin"]}><PoolMonthlyValues /></ProtectedRoute>} />
                  <Route path="/pools/relatorios" element={<Navigate to="/pools" replace />} />
                  <Route path="/financeiro/creditos-debitos" element={<ProtectedRoute roles={["diretor", "admin", "analista", "validador"]}><CreditosDebitos /></ProtectedRoute>} />
                  <Route path="/prazos-sla" element={<ProtectedRoute roles={["diretor", "admin"]}><SlaSettings /></ProtectedRoute>} />
                  <Route path="/configuracoes/piso-repasse" element={<Navigate to="/hospitais" replace />} />
                  <Route path="/configuracoes/tabela-tuss" element={<ProtectedRoute roles={["diretor", "admin"]}><TussTable /></ProtectedRoute>} />
                  <Route path="/configuracoes/motivos-intervencao" element={<ProtectedRoute roles={["admin", "diretor"]}><ManualInterventionReasonsPage /></ProtectedRoute>} />
                  <Route path="/usuarios" element={<ProtectedRoute roles={["admin"]}><Users /></ProtectedRoute>} />
                  <Route path="/hospitais" element={<ProtectedRoute roles={["admin", "diretor"]}><HospitaisHub /></ProtectedRoute>} />
                  <Route path="/hospitals" element={<Navigate to="/hospitais" replace />} />

                  <Route path="/portal-usuarios" element={<ProtectedRoute roles={["admin"]}><PortalUsers /></ProtectedRoute>} />
                  <Route path="/portal-saude" element={<Navigate to="/saude?tab=portais" replace />} />
                  <Route path="/produtividade-analistas" element={<Navigate to="/saude-processo" replace />} />
                  <Route path="/saude-processo" element={<Navigate to="/saude?tab=processo" replace />} />
                  
                  <Route path="/auditoria" element={<ProtectedRoute roles={["diretor", "admin", "validador"]}><AuditoriaHub /></ProtectedRoute>} />
                  <Route path="/auditoria/totais-lote" element={<ProtectedRoute roles={["diretor", "admin", "validador", "analista"]}><BatchTotalsAudit /></ProtectedRoute>} />
                  <Route path="/auditoria/hospitais" element={<Navigate to="/auditoria?tab=hospitais" replace />} />
                  <Route path="/auditoria/tuss-principal" element={<Navigate to="/auditoria?tab=tuss" replace />} />
                  <Route path="/anomalias-status" element={<Navigate to="/auditoria?tab=anomalias" replace />} />
                  <Route path="/insights-observacoes" element={<Navigate to="/auditoria?tab=insights" replace />} />
                  <Route path="/sobre" element={<About />} />
                  <Route path="/sistema" element={<ProtectedRoute roles={["admin", "diretor"]}><SistemaHub /></ProtectedRoute>} />
                  <Route path="/parametros" element={<Navigate to="/sistema?tab=parametros" replace />} />
                  <Route path="/sistema/parametros" element={<Navigate to="/sistema?tab=parametros" replace />} />
                  <Route path="/sistema/versoes" element={<Navigate to="/sistema?tab=versoes" replace />} />
                  <Route path="/sistema/feature-flags" element={<Navigate to="/sistema?tab=feature-flags" replace />} />
                  <Route path="/sistema/copiloto-telemetria" element={<Navigate to="/sistema?tab=copiloto" replace />} />
                  <Route path="/sistema/avisos" element={<Navigate to="/sistema?tab=avisos" replace />} />
                  <Route path="/sistema/journal" element={<ProtectedRoute roles={["admin", "diretor"]}><FinancialJournal /></ProtectedRoute>} />
                  <Route path="/relatorios/dre" element={<Navigate to="/inteligencia-financeira" replace />} />
                  <Route path="/relatorios/saude-dinheiro" element={<Navigate to="/inteligencia-financeira" replace />} />
                  <Route path="/relatorios/observabilidade" element={<Navigate to="/saude-processo" replace />} />
                  <Route path="/sistema/integracoes" element={<Navigate to="/comunicacao?tab=integracoes" replace />} />
                  <Route path="/configuracoes/notificacoes" element={<NotificationPreferences />} />
                  <Route path="/wcag-audit" element={<WcagAudit />} />
                  <Route path="/diagnostico/sidebar" element={<SidebarDiagnostic />} />
                  <Route path="/diagnostico/overflow" element={<OverflowAudit />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
          </HospitalProvider>
          </NavLayoutProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
