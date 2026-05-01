import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import SetPassword from "./pages/SetPassword.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Payments from "./pages/Payments.tsx";
import NewPayment from "./pages/NewPayment.tsx";
import PaymentDetail from "./pages/PaymentDetail.tsx";
import Rules from "./pages/Rules.tsx";
import ReferenceTables from "./pages/ReferenceTables.tsx";
import Users from "./pages/Users.tsx";
import Invoices from "./pages/Invoices.tsx";
import InvoicePortal from "./pages/InvoicePortal.tsx";
import Companies from "./pages/Companies.tsx";
import CostCenters from "./pages/CostCenters.tsx";
import AuditLog from "./pages/AuditLog.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { AppLayout } from "./components/AppLayout.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
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
              <Route path="/notas-fiscais" element={<Invoices />} />
              <Route path="/regras" element={<ProtectedRoute roles={["diretor", "admin"]}><Rules /></ProtectedRoute>} />
              <Route path="/tabelas" element={<ProtectedRoute roles={["diretor", "admin"]}><ReferenceTables /></ProtectedRoute>} />
              <Route path="/empresas" element={<ProtectedRoute roles={["diretor", "admin"]}><Companies /></ProtectedRoute>} />
              <Route path="/centros-de-custo" element={<CostCenters />} />
              <Route path="/usuarios" element={<ProtectedRoute roles={["admin"]}><Users /></ProtectedRoute>} />
              <Route path="/auditoria" element={<ProtectedRoute roles={["diretor", "admin"]}><AuditLog /></ProtectedRoute>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
