
-- Restrict SELECT on internal config tables to internal staff roles (exclude portal users: empresa, medico)

DROP POLICY IF EXISTS "item_types read for authenticated" ON public.item_types;
CREATE POLICY "item_types read internal" ON public.item_types FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "payment_models read for authenticated" ON public.payment_models;
CREATE POLICY "payment_models read internal" ON public.payment_models FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "pt_view_authenticated" ON public.payment_types;
CREATE POLICY "pt_view_internal" ON public.payment_types FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "payout_model_rubrics read" ON public.payout_model_rubrics;
CREATE POLICY "payout_model_rubrics read internal" ON public.payout_model_rubrics FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "payout_tier_rows read" ON public.payout_tier_rows;
CREATE POLICY "payout_tier_rows read internal" ON public.payout_tier_rows FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "payout_tier_tables read" ON public.payout_tier_tables;
CREATE POLICY "payout_tier_tables read internal" ON public.payout_tier_tables FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "pc_view_authenticated" ON public.procedure_classifications;
CREATE POLICY "pc_view_internal" ON public.procedure_classifications FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "ref_items_view_authenticated" ON public.reference_table_items;
CREATE POLICY "ref_items_view_internal" ON public.reference_table_items FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "ref_port_values_view_authenticated" ON public.reference_table_port_values;
CREATE POLICY "ref_port_values_view_internal" ON public.reference_table_port_values FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "rc_view_authenticated" ON public.rule_calculations;
CREATE POLICY "rc_view_internal" ON public.rule_calculations FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));

DROP POLICY IF EXISTS "rules_view_authenticated" ON public.rules;
CREATE POLICY "rules_view_internal" ON public.rules FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor') OR has_role(auth.uid(),'validador') OR has_role(auth.uid(),'analista') OR has_role(auth.uid(),'gestao_medica'));
