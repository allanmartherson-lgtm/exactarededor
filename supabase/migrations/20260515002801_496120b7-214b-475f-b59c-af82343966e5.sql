-- Verifica e reforça cascata para faturas
ALTER TABLE public.invoices 
DROP CONSTRAINT IF EXISTS invoices_payment_id_fkey,
ADD CONSTRAINT invoices_payment_id_fkey 
FOREIGN KEY (payment_id) 
REFERENCES public.payments(id) 
ON DELETE CASCADE;

-- Verifica e reforça cascata para perguntas de faturas
ALTER TABLE public.invoice_questions 
DROP CONSTRAINT IF EXISTS invoice_questions_payment_id_fkey,
ADD CONSTRAINT invoice_questions_payment_id_fkey 
FOREIGN KEY (payment_id) 
REFERENCES public.payments(id) 
ON DELETE CASCADE;
