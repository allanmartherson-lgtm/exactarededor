import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import SetPassword from "./pages/SetPassword.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Payments from "./pages/Payments.tsx";
import NewPayment from "./pages/NewPayment.tsx";
import PaymentDetail from "./pages/PaymentDetail.tsx";
import CompanyAnalysis from "./pages/CompanyAnalysis.tsx";
import Rules from "./pages/Rules.tsx";
import ValidationRules from "./pages/ValidationRules.tsx";
import ReferenceTables from "./pages/ReferenceTables.tsx";
import ProcedureClassifications from "./pages/ProcedureClassifications.tsx";
import Users from "./pages/Users.tsx";
import Invoices from "./pages/Invoices.tsx";
import InvoicePortal from "./pages/InvoicePortal.tsx";
import Companies from "./pages/Companies.tsx";
import Doctors from "./pages/Doctors.tsx";
import CostCenters from "./pages/CostCenters.tsx";
import AuditLog from "./pages/AuditLog.tsx";
import SlaSettings from "./pages/SlaSettings.tsx";
import WcagAudit from "./pages/WcagAudit.tsx";
import Kpis from "./pages/Kpis.tsx";
import SidebarDiagnostic from "./pages/SidebarDiagnostic.tsx";
import OverflowAudit from "./pages/OverflowAudit.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";
import { NavLayoutProvider } from "./contexts/NavLayoutContext.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { AppLayout } from "./components/AppLayout.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <NavLayoutProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
          <ErrorBoundary>
            <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/definir-senha" element={<SetPassword />} />
            <Route path="/reset-password" element={<SetPassword />} />
            <Route path="/portal/nota/:token" element={<InvoicePortal />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pagamentos" element={<Payments />} />
              <Route path="/pagamentos/novo" element={<ProtectedRoute roles={["analista", "admin", "diretor"]}><NewPayment /></ProtectedRoute>} />
              <Route path="/pagamentos/:id" element={<PaymentDetail />} />
              <Route path="/pagamentos/:id/empresa/:groupId" element={<CompanyAnalysis />} />
              <Route path="/notas-fiscais" element={<Invoices />} />
              <Route path="/kpis" element={<Kpis />} />
              <Route path="/regras" element={<ProtectedRoute roles={["diretor", "admin"]}><Rules /></ProtectedRoute>} />
              <Route path="/regras/pagamento" element={<ProtectedRoute roles={["diretor", "admin"]}><Rules /></ProtectedRoute>} />
              <Route path="/regras/validacao" element={<ProtectedRoute roles={["diretor", "admin"]}><ValidationRules /></ProtectedRoute>} />
              <Route path="/tabelas" element={<ProtectedRoute roles={["diretor", "admin"]}><ReferenceTables /></ProtectedRoute>} />
              <Route path="/classificacao-procedimentos" element={<ProtectedRoute roles={["diretor", "admin"]}><ProcedureClassifications /></ProtectedRoute>} />
              <Route path="/empresas" element={<ProtectedRoute roles={["diretor", "admin"]}><Companies /></ProtectedRoute>} />
              <Route path="/medicos" element={<ProtectedRoute roles={["diretor", "admin"]}><Doctors /></ProtectedRoute>} />
              <Route path="/centros-de-custo" element={<CostCenters />} />
              <Route path="/prazos-sla" element={<ProtectedRoute roles={["diretor", "admin"]}><SlaSettings /></ProtectedRoute>} />
              <Route path="/usuarios" element={<ProtectedRoute roles={["admin"]}><Users /></ProtectedRoute>} />
              <Route path="/auditoria" element={<ProtectedRoute roles={["diretor", "admin"]}><AuditLog /></ProtectedRoute>} />
              <Route path="/wcag-audit" element={<WcagAudit />} />
              <Route path="/diagnostico/sidebar" element={<SidebarDiagnostic />} />
            </Route>
            <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
      </NavLayoutProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
