-- Tabela para armazenar as preferências de notificação
CREATE TABLE public.user_notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'returned', 'ia_concluded', 'nf_received'
    email_enabled BOOLEAN NOT NULL DEFAULT true,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, event_type)
);

-- Ativar RLS
ALTER TABLE public.user_notification_settings ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
CREATE POLICY "Users can manage their own notification settings"
    ON public.user_notification_settings
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can read all notification settings"
    ON public.user_notification_settings
    FOR SELECT
    USING (true);

-- Gatilho para updated_at
CREATE TRIGGER update_user_notification_settings_updated_at
    BEFORE UPDATE ON public.user_notification_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Inicializar configurações padrão para usuários existentes (opcional, mas recomendado)
INSERT INTO public.user_notification_settings (user_id, event_type)
SELECT id, event
FROM auth.users
CROSS JOIN (SELECT unnest(ARRAY['returned', 'ia_concluded', 'nf_received']) AS event) AS events
ON CONFLICT (user_id, event_type) DO NOTHING;