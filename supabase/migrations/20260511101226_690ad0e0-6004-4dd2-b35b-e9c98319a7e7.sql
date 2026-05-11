CREATE TABLE public.access_route_matrices (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    rule_id UUID REFERENCES public.rules(id) ON DELETE CASCADE,
    
    -- Configuração para Via Única/Principal
    primary_route_table_id UUID REFERENCES public.reference_tables(id),
    primary_route_multiplier NUMERIC DEFAULT 1,
    
    -- Configuração para Outras Vias
    secondary_route_type TEXT DEFAULT 'convenio_percentage' CHECK (secondary_route_type IN ('convenio_percentage', 'fixed_amount', 'reference_table')),
    secondary_route_value NUMERIC DEFAULT 100,
    secondary_route_table_id UUID REFERENCES public.reference_tables(id),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.access_route_matrices ENABLE ROW LEVEL SECURITY;

-- Create policies (allowing authenticated users for now as per common pattern in this project)
CREATE POLICY "Allow all access to access_route_matrices" ON public.access_route_matrices FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_access_route_matrices_updated_at
    BEFORE UPDATE ON public.access_route_matrices
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();