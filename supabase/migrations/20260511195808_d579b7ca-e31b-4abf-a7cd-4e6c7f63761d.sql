-- Add sectors and specialties columns to rule_calculations table
ALTER TABLE public.rule_calculations 
ADD COLUMN sectors TEXT[] DEFAULT '{}',
ADD COLUMN specialties TEXT[] DEFAULT '{}';

-- Update RLS policies (usually inherited from table, but good to check if there are specific ones)
-- Since they are part of the same table, existing policies for rule_calculations should apply.
