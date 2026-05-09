-- Create observation_type enum
DO $$ BEGIN
    CREATE TYPE public.observation_type AS ENUM ('informativo', 'impacta_aprovacao', 'justificativa_override');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add observation_type column to payment_observations
ALTER TABLE public.payment_observations 
ADD COLUMN IF NOT EXISTS observation_type public.observation_type NOT NULL DEFAULT 'informativo';
