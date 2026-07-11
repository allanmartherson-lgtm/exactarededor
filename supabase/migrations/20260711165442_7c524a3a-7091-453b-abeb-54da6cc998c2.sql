
ALTER TABLE public.rules DISABLE TRIGGER trg_rules_block_delete;

DO $$
DECLARE
  v_luzia uuid;
  v_rule record;
  v_actor uuid := auth.uid();
BEGIN
  SELECT id INTO v_luzia FROM public.hospitals WHERE name ILIKE '%luzia%' LIMIT 1;
  IF v_luzia IS NULL THEN RAISE EXCEPTION 'Hospital Santa Luzia não encontrado'; END IF;

  PERFORM set_config('app.rule_calc_delete_authorized', 'on', true);

  FOR v_rule IN
    SELECT id, name FROM public.rules
    WHERE hospital_id = v_luzia AND active = false
  LOOP
    INSERT INTO public.rule_snapshots(rule_id, hospital_id, reason, payload, calc_count, actor_id)
    VALUES (
      v_rule.id, v_luzia, 'before_edit',
      public.build_rule_snapshot_payload(v_rule.id),
      (SELECT count(*) FROM public.rule_calculations WHERE rule_id = v_rule.id),
      v_actor
    );

    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff, hospital_id)
    VALUES (
      v_actor, 'rule', v_rule.id, 'delete',
      jsonb_build_object('reason','cleanup_inactive_santa_luzia','name', v_rule.name),
      v_luzia
    );

    DELETE FROM public.rule_calculations WHERE rule_id = v_rule.id;
    DELETE FROM public.rules WHERE id = v_rule.id;
  END LOOP;

  PERFORM set_config('app.rule_calc_delete_authorized', 'off', true);
END $$;

ALTER TABLE public.rules ENABLE TRIGGER trg_rules_block_delete;
