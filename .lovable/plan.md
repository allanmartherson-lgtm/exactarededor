# Plano — Testes de integração do fluxo de pacote com distribuição por função

## Objetivo
Garantir, com teste automatizado contra o banco real (Lovable Cloud), que o caminho **base importada → motor (analyze-payment) → distribuição cirurgião/1º aux/2º aux** continua funcionando em cenários fim-a-fim — não só na lógica isolada do `rulesEngine.ts` (que já está coberta nos unit tests).

## Escopo (o que entra)
- Carga de dados sintéticos em `payments` + `payment_items` em uma empresa/hospital de teste isolado.
- Cadastro de uma regra de pacote com `package_roles_distribution` (cirurgião + aux1 + aux2) via `rules` + `rule_calculations`.
- Cadastro de regra catch-all (CBHPM x2 + 20%) para validar precedência por código explícito.
- Disparo do edge function `analyze-payment` com `skip_ai:true` (foco no motor, não na IA).
- Asserts no estado final de `payment_items` (`expected_amount`, `applied_calc_id`, `applied_calc_method`, `status`).
- Cleanup: deletar tudo que o teste criou (rollback transacional não funciona via edge function, então cleanup explícito).

## Fora de escopo
- Upload real de XLSX (parseamento de planilha já tem testes próprios em `parse-base/`).
- Camada de IA (modelos LLM) — `skip_ai:true` evita custo/latência/flakiness.
- UI / interação humana (absorção manual, aprovação).

## Cenários cobertos

| # | Cenário | Resultado esperado |
|---|---|---|
| 1 | Atendimento com cirurgião + 1º aux + 2º aux, mesmo código âncora do pacote | Cada médico recebe `expected_amount` da sua função |
| 2 | Atendimento só com cirurgião | Cirurgião recebe valor do pacote; aux1/aux2 ausentes não geram linhas órfãs |
| 3 | Atendimento com função fora da distribuição (instrumentador) | Instrumentador cai em CBHPM (fallback), pacote não trava |
| 4 | Dois atendimentos no mesmo job | Cada atendimento distribui independentemente (dedup não vaza) |
| 5 | Mesma função 2× no mesmo atendimento (duas vias) | 1º item leva valor, 2º absorvido (expected=0) |
| 6 | Código fora de qualquer pacote | Cai em CBHPM catch-all |
| 7 | Pacote sem distribuição (legado) | Comportamento antigo intacto: valor cheio em 1 item, 0 nos demais |

## Arquivos a criar

```
supabase/functions/analyze-payment/integration_test.ts   ← arquivo principal
supabase/functions/analyze-payment/_integration_setup.ts ← helpers (insert/cleanup)
```

## Detalhes técnicos

### Estratégia de isolamento
Cada teste cria seu próprio `hospital_id` sintético (`it-test-` + uuid) e usa esse como escopo. Cleanup no `finally` apaga: `payment_items`, `payments`, `rule_calculations`, `rules`, `reference_table_items`, `reference_tables`, `doctors`, `companies` que o teste criou (via prefixo de id).

### Helper `setupFixture(hospitalId)`
Cria:
- 1 hospital, 1 empresa PJ, 3 médicos (cirurgião + 2 aux) com `doctor_companies`.
- 1 reference_table CBHPM 2018 com 1 item (código 30803217, valor base).
- 1 rule "Pacote Lobectomia c/ distribuição" com 2 calculations:
  - calc-pacote: `calculation_type=pacote`, `package_main_code=30803217`, `package_amount=29321.93`, `package_roles_distribution=[cirurgiao 19547.95, aux1 5864.39, aux2 3909.59]`
  - calc-cbhpm: `tabela_diferenciada`, `multiplier=2`, `acrescimo_pct=20`, `reference_table_id=<cbhpm>`

### Helper `insertPayment(hospitalId, items)`
Insere `payments` + N `payment_items` com `attendance_number`, `procedure_code`, `doctor_role`, `doctor_id`, `company_id`, `gross_amount`.

### Disparo do motor
```ts
const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-payment`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  body: JSON.stringify({ payment_id, skip_ai: true }),
});
```

Service role key não está acessível em Lovable Cloud — uso ANON + RLS permissiva, ou faço o teste rodar como `authenticated` via JWT de teste. Validar isso na implementação; se bloquear, alternativa é chamar diretamente o handler importando `index.ts` e mockando `createClient` (teste unitário do handler em vez de E2E real).

### Asserts
```ts
const items = await supabase.from("payment_items")
  .select("doctor_role, expected_amount, applied_calc_method")
  .eq("payment_id", paymentId).order("doctor_role");
assertEquals(items.find(i => i.doctor_role === "Cirurgião Principal")?.expected_amount, 19547.95);
assertEquals(items.find(i => i.doctor_role === "Primeiro Aux")?.expected_amount, 5864.39);
assertEquals(items.find(i => i.doctor_role === "Segundo Aux")?.expected_amount, 3909.59);
```

### Como rodar
`supabase--test_edge_functions` com `pattern: "Integração"`. Os testes usam `Deno.test` normalmente e leem `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` via `dotenv/load.ts`.

## Riscos / pontos abertos

1. **Service role indisponível**: se RLS bloquear inserts via anon, o teste vira "handler-level" (importa `index.ts` e injeta supabase client mockado). Decido na implementação após primeiro try.
2. **Latência**: cada `analyze-payment` leva 10-30s mesmo com `skip_ai`. Com 7 cenários, ~3min total. Aceitável para CI manual; não roda em cada push.
3. **Flakiness por estado compartilhado**: prefixar todos os ids com `it-<uuid>-` garante isolamento; cleanup roda mesmo em falha (`try/finally`).
4. **Schema drift**: se colunas críticas mudarem (`package_roles_distribution`, `applied_calc_id`), o teste quebra de forma óbvia — isso é desejável.

## Entrega
Arquivos novos + 1 rodada de execução verde dos 7 cenários. Sem alterações no motor — só cobertura. Se algum cenário falhar, corrijo o motor antes de fechar.
