import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/lib/status";

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: AppRole[];
}

export const ProtectedRoute = ({ children, roles }: ProtectedRouteProps) => {
  const { user, roles: userRoles, loading, rolesLoading } = useAuth();
  const location = useLocation();

  if (loading || (user && roles && rolesLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  // Força troca de senha temporária no primeiro acesso (reset feito por admin)
  const mustReset = (user.user_metadata as Record<string, unknown> | undefined)?.must_reset_password === true;
  if (mustReset && location.pathname !== "/trocar-senha") {
    return <Navigate to="/trocar-senha" replace />;
  }

  if (roles && !roles.some((r) => userRoles.includes(r))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};