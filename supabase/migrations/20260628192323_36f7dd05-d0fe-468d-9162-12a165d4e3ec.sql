
CREATE TABLE IF NOT EXISTS public.specialties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS specialties_name_lower_unique ON public.specialties (lower(name));
CREATE INDEX IF NOT EXISTS specialties_active_idx ON public.specialties (active);

GRANT SELECT, INSERT, UPDATE ON public.specialties TO authenticated;
GRANT ALL ON public.specialties TO service_role;

ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "specialties_select_authenticated" ON public.specialties;
CREATE POLICY "specialties_select_authenticated"
  ON public.specialties FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "specialties_insert_admin" ON public.specialties;
CREATE POLICY "specialties_insert_admin"
  ON public.specialties FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "specialties_update_admin" ON public.specialties;
CREATE POLICY "specialties_update_admin"
  ON public.specialties FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.specialties_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Especialidades não podem ser excluídas — use inativação (active = false).';
END;
$$;

DROP TRIGGER IF EXISTS specialties_block_delete_trg ON public.specialties;
CREATE TRIGGER specialties_block_delete_trg
  BEFORE DELETE ON public.specialties
  FOR EACH ROW EXECUTE FUNCTION public.specialties_block_delete();

CREATE OR REPLACE FUNCTION public.specialties_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS specialties_set_updated_at_trg ON public.specialties;
CREATE TRIGGER specialties_set_updated_at_trg
  BEFORE UPDATE ON public.specialties
  FOR EACH ROW EXECUTE FUNCTION public.specialties_set_updated_at();

INSERT INTO public.specialties (code, name) VALUES
  ('alergia_e_imunologia', 'Alergia e Imunologia'),
  ('anestesiologia', 'Anestesiologia'),
  ('angiologia', 'Angiologia'),
  ('biomedico', 'Biomédico'),
  ('cancerologia', 'Cancerologia'),
  ('cardiologia', 'Cardiologia'),
  ('cardiologia_pediatrica', 'Cardiologia Pediátrica'),
  ('cirurgia_bariatrica', 'Cirurgia Bariátrica'),
  ('cirurgia_buco_maxilo_facial', 'Cirurgia Buco Maxilo Facial'),
  ('cirurgia_cardiovascular', 'Cirurgia Cardiovascular'),
  ('cirurgia_cardiaca', 'Cirurgia Cardíaca'),
  ('cirurgia_da_mao', 'Cirurgia da Mão'),
  ('cirurgia_de_cabeca_e_pescoco', 'Cirurgia de Cabeça e Pescoço'),
  ('cirurgia_de_coluna', 'Cirurgia de Coluna'),
  ('cirurgia_do_aparelho_digestivo', 'Cirurgia do Aparelho Digestivo'),
  ('cirurgia_endovascular', 'Cirurgia Endovascular'),
  ('cirurgia_geral', 'Cirurgia Geral'),
  ('cirurgia_oncologica', 'Cirurgia Oncológica'),
  ('cirurgia_pediatrica', 'Cirurgia Pediátrica'),
  ('cirurgia_plastica', 'Cirurgia Plástica'),
  ('cirurgia_robotica', 'Cirurgia Robótica'),
  ('cirurgia_toracica', 'Cirurgia Torácica'),
  ('cirurgia_vascular', 'Cirurgia Vascular'),
  ('clinica_geral', 'Clínica Geral'),
  ('clinica_medica', 'Clínica Médica'),
  ('coloproctologia', 'Coloproctologia'),
  ('comissao_de_picc', 'Comissão de PICC'),
  ('dermatologia', 'Dermatologia'),
  ('eletrofisiologista_cardiaco', 'Eletrofisiologista Cardíaco'),
  ('emergencista', 'Emergencista'),
  ('endocrinologia', 'Endocrinologia'),
  ('endocrinologia_e_metabologia', 'Endocrinologia e Metabologia'),
  ('endoscopia', 'Endoscopia'),
  ('endovascular', 'Endovascular'),
  ('estimulacao_cardiaca_artificial', 'Estimulação Cardíaca Artificial'),
  ('fisiatra', 'Fisiatra'),
  ('fisioterapia', 'Fisioterapia'),
  ('gastroenterologia', 'Gastroenterologia'),
  ('geriatria', 'Geriatria'),
  ('ginecologia_e_obstetricia', 'Ginecologia e Obstetrícia'),
  ('grupo_de_coluna', 'Grupo de Coluna'),
  ('grupo_de_coluna_ortopedista', 'Grupo de Coluna - Ortopedista'),
  ('grupo_de_dor', 'Grupo de Dor'),
  ('hematologia_e_hemoterapia', 'Hematologia e Hemoterapia'),
  ('hemodinamica', 'Hemodinâmica'),
  ('hepatologia', 'Hepatologia'),
  ('infectologia', 'Infectologia'),
  ('instrumentador_cirurgico', 'Instrumentador Cirúrgico'),
  ('mastologia', 'Mastologia'),
  ('medicina_esportiva', 'Medicina Esportiva'),
  ('medicina_fisica_e_reabilitacao', 'Medicina Física e Reabilitação'),
  ('medicina_intensiva', 'Medicina Intensiva'),
  ('medicina_nuclear', 'Medicina Nuclear'),
  ('medicina_preventiva_e_social', 'Medicina Preventiva e Social'),
  ('nefrologia', 'Nefrologia'),
  ('neurocirurgia', 'Neurocirurgia'),
  ('neurocirurgia_vascular', 'Neurocirurgia Vascular'),
  ('neurologia_clinica', 'Neurologia Clínica'),
  ('neurologia_vascular', 'Neurologia Vascular'),
  ('nutrologia', 'Nutrologia'),
  ('odontologia', 'Odontologia'),
  ('oftalmologia', 'Oftalmologia'),
  ('oncologia_clinica', 'Oncologia Clínica'),
  ('ortopedia', 'Ortopedia'),
  ('ortopedia_pediatrica', 'Ortopedia Pediátrica'),
  ('ortopedia_e_traumatologia', 'Ortopedia e Traumatologia'),
  ('otorrinolaringologia', 'Otorrinolaringologia'),
  ('paliativismo_e_terminalidade', 'Paliativismo e Terminalidade'),
  ('pediatria', 'Pediatria'),
  ('pneumologia', 'Pneumologia'),
  ('proctologia', 'Proctologia'),
  ('radiologia_e_diagnostico_por_imagem', 'Radiologia e Diagnóstico por Imagem'),
  ('radioterapia', 'Radioterapia'),
  ('reumatologia', 'Reumatologia'),
  ('terapia_intensiva', 'Terapia Intensiva'),
  ('urologia', 'Urologia')
ON CONFLICT (code) DO NOTHING;
