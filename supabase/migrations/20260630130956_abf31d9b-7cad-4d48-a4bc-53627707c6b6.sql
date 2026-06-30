
REVOKE ALL ON public._backup_d3e4_payments  FROM anon, authenticated;
REVOKE ALL ON public._backup_d3e4_companies FROM anon, authenticated;
REVOKE ALL ON public._backup_d3e4_cfa       FROM anon, authenticated;

GRANT ALL ON public._backup_d3e4_payments  TO service_role;
GRANT ALL ON public._backup_d3e4_companies TO service_role;
GRANT ALL ON public._backup_d3e4_cfa       TO service_role;

ALTER TABLE public._backup_d3e4_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_d3e4_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_d3e4_cfa       ENABLE ROW LEVEL SECURITY;
