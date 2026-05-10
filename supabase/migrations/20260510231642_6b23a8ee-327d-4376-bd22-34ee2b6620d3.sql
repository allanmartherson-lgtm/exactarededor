-- Add role column to reference_table_items
ALTER TABLE public.reference_table_items 
ADD COLUMN role TEXT;

-- Index for better performance when searching/calculating by role
CREATE INDEX idx_ref_table_items_code_role ON public.reference_table_items(reference_table_id, code, role);