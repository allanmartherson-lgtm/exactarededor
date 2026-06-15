/**
 * CONTRATO da feature "Registro externo de aprovação/validação".
 *
 * Trava o comportamento esperado:
 *  - Migration cria colunas, RPCs e GRANTs corretos
 *  - Dialog usa stages/sources permitidos, exige nome do decisor,
 *    sobe anexo no bucket certo e chama os RPCs com os params corretos
 *
 * Se você alterar o nome de um RPC, parâmetros, ou o bucket de evidências,
 * atualize este teste — ele existe para detectar quebras silenciosas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260615182024_38867017-ca9c-415e-be16-4bc1b2877cb3.sql"),
  "utf8",
);

const DIALOG = readFileSync(
  join(ROOT, "src/components/payment-detail/RegisterExternalApprovalDialog.tsx"),
  "utf8",
);

describe("Migration — register_external_approval / register_external_validation", () => {
  it("cria as colunas de approval em payment_company_groups", () => {
    for (const col of [
      "approval_source",
      "approval_on_behalf_of",
      "approval_evidence_path",
      "approval_external_note",
      "approval_registered_by",
    ]) {
      expect(MIGRATION).toContain(col);
    }
  });

  it("cria as colunas de validation em payment_company_groups", () => {
    for (const col of [
      "validation_source",
      "validation_on_behalf_of",
      "validation_evidence_path",
      "validation_external_note",
      "validation_registered_by",
    ]) {
      expect(MIGRATION).toContain(col);
    }
  });

  it("restringe approval_source a system/magic_link/email/whatsapp/outro", () => {
    expect(MIGRATION).toMatch(/approval_source.*CHECK.*'system'.*'magic_link'.*'email'.*'whatsapp'.*'outro'/s);
  });

  it("RPC register_external_approval só aceita canais externos (email/whatsapp/outro)", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_approval"));
    expect(fn).toMatch(/p_source NOT IN \('email','whatsapp','outro'\)/);
  });

  it("RPC register_external_approval exige nome do diretor", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_approval"));
    expect(fn).toMatch(/Informe o nome do diretor/);
  });

  it("RPC register_external_approval exige papel admin/analista/diretor", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_approval"));
    expect(fn).toMatch(/has_role.*'admin'/);
    expect(fn).toMatch(/has_role.*'analista'/);
    expect(fn).toMatch(/has_role.*'diretor'/);
  });

  it("RPC register_external_approval só move grupos em aguardando_aprovacao", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_approval"));
    expect(fn).toMatch(/AND status = 'aguardando_aprovacao'/);
    expect(fn).toMatch(/SET status = 'revisao_pos_aprovacao'/);
  });

  it("RPC register_external_approval falha se nem todos os grupos foram atualizados", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_approval"));
    expect(fn).toMatch(/Aprovação externa bloqueada/);
  });

  it("RPC register_external_approval grava trilha em payment_observations", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_approval"));
    expect(fn).toMatch(/INSERT INTO public\.payment_observations/);
    expect(fn).toMatch(/Aprovação externa registrada/);
  });

  it("RPC register_external_validation exige papel admin/analista/validador", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_validation"));
    expect(fn).toMatch(/has_role.*'admin'/);
    expect(fn).toMatch(/has_role.*'analista'/);
    expect(fn).toMatch(/has_role.*'validador'/);
  });

  it("RPC register_external_validation move aguardando_validacao → aguardando_aprovacao", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("register_external_validation"));
    expect(fn).toMatch(/AND status = 'aguardando_validacao'/);
    expect(fn).toMatch(/SET status = 'aguardando_aprovacao'/);
  });

  it("ambos os RPCs têm GRANT EXECUTE para authenticated", () => {
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_external_approval[^;]+TO authenticated/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_external_validation[^;]+TO authenticated/);
  });
});

describe("RegisterExternalApprovalDialog — contrato do componente", () => {
  it("declara stages 'validation' e 'approval'", () => {
    expect(DIALOG).toMatch(/type Stage = "validation" \| "approval"/);
  });

  it("oferece apenas canais externos (email, whatsapp, outro) — system fica fora", () => {
    expect(DIALOG).toMatch(/type Source = "email" \| "whatsapp" \| "outro"/);
    // 'system' nunca pode aparecer como opção selecionável
    const radioBlock = DIALOG.slice(DIALOG.indexOf("RadioGroup"), DIALOG.indexOf("</RadioGroup>"));
    expect(radioBlock).not.toMatch(/value="system"/);
    expect(radioBlock).not.toMatch(/value="magic_link"/);
  });

  it("só lista grupos elegíveis para a etapa selecionada", () => {
    expect(DIALOG).toMatch(/validation: new Set\(\["aguardando_validacao"\]\)/);
    expect(DIALOG).toMatch(/approval: new Set\(\["aguardando_aprovacao"\]\)/);
  });

  it("exige nome do decisor com no mínimo 3 caracteres antes de enviar", () => {
    expect(DIALOG).toMatch(/personName\.trim\(\)\.length < 3/);
  });

  it("sobe anexo no bucket 'approval-pdfs'", () => {
    expect(DIALOG).toMatch(/\.from\("approval-pdfs"\)/);
  });

  it("chama o RPC correto conforme a etapa", () => {
    expect(DIALOG).toMatch(/stage === "approval" \? "register_external_approval" : "register_external_validation"/);
  });

  it("envia p_director_name para approval e p_supervisor_name para validation", () => {
    expect(DIALOG).toMatch(/p_director_name: personName/);
    expect(DIALOG).toMatch(/p_supervisor_name: personName/);
  });

  it("envia p_evidence_path (caminho do anexo, não a URL pública)", () => {
    expect(DIALOG).toMatch(/p_evidence_path: evidencePath/);
  });

  it("não permite envio quando nenhuma empresa elegível", () => {
    expect(DIALOG).toMatch(/disabled=\{busy \|\| eligible\.length === 0\}/);
  });
});
