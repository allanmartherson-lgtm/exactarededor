CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role_title, department, birth_date)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(NEW.raw_user_meta_data->>'phone',''),
    NULLIF(NEW.raw_user_meta_data->>'role_title',''),
    NULLIF(NEW.raw_user_meta_data->>'department',''),
    NULLIF(NEW.raw_user_meta_data->>'birth_date','')::date
  )
  ON CONFLICT (id) DO NOTHING;
  -- Bootstrap: primeiro usuário do sistema vira admin+diretor.
  -- Demais usuários NÃO recebem papel automático — admin-create-user define os papéis solicitados.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'diretor');
  END IF;
  RETURN NEW;
END;
$function$;

-- Limpa o papel 'analista' atribuído automaticamente a usuários que JÁ possuem outro papel
-- (diretor/admin/validador) e nunca foram cadastrados como analista de fato.
DELETE FROM public.user_roles ur
WHERE ur.role = 'analista'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur2
    WHERE ur2.user_id = ur.user_id
      AND ur2.role IN ('admin','diretor','validador')
  );