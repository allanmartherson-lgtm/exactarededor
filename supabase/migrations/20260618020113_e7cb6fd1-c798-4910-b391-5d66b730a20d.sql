
ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_type_fields_chk;

ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_type_fields_chk CHECK (
    CASE calculation_type::text
      WHEN 'valor_fixo' THEN
        fixed_amount IS NOT NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND (package_included_codes IS NULL OR array_length(package_included_codes,1) IS NULL)
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'pacote' THEN
        package_main_code IS NOT NULL
        AND fixed_amount IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'pacote_fechado' THEN
        package_main_code IS NOT NULL
        AND fixed_amount IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'pacote_com_extras' THEN
        package_main_code IS NOT NULL
        AND fixed_amount IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'pacote_por_atendimento' THEN
        package_main_code IS NOT NULL
        AND fixed_amount IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'tabela_diferenciada' THEN
        reference_table_id IS NOT NULL
        AND fixed_amount IS NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND (package_included_codes IS NULL OR array_length(package_included_codes,1) IS NULL)
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND convenio_percentage IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'percentual_sobre_convenio' THEN
        convenio_percentage IS NOT NULL
        AND fixed_amount IS NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND (package_included_codes IS NULL OR array_length(package_included_codes,1) IS NULL)
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'bonus' THEN
        (bonus_amount IS NOT NULL OR bonus_pct IS NOT NULL)
        AND fixed_amount IS NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND (package_included_codes IS NULL OR array_length(package_included_codes,1) IS NULL)
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND target_amount IS NULL

      WHEN 'regra_vias' THEN
        fixed_amount IS NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'exclusao' THEN
        fixed_amount IS NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'informativo' THEN
        fixed_amount IS NULL
        AND package_amount IS NULL
        AND package_main_code IS NULL
        AND package_roles_distribution IS NULL
        AND package_subtype IS NULL
        AND convenio_percentage IS NULL
        AND reference_table_id IS NULL
        AND bonus_amount IS NULL
        AND bonus_pct IS NULL
        AND target_amount IS NULL

      WHEN 'complemento' THEN TRUE  -- aceita combinação até a regra ser definida

      ELSE TRUE
    END
  );

COMMENT ON CONSTRAINT rule_calculations_type_fields_chk ON public.rule_calculations IS
  'Garante exclusividade de campos por calculation_type. Cada tipo só pode preencher os campos que lhe pertencem; cruzamentos (ex: valor_fixo com package_roles_distribution) são bloqueados.';
