
## Objetivo
Deixar a coluna "A Recuperar" refletir de forma explícita a comparação **valor com acordo (recalculado a partir do TASY) vs valor pago histórico no Exacta**, e não só o caso de "pago a mais". Passa a suportar também "a complementar" (pago a menos).

## Diagnóstico do que existe hoje
Arquivo: `src/components/retroactive/RetroactiveReconciliationsTab.tsx` (linhas ~3119-3141).

Hoje:
```
fator = valor_com_acordo / valor_pago_base   // % de acordo praticado no lote
a_recuperar = |dif_valor| × fator            // só quando dif_valor < 0 (pago a mais)
             = fator × (valor_pago_base − valor_total_tasy)
```

Matematicamente isso é **idêntico** a:
```
valor_com_acordo_recalc = valor_total_tasy × fator   // TASY convertido p/ o mesmo % de acordo
a_recuperar = valor_com_acordo (original do lote) − valor_com_acordo_recalc
```

Ou seja: já cobre o caso "acordo 100% → base TASY" e "acordo 88% → TASY × 88%" que você descreveu. O problema é conceitual/apresentação:

1. Só calcula quando `dif_valor < 0` (pago a mais). Se o TASY mostrar volume maior que o lote (pago a menos), não gera "a complementar".
2. A fórmula escrita no código não é legível — quem lê `|dif_valor| × fator` não entende que é acordo vs acordo.
3. O rótulo "A Recuperar" é assimétrico; precisa acomodar valores negativos (complemento).

## Mudança proposta

### 1. Recalcular explicitamente (linhas ~3135-3141)
```ts
// % de acordo efetivamente praticado no lote (ex: 100%, 88%, 27,51%)
const fator_acordo = valor_pago_base > 0 ? valor_com_acordo / valor_pago_base : 1;

// Valor que a regra pagaria HOJE se aplicasse o mesmo acordo sobre a base TASY
const valor_com_acordo_recalc = valor_total_tasy * fator_acordo;

// Positivo = paguei a mais (a recuperar). Negativo = paguei a menos (a complementar).
const ajuste_acordo = valor_com_acordo - valor_com_acordo_recalc;
```

Casos:
- `ausente_tasy` (TASY = 0, glosa ou linha inexistente): `valor_com_acordo_recalc = 0` → ajuste = `valor_com_acordo` inteiro a recuperar. Mesmo resultado de hoje.
- `pago_a_mais` (TASY < base): ajuste positivo, mesmo número de hoje.
- `div_valor` / `div_qtd_valor` com TASY > base (**caso novo**): ajuste negativo → complemento devido ao médico.
- `nao_pago` (só TASY, sem base): não temos `fator_acordo` — mantém regra atual da tela de confecção (pré-carga com `valor_total_tasy`), não entra em "a recuperar".
- `ok`: ajuste ≈ 0.

### 2. Nomear e mostrar
- Renomear campo interno `valor_recuperar_acordo` → `ajuste_acordo` (com getter `valor_recuperar_acordo` legado retornando `max(0, ajuste_acordo)` para não quebrar exports/glosa).
- Coluna da tabela: título "Ajuste (c/ acordo)". Formatação:
  - `> 0.5` → vermelho, prefixo "A recuperar"
  - `< -0.5` → laranja, prefixo "A complementar"
  - senão "—"
- Manter a linha do "cálculo aplicado" (regra/fator) logo abaixo, como você pediu antes.

### 3. Downstream — nada muda de comportamento hoje
- Glosa de auditoria: continua filtrando `ajuste_acordo > 0.5` (só recuperação vira glosa). Confecção continua tratando `nao_pago` + diferenças positivas de qtd/valor.
- Complemento (`ajuste_acordo < -0.5`) por enquanto **só exibe** na tela e no export. Encaminhamento automático para adjustment de complemento fica fora deste plano — pedir depois se quiser.

### 4. Export xlsx
Adicionar 2 colunas: "Valor c/ Acordo (recalc)" e "Ajuste (c/ acordo)". Manter "A Recuperar (c/ acordo)" por retrocompat lendo `max(0, ajuste_acordo)`.

### 5. Onde o "apoio de IA" entra
Você mencionou IA para casos de acordo variável. **Neste plano não precisa** — o `fator_acordo` já é observável no lote (razão entre `valor_com_acordo` e `valor_pago_base` que o motor gravou). IA só seria útil se um item tivesse acordo desconhecido (ex: `valor_pago_base = 0` ou item sem regra aplicada). Nesse caso, ao invés de chutar, marco `ajuste_acordo = null` e mostro "sem base de acordo — revisar" (o analista decide). Se quiser, num passo futuro plugo o `useCopilot` para sugerir o fator olhando itens vizinhos do mesmo convênio/função/PJ.

## Fora do escopo
- Criar `company_financial_adjustments` de complemento automático para `ajuste_acordo < 0`.
- Mudar regras de status TVR (`nao_pago`, `pago_a_mais` etc.) — mantidos.
- Mudar motor de conciliação do lote.

## Riscos
- Baixo. Numericamente o valor de "a recuperar" para itens já classificados como `pago_a_mais`/`ausente_tasy` continua idêntico. A novidade é passar a mostrar valor negativo em itens `div_valor` que hoje mostram "—".
- Contar dobrado: garantir que totalizadores continuam somando só `> 0.5` para "recuperar" e adicionar linha separada "a complementar" no rodapé.

## Confirma?
Se OK, implemento: (a) refator do cálculo + campo `ajuste_acordo`, (b) rótulo/coluna bicolor, (c) export xlsx com as 2 colunas novas, (d) rodapé da tabela com totais separados de recuperar/complementar.
