
-- =========================================================
-- 1. special_case_types (catálogo de tipos)
-- =========================================================
CREATE TABLE public.special_case_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  requires_justification boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (hospital_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.special_case_types TO authenticated;
GRANT ALL ON public.special_case_types TO service_role;

ALTER TABLE public.special_case_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "special_case_types_select"
  ON public.special_case_types FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "special_case_types_admin_write"
  ON public.special_case_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor') OR public.has_role(auth.uid(), 'gestao_medica'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor') OR public.has_role(auth.uid(), 'gestao_medica'));

CREATE TRIGGER trg_special_case_types_updated
  BEFORE UPDATE ON public.special_case_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sementes globais (hospital_id NULL = disponível para todos os hospitais)
INSERT INTO public.special_case_types (hospital_id, code, label, description) VALUES
  (NULL, 'oncologico', 'Oncológico', 'Paciente em tratamento oncológico, validado pela gestão médica'),
  (NULL, 'pediatrico_complexo', 'Pediátrico complexo', 'Caso pediátrico de alta complexidade'),
  (NULL, 'urgencia_alta_complexidade', 'Urgência alta complexidade', 'Atendimento de urgência com alta complexidade clínica')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 2. special_case_marks (marcações por atendimento/item)
-- =========================================================
CREATE TYPE public.special_case_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');
CREATE TYPE public.special_case_origin AS ENUM ('medico_portal', 'analista', 'gestao_medica');

CREATE TABLE public.special_case_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE CASCADE,
  attendance_number text NOT NULL,
  item_id uuid REFERENCES public.payment_items(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  special_case_type_code text NOT NULL,
  status public.special_case_status NOT NULL DEFAULT 'pending',
  origin public.special_case_origin NOT NULL,
  justification text,
  marked_by uuid REFERENCES auth.users(id),
  marked_by_portal_user uuid REFERENCES public.doctor_portal_users(id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  approval_note text,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  revoked_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma marca ATIVA (não rejeitada/revogada) por escopo + tipo
CREATE UNIQUE INDEX special_case_marks_active_unique
  ON public.special_case_marks (payment_id, attendance_number, COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid), special_case_type_code)
  WHERE status IN ('pending', 'approved');

CREATE INDEX special_case_marks_payment_idx ON public.special_case_marks (payment_id);
CREATE INDEX special_case_marks_status_idx ON public.special_case_marks (status);
CREATE INDEX special_case_marks_hospital_idx ON public.special_case_marks (hospital_id);
CREATE INDEX special_case_marks_doctor_idx ON public.special_case_marks (doctor_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.special_case_marks TO authenticated;
GRANT ALL ON public.special_case_marks TO service_role;

ALTER TABLE public.special_case_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "special_case_marks_select_internal"
  ON public.special_case_marks FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'validador')
    OR public.has_role(auth.uid(), 'gestao_medica')
  );

CREATE POLICY "special_case_marks_insert_internal"
  ON public.special_case_marks FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'gestao_medica')
  );

CREATE POLICY "special_case_marks_update_internal"
  ON public.special_case_marks FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'gestao_medica')
    OR (marked_by = auth.uid() AND status = 'pending')
  );

CREATE POLICY "special_case_marks_delete_admin"
  ON public.special_case_marks FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'));

CREATE TRIGGER trg_special_case_marks_updated
  BEFORE UPDATE ON public.special_case_marks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 3. Campos derivados em payment_items
-- =========================================================
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS special_case_code text,
  ADD COLUMN IF NOT EXISTS special_case_status public.special_case_status;

CREATE INDEX IF NOT EXISTS payment_items_special_case_idx
  ON public.payment_items (special_case_code, special_case_status)
  WHERE special_case_code IS NOT NULL;

-- =========================================================
-- 4. Filtro nas regras
-- =========================================================
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS special_case_filter text[];

COMMENT ON COLUMN public.rules.special_case_filter IS
  'NULL = regra padrão (casa qualquer item). [''*''] = casa qualquer caso especial aprovado. [''oncologico''] = casa só esse código.';

-- =========================================================
-- 5. Função que sincroniza payment_items com a marca
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_special_case_to_items(_mark_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mark record;
  _new_code text;
  _new_status public.special_case_status;
BEGIN
  SELECT * INTO _mark FROM public.special_case_marks WHERE id = _mark_id;
  IF _mark IS NULL THEN RETURN; END IF;

  -- Define o que escrever no item
  IF _mark.status IN ('rejected', 'revoked') THEN
    _new_code := NULL;
    _new_status := NULL;
  ELSE
    _new_code := _mark.special_case_type_code;
    _new_status := _mark.status;
  END IF;

  IF _mark.item_id IS NOT NULL THEN
    UPDATE public.payment_items
       SET special_case_code = _new_code,
           special_case_status = _new_status
     WHERE id = _mark.item_id;
  ELSE
    -- Marca por atendimento: aplica a todos os itens do atendimento (que não tenham marca específica de item)
    UPDATE public.payment_items pi
       SET special_case_code = _new_code,
           special_case_status = _new_status
     WHERE pi.payment_id = _mark.payment_id
       AND pi.attendance_number = _mark.attendance_number
       AND NOT EXISTS (
         SELECT 1 FROM public.special_case_marks m2
          WHERE m2.payment_id = _mark.payment_id
            AND m2.attendance_number = _mark.attendance_number
            AND m2.item_id = pi.id
            AND m2.status IN ('pending', 'approved')
            AND m2.id <> _mark.id
       );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_special_case_to_items(uuid) TO authenticated, service_role;

-- Trigger: sempre que uma marca é criada/atualizada, sincroniza os itens
CREATE OR REPLACE FUNCTION public.trg_special_case_marks_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.apply_special_case_to_items(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_special_case_marks_after_change
  AFTER INSERT OR UPDATE OF status, item_id, attendance_number, special_case_type_code
  ON public.special_case_marks
  FOR EACH ROW EXECUTE FUNCTION public.trg_special_case_marks_sync();
