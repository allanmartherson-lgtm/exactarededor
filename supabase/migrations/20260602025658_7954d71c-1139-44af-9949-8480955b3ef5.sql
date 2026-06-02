-- Recria trigger de cascata com log de auditoria detalhado
CREATE OR REPLACE FUNCTION public.cascade_doctor_inactive_to_portal()
RETURNS TRIGGER AS $$
DECLARE
  affected RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.active = TRUE AND NEW.active = FALSE THEN
    FOR affected IN
      SELECT dpu.id AS portal_row_id, dpu.user_id, p.email, p.full_name
        FROM public.doctor_portal_users dpu
        LEFT JOIN public.profiles p ON p.id = dpu.user_id
       WHERE dpu.doctor_id = NEW.id
         AND dpu.active = TRUE
    LOOP
      UPDATE public.doctor_portal_users
         SET active = FALSE
       WHERE id = affected.portal_row_id;

      -- Log na entidade médico
      INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
      VALUES (
        'doctor', NEW.id, 'deactivated', NULL,
        jsonb_build_object(
          'reason', 'doctor_inactivation_cascade',
          'portal_user_id', affected.portal_row_id,
          'portal_user_email', affected.email,
          'portal_user_full_name', affected.full_name,
          'doctor_full_name', NEW.full_name
        )
      );

      -- Log na entidade usuário (perfil)
      IF affected.user_id IS NOT NULL THEN
        INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
        VALUES (
          'user', affected.user_id, 'deactivated', NULL,
          jsonb_build_object(
            'reason', 'doctor_inactivation_cascade',
            'doctor_id', NEW.id,
            'doctor_full_name', NEW.full_name,
            'portal_kind', 'doctor',
            'portal_user_id', affected.portal_row_id
          )
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_cascade_doctor_inactive_to_portal ON public.doctors;
CREATE TRIGGER trg_cascade_doctor_inactive_to_portal
AFTER UPDATE OF active ON public.doctors
FOR EACH ROW
EXECUTE FUNCTION public.cascade_doctor_inactive_to_portal();