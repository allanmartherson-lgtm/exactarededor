ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_payment_type_id uuid REFERENCES public.payment_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.companies.default_payment_type_id IS 'Tipo de pagamento padrão para os itens desta empresa quando o lote permitir mistura de subtipos (allow_mixed_subtypes). Sobrescreve o tipo do lote na importação com payment_type_source=company_override.';

CREATE INDEX IF NOT EXISTS idx_companies_default_payment_type
  ON public.companies (default_payment_type_id)
  WHERE default_payment_type_id IS NOT NULL;