
-- Permitir admin/diretor editarem perfis de outros usuários (necessário para cadastrar WhatsApp dos diretores)
CREATE POLICY "profiles_admin_update_all"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));

-- Controle de idempotência: 1 notificação por pagamento que entra em aguardando_aprovacao
CREATE TABLE public.payment_director_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  email_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  whatsapp_results jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.payment_director_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdn_view_workflow"
ON public.payment_director_notifications
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'analista'::app_role) OR
  public.has_role(auth.uid(), 'validador'::app_role) OR
  public.has_role(auth.uid(), 'diretor'::app_role) OR
  public.has_role(auth.uid(), 'admin'::app_role)
);
