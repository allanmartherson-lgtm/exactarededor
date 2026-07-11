
DO $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT pi.id, pi.payment_id, pi.attendance_number, pi.doctor_name, pi.gross_amount, p.hospital_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.applied_calc_method = 'bonus'
      AND COALESCE(pi.synthetic_bonus, false) = false
      AND pi.procedure_code IS NULL
      AND pi.procedure_amount IS NULL
  LOOP
    UPDATE public.payment_items
    SET synthetic_bonus = true
    WHERE id = v_row.id;

    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, hospital_id, diff, created_at)
    VALUES (
      'payment_item',
      v_row.id,
      'fix_legacy_bonus_flag_task_b',
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_row.hospital_id,
      jsonb_build_object(
        'synthetic_bonus', jsonb_build_object('before', false, 'after', true),
        'reason', 'Linha de bônus criada antes da flag synthetic_bonus. Rotulada retroativamente para separar de itens TUSS reais no modal de conciliação/glosa. Nenhum valor alterado.',
        'attendance', v_row.attendance_number,
        'doctor', v_row.doctor_name,
        'gross', v_row.gross_amount,
        'payment_id', v_row.payment_id
      ),
      now()
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'fix_legacy_bonus_flag_task_b: % itens marcados', v_count;
END $$;
