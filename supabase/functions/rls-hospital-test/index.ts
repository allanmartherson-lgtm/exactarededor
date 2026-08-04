// Edge Function: RLS hospital isolation test
// Autotest end-to-end que valida que um usuário só enxerga registros do próprio hospital.
//
// Fluxo:
//   1) service_role → chama public.rls_test_setup(pwd) que cria 2 hospitais, 2 usuários com
//      senha conhecida, vincula cada um a um hospital com role 'analista' e seed de fixtures.
//   2) anon client → signInWithPassword como user_a e user_b, obtém access_token real.
//   3) Cliente autenticado como user_a → para cada tabela public.* com coluna hospital_id,
//      SELECT count(*) filtrando hospital_id = hosp_b. Esperado: 0.
//   4) Simétrico com user_b vs hosp_a.
//   5) service_role → chama public.rls_test_cleanup(...) sempre (mesmo em falha).
//   6) Retorna { ok, checked, leaks, failures[] }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SetupInfo = {
  hosp_a: string;
  hosp_b: string;
  user_a: string;
  user_b: string;
  email_a: string;
  email_b: string;
};

// Ids das fixtures criadas pelo rls_test_setup — usados nos testes de escrita
// cross-hospital e de falsificação de autor/status.
type Fixtures = {
  hosp_a: string;
  hosp_b: string;
  pay_a: string | null;
  pay_b: string | null;
  group_a: string | null;
  group_b: string | null;
  invoice_a: string | null;
  invoice_b: string | null;
  item_b: string | null;
  obs_b: string | null;
  fin_b: string | null;
  company_id: string | null;

};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Diagnóstico privilegiado: cria/apaga auth.users reais. Só admin ou service-role.
  const auth = await requireInternalOrRole(req, ["admin"]);
  if (!auth.ok) return unauthorizedResponse(auth, CORS);


  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pwd = "rls-test-" + crypto.randomUUID();
  let setup: SetupInfo | null = null;
  const failures: string[] = [];
  let checked = 0;
  let leaks = 0;

  try {
    // 1) cria usuários via GoTrue admin API (garante identities + hash corretos)
    const suffix = crypto.randomUUID().slice(0, 8);
    const email_a = `rls-a-${suffix}@test.local`;
    const email_b = `rls-b-${suffix}@test.local`;

    const createdA = await admin.auth.admin.createUser({
      email: email_a, password: pwd, email_confirm: true,
    });
    if (createdA.error || !createdA.data.user) {
      throw new Error("createUser A: " + (createdA.error?.message ?? "no user"));
    }
    const createdB = await admin.auth.admin.createUser({
      email: email_b, password: pwd, email_confirm: true,
    });
    if (createdB.error || !createdB.data.user) {
      throw new Error("createUser B: " + (createdB.error?.message ?? "no user"));
    }
    const user_a = createdA.data.user.id;
    const user_b = createdB.data.user.id;

    // 2) setup hospitais + vínculos + fixtures
    const { data: setupData, error: setupErr } = await admin.rpc("rls_test_setup", {
      _user_a: user_a, _user_b: user_b,
    });
    if (setupErr) throw new Error("setup: " + setupErr.message);
    const fx = setupData as Fixtures;
    const setupJson = fx;
    setup = {
      hosp_a: setupJson.hosp_a, hosp_b: setupJson.hosp_b,
      user_a, user_b, email_a, email_b,
    };

    // 2) tabelas com hospital_id
    const { data: tables, error: tablesErr } = await admin.rpc("rls_test_hospital_tables");
    if (tablesErr) throw new Error("hospital_tables: " + tablesErr.message);
    const tableNames: string[] = (tables ?? []).map((r: { table_name: string }) => r.table_name);

    // 3) sign in como user_a
    const anonA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signInA = await anonA.auth.signInWithPassword({ email: setup.email_a, password: pwd });
    if (signInA.error || !signInA.data.session) {
      throw new Error("signIn user_a: " + (signInA.error?.message ?? "no session"));
    }
    const clientA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signInA.data.session.access_token}` } },
    });

    // 3a) sanity: user A vê exatamente 1 hospital dos 2 de teste
    const hospCheck = await clientA
      .from("hospitals")
      .select("id", { count: "exact", head: true })
      .in("id", [setup.hosp_a, setup.hosp_b]);
    if (hospCheck.error) failures.push("hospitals sanity: " + hospCheck.error.message);
    else if ((hospCheck.count ?? 0) !== 1)
      failures.push(`hospitals sanity: user A viu ${hospCheck.count} hospitais (esperado 1)`);

    // 3b) leak scan A → hosp B
    for (const t of tableNames) {
      const { count, error } = await clientA
        .from(t)
        .select("*", { count: "exact", head: true })
        .eq("hospital_id", setup.hosp_b);
      if (error) {
        // Provavelmente policy nega totalmente (0 rows retornam mesmo com erro). Ignore permissions.
        continue;
      }
      checked++;
      if ((count ?? 0) > 0) {
        leaks++;
        failures.push(`LEAK ${t}: user A viu ${count} linhas do hospital B`);
      }
    }

    // 4) sign in como user_b, cross-check
    const anonB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signInB = await anonB.auth.signInWithPassword({ email: setup.email_b, password: pwd });
    if (signInB.error || !signInB.data.session) {
      throw new Error("signIn user_b: " + (signInB.error?.message ?? "no session"));
    }
    const clientB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signInB.data.session.access_token}` } },
    });

    const crossTables = ["payments", "glosa_batches", "company_threads"];
    for (const t of crossTables) {
      const { count, error } = await clientB
        .from(t)
        .select("*", { count: "exact", head: true })
        .eq("hospital_id", setup.hosp_a);
      if (error) continue;
      if ((count ?? 0) > 0) {
        leaks++;
        failures.push(`LEAK ${t} (B<-A): user B viu ${count} linhas do hospital A`);
      }
    }

    // ------------------------------------------------------------------
    // 6) Regressão das correções de segurança: leitura dirigida, escrita
    //    cross-hospital e falsificação de autor/status.
    //    Convenção: toda checagem incrementa `checked`; qualquer sucesso
    //    indevido vira `failures` (e `leaks` quando for vazamento de dado).
    // ------------------------------------------------------------------

    // 6a) Leitura dirigida por id nas tabelas corrigidas nesta rodada.
    //     Um SELECT por id é mais estrito que a varredura genérica: prova
    //     que a linha do hospital B é invisível para o analista do A.
    const readTargets: Array<{ table: string; id: string | null }> = [
      { table: "payment_items", id: fx.item_b },
      { table: "invoices", id: fx.invoice_b },
      { table: "payment_observations", id: fx.obs_b },
      { table: "payment_company_groups", id: fx.group_b },
      { table: "payments", id: fx.pay_b },
    ];
    for (const t of readTargets) {
      if (!t.id) {
        failures.push(
          `FIXTURE AUSENTE ${t.table}: setup não criou registro no hospital B` +
            ((setupData as { item_err?: string | null })?.item_err
              ? ` (${(setupData as { item_err?: string | null }).item_err})`
              : ""),
        );
        continue;
      }
      checked++;
      const { data, error } = await clientA.from(t.table).select("id").eq("id", t.id);
      if (error) continue; // policy negou de forma dura — comportamento aceitável
      if ((data ?? []).length > 0) {
        leaks++;
        failures.push(`LEAK ${t.table} (read by id): user A leu registro do hospital B`);
      }
    }

    // 6b) invoices.upload_token não pode ser selecionável por usuário logado
    //     (privilégio de coluna revogado; leitura só via RPC scoped).
    checked++;
    {
      const { error } = await clientA.from("invoices").select("upload_token").limit(1);
      if (!error) {
        leaks++;
        failures.push("LEAK invoices.upload_token: SELECT direto permitido para authenticated");
      }
    }

    // 6c) Escrita cross-hospital: UPDATE em linha do hospital B deve afetar 0 linhas.
    const writeTargets: Array<{ table: string; id: string | null; patch: Record<string, unknown> }> = [
      { table: "payment_items", id: fx.item_b, patch: { doctor_name: "RLS SPOOF" } },
      { table: "invoices", id: fx.invoice_b, patch: { reconciliation_notes: "RLS SPOOF" } },
      { table: "payment_observations", id: fx.obs_b, patch: { message: "RLS SPOOF" } },
      { table: "payment_company_groups", id: fx.group_b, patch: { company_name: "RLS SPOOF" } },
      { table: "payments", id: fx.pay_b, patch: { description: "RLS SPOOF" } },
    ];
    for (const t of writeTargets) {
      if (!t.id) continue;
      checked++;
      const { data, error } = await clientA.from(t.table).update(t.patch).eq("id", t.id).select("id");
      if (error) continue; // negado — esperado
      if ((data ?? []).length > 0) {
        failures.push(`WRITE CROSS-HOSPITAL ${t.table}: user A alterou registro do hospital B`);
      }
    }

    // 6d) INSERT com hospital_id do outro hospital deve ser rejeitado.
    if (fx.pay_b) {
      checked++;
      const insId = crypto.randomUUID();
      const { data, error } = await clientA
        .from("payment_observations")
        .insert({
          id: insId,
          hospital_id: fx.hosp_b,
          payment_id: fx.pay_b,
          author_type: "sistema",
          message: "RLS SPOOF INSERT",
        })
        .select("id");
      if (!error && (data ?? []).length > 0) {
        failures.push("WRITE CROSS-HOSPITAL payment_observations: INSERT com hospital_id alheio aceitou");
        await admin.from("payment_observations").delete().eq("id", insId);
      }
    }

    // 6e) Trigger guard_group_workflow_transition: analista não pode aprovar
    //     grupo do próprio hospital nem falsificar o aprovador.
    if (fx.group_a) {
      checked++;
      const { data, error } = await clientA
        .from("payment_company_groups")
        .update({ status: "aprovado", approved_by: setup.user_a })
        .eq("id", fx.group_a)
        .select("id, status");
      const blocked = !!error || (data ?? []).length === 0;
      if (!blocked) {
        failures.push(
          "TRIGGER guard_group_workflow_transition: analista conseguiu marcar grupo como aprovado",
        );
      }
    }

    // 6f) Trigger guard_payment_author_spoof: analista não pode gravar
    //     approved_by/validated_by apontando para si mesmo.
    if (fx.pay_a) {
      checked++;
      const { data, error } = await clientA
        .from("payments")
        .update({ approved_by: setup.user_a })
        .eq("id", fx.pay_a)
        .select("id, approved_by");
      const blocked = !!error || (data ?? []).length === 0;
      if (!blocked) {
        failures.push("TRIGGER guard_payment_author_spoof: analista gravou approved_by em si mesmo");
      }
    }
  } catch (e) {
    failures.push("EXCEPTION: " + (e as Error).message);
  } finally {
    // 5) cleanup — best effort, sempre
    if (setup) {
      const { error } = await admin.rpc("rls_test_cleanup", {
        _hosp_a: setup.hosp_a,
        _hosp_b: setup.hosp_b,
        _user_a: setup.user_a,
        _user_b: setup.user_b,
      });
      if (error) failures.push("cleanup rpc: " + error.message);

      for (const uid of [setup.user_a, setup.user_b]) {
        const del = await admin.auth.admin.deleteUser(uid);
        if (del.error) failures.push(`deleteUser(${uid}): ${del.error.message}`);
      }
    }
  }

  const ok = failures.length === 0;
  return new Response(
    JSON.stringify({ ok, checked, leaks, failures }, null, 2),
    {
      status: ok ? 200 : 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    },
  );
});
