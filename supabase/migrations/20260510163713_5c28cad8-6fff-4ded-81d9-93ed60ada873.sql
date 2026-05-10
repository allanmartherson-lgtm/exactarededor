-- Create type for threshold types
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'threshold_type') THEN
        CREATE TYPE threshold_type AS ENUM ('percentual', 'absoluto');
    END IF;
END $$;

-- Add threshold columns to rules table
ALTER TABLE public.rules 
ADD COLUMN IF NOT EXISTS limiar_alerta_tipo threshold_type,
ADD COLUMN IF NOT EXISTS limiar_alerta_valor numeric,
ADD COLUMN IF NOT EXISTS limiar_bloqueio_tipo threshold_type,
ADD COLUMN IF NOT EXISTS limiar_bloqueio_valor numeric;

-- Create system_configurations table
CREATE TABLE IF NOT EXISTS public.system_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;

-- Create policies for system_configurations
CREATE POLICY "System configurations are viewable by everyone authenticated" 
ON public.system_configurations 
FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "System configurations are manageable by admins" 
ON public.system_configurations 
FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Initialize global thresholds
INSERT INTO public.system_configurations (key, value, description)
VALUES (
    'divergence_thresholds', 
    '{
        "limiar_alerta_tipo": "percentual",
        "limiar_alerta_valor": 1.0,
        "limiar_bloqueio_tipo": "percentual",
        "limiar_bloqueio_valor": 5.0
    }'::jsonb,
    'Limiares globais padrão de divergência para análise de pagamento'
)
ON CONFLICT (key) DO NOTHING;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_system_configurations_updated_at
    BEFORE UPDATE ON public.system_configurations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
