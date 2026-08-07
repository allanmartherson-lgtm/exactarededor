import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { APP_URL } from "../_shared/appUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Kind = "company" | "doctor";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Apenas administradores podem cadastrar usuários de portal" }, 403);

    const body = await req.json();
    const kind = String(body.kind ?? "") as Kind;
    let email = String(body.email ?? "").trim().toLowerCase();
    let fullName = String(body.full_name ?? "").trim();
    let cpf = String(body.cpf ?? "").replace(/\D/g, "");
    let phone = String(body.phone ?? "").replace(/\D/g, "");
    const entityId = String(body.entity_id ?? "").trim();
    const hospitalIds: string[] = Array.isArray(body.hospital_ids) ? body.hospital_ids : [];
    const primaryHospitalId = body.primary_hospital_id ? String(body.primary_hospital_id) : null;
    const sendInvite = body.send_invite !== false;

    const rawOrigin = String(body.app_origin ?? "").trim();
    const isAllowedOrigin = (o: string) => {
      try {
        const u = new URL(o);
        if (u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) return false;
        return /(^|\.)lovable\.(app|dev)$/.test(u.hostname)
          || /(^|\.)lovableproject\.com$/.test(u.hostname)
          || u.hostname === "localhost"
          || u.hostname === "127.0.0.1";
      } catch { return false; }
    };
    const appOrigin = isAllowedOrigin(rawOrigin) ? rawOrigin.replace(/\/+$/, "") : "";
    // Link vai por e-mail: usa sempre a URL canônica, nunca a origin do cliente.
    const redirectTo = `${APP_URL}/auth/reset-password`;

    if (!["company", "doctor"].includes(kind)) return json({ error: "kind inválido" }, 400);
    if (!entityId) return json({ error: kind === "company" ? "Empresa obrigatória" : "Médico obrigatório" }, 400);

    // Para médico: importa dados do cadastro automaticamente e bloqueia se inativo
    let linkedDoctorId: string | null = null;
    let linkedDoctorName: string | null = null;
    const importedFields: Record<string, unknown> = {};
    if (kind === "doctor") {
      const { data: doc, error: docErr } = await admin
        .from("doctors")
        .select("id, full_name, email, cpf, phone, active")
        .eq("id", entityId)
        .maybeSingle();
      if (docErr || !doc) return json({ error: "Médico não encontrado" }, 404);
      if (!doc.active) return json({ error: "Médico inativo. Reative o cadastro antes de criar acesso ao portal." }, 400);
      linkedDoctorId = doc.id;
      linkedDoctorName = doc.full_name ?? null;
      if (!fullName && doc.full_name) { fullName = doc.full_name; importedFields.full_name = doc.full_name; }
      if (!email && doc.email) { email = (doc.email ?? "").trim().toLowerCase(); importedFields.email = email; }
      if (!cpf && doc.cpf) { cpf = String(doc.cpf).replace(/\D/g, ""); importedFields.cpf = cpf; }
      if (!phone && doc.phone) { phone = String(doc.phone).replace(/\D/g, ""); importedFields.phone = phone; }
    }

    if (!email) return json({ error: "E-mail obrigatório" }, 400);

    // Validação CPF (se informado)
    if (cpf) {
      if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return json({ error: "CPF inválido" }, 400);
      const calc = (base: string, factor: number) => {
        let sum = 0;
        for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
        const r = (sum * 10) % 11;
        return r === 10 ? 0 : r;
      };
      if (calc(cpf.slice(0, 9), 10) !== Number(cpf[9])) return json({ error: "CPF inválido" }, 400);
      if (calc(cpf.slice(0, 10), 11) !== Number(cpf[10])) return json({ error: "CPF inválido" }, 400);
    }
    if (phone && phone.length !== 11) return json({ error: "Telefone inválido (use DDD + 9 dígitos)" }, 400);

    const portalTable = kind === "company" ? "company_portal_users" : "doctor_portal_users";
    const linkTable = kind === "company" ? "company_portal_user_hospitals" : "doctor_portal_user_hospitals";
    const parentFk = kind === "company" ? "company_id" : "doctor_id";

    // 1) Auth user (invite ou createUser com senha temporária)
    let newUserId: string | null = null;
    let tempPassword: string | null = null;
    const userMeta = { full_name: fullName, portal_kind: kind };

    // Reaproveita usuário se já existe (mesmo email)
    const { data: existingByEmail } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingByEmail?.id) {
      newUserId = existingByEmail.id;
    } else if (sendInvite) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: userMeta,
        redirectTo,
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    } else {
      tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { ...userMeta, must_reset_password: true },
      });
      if (error) throw error;
      newUserId = data.user?.id ?? null;
    }

    if (!newUserId) throw new Error("Falha ao criar usuário");

    // 2) Profile — enriquece com CPF/telefone
    const profilePayload: Record<string, unknown> = { id: newUserId, email };
    if (fullName) profilePayload.full_name = fullName;
    if (cpf) profilePayload.cpf = cpf;
    if (phone) profilePayload.phone = phone;
    await admin.from("profiles").upsert(profilePayload, { onConflict: "id" });


    // 3) IMPORTANTE: NÃO insere em user_roles — portal não tem acesso ao Exacta

    // 4) Vínculo na tabela de portal (reativa se já existir)
    const { data: existingLink } = await admin
      .from(portalTable)
      .select("id")
      .eq("user_id", newUserId)
      .eq(parentFk, entityId)
      .maybeSingle();

    let portalRowId: string;
    if (existingLink?.id) {
      portalRowId = existingLink.id;
      await admin.from(portalTable).update({ active: true }).eq("id", existingLink.id);
    } else {
      const { data: inserted, error: insErr } = await admin
        .from(portalTable)
        .insert({
          user_id: newUserId,
          [parentFk]: entityId,
          invited_by: userData.user.id,
          invited_at: new Date().toISOString(),
          active: true,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      portalRowId = inserted.id;
    }

    // 5) Hospitais
    if (hospitalIds.length > 0) {
      await admin.from(linkTable).delete().eq("portal_user_id", portalRowId);
      const payload = hospitalIds.map((hid) => ({
        portal_user_id: portalRowId,
        hospital_id: hid,
        is_primary: hid === primaryHospitalId,
      }));
      const { error: linkErr } = await admin.from(linkTable).insert(payload);
      if (linkErr) throw linkErr;
    }

    // Auditoria — entity_types compatíveis com check constraint do audit_log
    const auditRows: Array<Record<string, unknown>> = [
      {
        actor_id: userData.user.id,
        entity_type: "user",
        entity_id: newUserId,
        action: "created",
        diff: {
          context: `portal_user_${kind}`,
          email,
          full_name: fullName,
          entity_id: entityId,
          portal_row_id: portalRowId,
          hospital_ids: hospitalIds,
        },
      },
    ];

    // Log da importação automática dos dados do médico (quando aplicável)
    if (kind === "doctor" && Object.keys(importedFields).length > 0 && linkedDoctorId) {
      auditRows.push({
        actor_id: userData.user.id,
        entity_type: "doctor",
        entity_id: linkedDoctorId,
        action: "updated",
        diff: {
          reason: "portal_user_auto_import",
          imported_fields: importedFields,
          portal_user_id: newUserId,
          portal_row_id: portalRowId,
          doctor_full_name: linkedDoctorName,
        },
      });
      auditRows.push({
        actor_id: userData.user.id,
        entity_type: "user",
        entity_id: newUserId,
        action: "updated",
        diff: {
          reason: "portal_user_auto_import_from_doctor",
          doctor_id: linkedDoctorId,
          doctor_full_name: linkedDoctorName,
          imported_fields: importedFields,
        },
      });
    }

    await admin.from("audit_log").insert(auditRows);

    return json({ success: true, user_id: newUserId, portal_row_id: portalRowId, temp_password: tempPassword });
  } catch (e) {
    console.error("admin-create-portal-user error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
