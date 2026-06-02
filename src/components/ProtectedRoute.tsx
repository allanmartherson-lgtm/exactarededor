import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import type { AppRole } from "@/lib/status";

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: AppRole[];
}

export const ProtectedRoute = ({ children, roles }: ProtectedRouteProps) => {
  const { user, roles: userRoles, loading, rolesLoading } = useAuth();
  const { needsSelection, loading: hospitalLoading } = useHospital();
  const location = useLocation();

  if (loading || (user && roles && rolesLoading) || (user && hospitalLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  const mustReset = (user.user_metadata as Record<string, unknown> | undefined)?.must_reset_password === true;
  if (mustReset && location.pathname !== "/trocar-senha") {
    return <Navigate to="/trocar-senha" replace />;
  }

  // Blindagem do Exacta: usuário autenticado SEM nenhum papel interno
  // (ex.: apenas portal de empresa/médico) não pode acessar nenhuma rota
  // protegida. Redireciona para /auth com aviso — o login pelo portal usa
  // magic link e não passa por aqui.
  if (!rolesLoading && userRoles.length === 0) {
    return <Navigate to="/auth?motivo=sem-acesso-exacta" replace />;
  }

  // Redireciona para seleção de hospital quando o usuário tem +1 e nenhum escolhido.
  if (needsSelection && location.pathname !== "/selecionar-hospital") {
    return <Navigate to="/selecionar-hospital" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.some((r) => userRoles.includes(r))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
