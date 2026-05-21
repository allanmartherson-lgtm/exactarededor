import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
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

// Lazy loaded feature pages
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const ExecutiveDashboard = lazy(() => import("./pages/ExecutiveDashboard.tsx"));
const AgingRecebiveis = lazy(() => import("./pages/AgingRecebiveis.tsx"));
const HealthMonitoring = lazy(() => import("./pages/HealthMonitoring.tsx"));
const Payments = lazy(() => import("./pages/Payments.tsx"));
const NewPayment = lazy(() => import("./pages/NewPayment.tsx"));
const PaymentDetail = lazy(() => import("./pages/PaymentDetail.tsx"));
const CompanyAnalysis = lazy(() => import("./pages/CompanyAnalysis.tsx"));
const Glosas = lazy(() => import("./pages/Glosas.tsx"));
const Rules = lazy(() => import("./pages/Rules.tsx"));
const ValidationRules = lazy(() => import("./pages/ValidationRules.tsx"));
const ReferenceTables = lazy(() => import("./pages/ReferenceTables.tsx"));
const RuleSimulator = lazy(() => import("./pages/RuleSimulator.tsx"));
const Users = lazy(() => import("./pages/Users.tsx"));
const Invoices = lazy(() => import("./pages/Invoices.tsx"));
const InvoicePortal = lazy(() => import("./pages/InvoicePortal.tsx"));
const Companies = lazy(() => import("./pages/Companies.tsx"));
const CompanyAliases = lazy(() => import("./pages/CompanyAliases.tsx"));
const Doctors = lazy(() => import("./pages/Doctors.tsx"));
const ProcedureSpecialtyMap = lazy(() => import("./pages/ProcedureSpecialtyMap.tsx"));
const Sectors = lazy(() => import("./pages/Sectors.tsx"));
const CostCenters = lazy(() => import("./pages/CostCenters.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const AuditLog = lazy(() => import("./pages/AuditLog.tsx"));
const StatusAnomalies = lazy(() => import("./pages/StatusAnomalies.tsx"));
const SlaSettings = lazy(() => import("./pages/SlaSettings.tsx"));
const WcagAudit = lazy(() => import("./pages/WcagAudit.tsx"));
const Kpis = lazy(() => import("./pages/Kpis.tsx"));
const SidebarDiagnostic = lazy(() => import("./pages/SidebarDiagnostic.tsx"));
const OverflowAudit = lazy(() => import("./pages/OverflowAudit.tsx"));

const queryClient = new QueryClient();

// Loader simplificado para o Suspense
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <NavLayoutProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/reset-password" element={<SetPassword />} />
                <Route path="/definir-senha" element={<SetPassword />} />
                <Route path="/reset-password" element={<SetPassword />} />
                <Route path="/portal/nota/:token" element={<InvoicePortal />} />
                <Route path="/trocar-senha" element={<ForceChangePassword />} />
                
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
                  <Route path="/prazos-sla" element={<ProtectedRoute roles={["diretor", "admin"]}><SlaSettings /></ProtectedRoute>} />
                  <Route path="/usuarios" element={<ProtectedRoute roles={["admin"]}><Users /></ProtectedRoute>} />
                  
                  <Route path="/auditoria" element={<ProtectedRoute roles={["diretor", "admin"]}><AuditLog /></ProtectedRoute>} />
                  <Route path="/anomalias-status" element={<ProtectedRoute roles={["diretor", "admin"]}><StatusAnomalies /></ProtectedRoute>} />
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
