ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'empresa';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'medico';

INSERT INTO system_configurations (key, value, description)
VALUES (
  'production_validation_deadline_days',
  '"5"',
  'Prazo padrão em dias úteis para empresa responder validação prévia de produção.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS company_portal_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by  uuid REFERENCES profiles(id),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
ALTER TABLE company_portal_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cpu_internal_all" ON company_portal_users FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin','analista','validador','diretor')));
CREATE POLICY "cpu_self_select" ON company_portal_users FOR SELECT USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS production_validations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id),
  company_name  text NOT NULL,
  token         text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  sent_by       uuid REFERENCES profiles(id),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '5 days'),
  status        text NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','confirmado','com_ressalva','expirado')),
  confirmed_at  timestamptz,
  confirmed_by_name text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pval_payment ON production_validations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pval_token ON production_validations(token);
ALTER TABLE production_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pval_internal_all" ON production_validations FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin','analista','validador','diretor')));
CREATE POLICY "pval_empresa_select" ON production_validations FOR SELECT USING (company_id IN (SELECT company_id FROM company_portal_users WHERE user_id = auth.uid() AND active = true));
CREATE POLICY "pval_empresa_update" ON production_validations FOR UPDATE USING (company_id IN (SELECT company_id FROM company_portal_users WHERE user_id = auth.uid() AND active = true));

CREATE TABLE IF NOT EXISTS production_validation_feedbacks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id    uuid NOT NULL REFERENCES production_validations(id) ON DELETE CASCADE,
  payment_item_id  uuid REFERENCES payment_items(id),
  kind             text NOT NULL CHECK (kind IN ('exclusao','ausencia','observacao')),
  exclusion_reason text CHECK (exclusion_reason IN ('outra_via','particular','associacao','outro')),
  exclusion_detail text,
  patient_name     text,
  procedure_date   date,
  attendance_number text,
  convenio         text,
  doctor_name      text,
  description      text,
  status           text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','aceito','rejeitado','ignorado')),
  resolved_by      uuid REFERENCES profiles(id),
  resolved_at      timestamptz,
  resolution_note  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pvf_validation ON production_validation_feedbacks(validation_id);
ALTER TABLE production_validation_feedbacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pvf_internal_all" ON production_validation_feedbacks FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin','analista','validador','diretor')));
CREATE POLICY "pvf_empresa_select" ON production_validation_feedbacks FOR SELECT USING (validation_id IN (SELECT pv.id FROM production_validations pv JOIN company_portal_users cpu ON cpu.company_id = pv.company_id WHERE cpu.user_id = auth.uid() AND cpu.active = true));
CREATE POLICY "pvf_empresa_insert" ON production_validation_feedbacks FOR INSERT WITH CHECK (validation_id IN (SELECT pv.id FROM production_validations pv JOIN company_portal_users cpu ON cpu.company_id = pv.company_id WHERE cpu.user_id = auth.uid() AND cpu.active = true));

CREATE TABLE IF NOT EXISTS doctor_portal_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by  uuid REFERENCES profiles(id),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, user_id)
);
ALTER TABLE doctor_portal_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dpu_internal_all" ON doctor_portal_users FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin','analista','validador','diretor')));
CREATE POLICY "dpu_self_select" ON doctor_portal_users FOR SELECT USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS doctor_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id        uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  author_user_id   uuid REFERENCES auth.users(id),
  author_type      text NOT NULL CHECK (author_type IN ('medico','equipe_interna')),
  author_name      text NOT NULL,
  message          text NOT NULL,
  payment_item_id  uuid REFERENCES payment_items(id),
  payment_id       uuid REFERENCES payments(id),
  read_at          timestamptz,
  read_by_doctor_at timestamptz,
  responded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dm_doctor ON doctor_messages(doctor_id);
CREATE INDEX IF NOT EXISTS idx_dm_payment ON doctor_messages(payment_id);
ALTER TABLE doctor_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_internal_all" ON doctor_messages FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin','analista','validador','diretor')));
CREATE POLICY "dm_medico_select" ON doctor_messages FOR SELECT USING (doctor_id IN (SELECT doctor_id FROM doctor_portal_users WHERE user_id = auth.uid() AND active = true));
CREATE POLICY "dm_medico_insert" ON doctor_messages FOR INSERT WITH CHECK (doctor_id IN (SELECT doctor_id FROM doctor_portal_users WHERE user_id = auth.uid() AND active = true) AND author_type = 'medico');