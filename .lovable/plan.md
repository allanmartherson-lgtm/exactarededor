## Objetivo

Resolver as duas dores que apareceram no diagnóstico:

1. O card "Cálculo de pool de rateio" não diz que a run está **inválida** — usuário vê base = bolo e acha que o motor esqueceu a dedução.
2. A tela de "Valores mensais" trata **todo tipo** de dedução como se fosse plantão (valor variável + escala obrigatória). Faz sentido pra plantão, **não faz** pra fixo de coordenação que é o mesmo valor recorrente todo mês.

---

## Parte 1 — Aviso de invalidação no card

Em `PoolCalculationCard.tsx`, quando a run mais recente tem `invalidated_at` preenchido:

- Faixa de alerta vermelha no topo do bloco do pool com:
  - Título: "Pool não recalculado" + motivo legível (mapa de `invalidated_reason`).
  - Para `valor_variavel_competencia_nao_cadastrado`: listar cada `descricao` faltante a partir de `error_detail.items` + botão "Cadastrar valor de {competência}" que abre `/pools/{pool_id}/valores-mensais` numa nova aba/âncora pra dedução certa.
  - Para `item_duplicado_em_outro_pool`: mostrar quantos itens conflitam e link para o pool conflitante.
- Esconder a seção "Rateio" quando inválido (valores não confiáveis).
- Botão "Recalcular" segue ativo.

Carregar `invalidated_at, invalidated_reason, error_detail` no SELECT (já existem na tabela).

---

## Parte 2 — Cadastro inteligente de fixo mensal

### Conceito

Dois modos de "fixo":

- **Fixo recorrente** (coordenação, retainer): mesmo valor todo mês, com vigência aberta. **Não exige escala**, não precisa ser cadastrado mês a mês.
- **Valor variável por competência** (plantão, sobreaviso): valor muda mês a mês, exige escala/comprovante.

Hoje o modelo só tem o flag `valor_variavel` (true/false) — a coluna `valor` em `pool_deductions` já existe e é justamente o caso "recorrente". O problema é puramente de UX: o formulário de pool não deixa claro essa escolha e a tela de valores mensais aceita qualquer tipo.

### Mudanças no formulário de deduções (`Pools.tsx`)

Onde hoje o usuário escolhe `tipo` (`fixo_mensal` / `plantao` / `ajuste_*`):

- Para **`fixo_mensal`**: subescolha "Como é o valor?"
  - **Recorrente (mesmo valor todo mês)** → `valor_variavel=false`, campo `valor` (R$) e opcional `vigencia_inicio` (default = hoje). Aceito direto pelo motor sem precisar abrir a tela mensal.
  - **Varia por competência** → `valor_variavel=true`, vai pra `pool_deduction_values` mensal (caso de fixo que muda).
- Para **`plantao`**: forçar `valor_variavel=true` (não faz sentido recorrente).
- Para **`ajuste_credito/debito/glosa_parcelada`**: já vêm de `company_financial_adjustments`, ocultar a escolha.

Default para `fixo_mensal` passa a ser **recorrente** (resolve o caso clássico do coordenação).

### Mudanças na tela `/pools/:id/valores-mensais` (`PoolMonthlyValues.tsx`)

- Listar **apenas** deduções com `valor_variavel=true`. Hoje lista tudo, o que confunde.
- Para deduções recorrentes mostrar um bloco separado "Valores fixos do pool" (read-only) com link "Editar valor" voltando para o formulário do pool.
- Manter o atual exigir de "Anexar escala" só para `tipo='plantao'`. Para fixo variável (raro), escala vira opcional.

### Mudanças no motor (`recalc-payment-pools/index.ts`)

Nenhuma mudança lógica necessária — o ramo `if (d.valor_variavel)` continua exigindo `pool_deduction_values`; o ramo `else` já usa `Number(d.valor ?? 0)`. Só precisa garantir que a migration de dados existente não obrigue todo `fixo_mensal` antigo a virar variável.

### Data fix imediato

O "Fixo Infectologia" da Infectologistas está como `valor_variavel=true`. Após o ajuste de UI:

- Opção A (sugerida): converter essa dedução para `valor_variavel=false` com `valor=45000`. Resolve jan/2026 e todo mês seguinte automaticamente.
- Opção B: manter variável e gravar `pool_deduction_values` só para jan/2026 (caso eventualmente o valor mude).

Vou pedir confirmação antes da conversão.

---

## Fora de escopo

- Vigência por período no fixo recorrente (`vigencia_inicio` / `vigencia_fim`). Pode entrar depois se houver reajuste anual.
- Histórico de alteração do valor recorrente (audit já cobre via `audit_log` se for ligado).
- Mudança no schema de `pool_deductions` (já tem todas as colunas necessárias).

---

## Detalhes técnicos

Arquivos a editar:

- `src/components/payment-detail/PoolCalculationCard.tsx` — carregar e renderizar `invalidated_*` + deep-link.
- `src/pages/Pools.tsx` — subescolha "recorrente vs variável" no form de dedução; default recorrente para `fixo_mensal`.
- `src/pages/PoolMonthlyValues.tsx` — filtrar para `valor_variavel=true`, bloco read-only com fixos recorrentes, escala opcional fora de plantão.

Tipos: nenhum novo enum. `pool_deductions.valor_variavel` já existe e é o switch certo.

Migration: nenhuma de schema. Eventual UPDATE pontual da dedução `Fixo Infectologia` rodo via insert-tool depois da confirmação do valor.
