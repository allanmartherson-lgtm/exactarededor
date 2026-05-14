ALTER TABLE public.payment_processing_jobs 
ADD COLUMN IF NOT EXISTS company_list TEXT[],
ADD COLUMN IF NOT EXISTS total_items INTEGER;