ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS convenio_basis_detected TEXT
    CHECK (convenio_basis_detected IN ('unit','total','ambiguous','na')),
  ADD COLUMN IF NOT EXISTS basis_confidence NUMERIC;

COMMENT ON COLUMN public.payment_items.convenio_basis_detected IS
  'Base de cálculo detectada stateless pelo motor quando qty>1: unit (valor convênio é unitário, multiplica por qtd), total (já vem totalizado), ambiguous (ambas hipóteses casam), na (qty=1 ou sem regra calculável).';
COMMENT ON COLUMN public.payment_items.basis_confidence IS
  'Desvio percentual da hipótese escolhida vs valor pago (0 = casa exato).';