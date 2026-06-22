## Objetivo

Aproximar 4 telas do mockup "Apple style" — visual + layout — mantendo dados, rotas e lógica de negócio intactos. Só camada de apresentação.

## Escopo por tela

### 1. BI · Diretoria (topo)
Arquivo: `src/pages/ExecutiveDashboard.tsx` (ou equivalente que renderiza a rota atual de BI).
- Header simplificado: título "BI · Diretoria" + subtítulo "Visão consolidada · competência {mês}", e à direita pills `Semana | Mês | Trimestre | Ano` + date-picker `Mês AAAA`.
- Faixa narrativa branca em card pill: frase única com destaques coloridos (valor mi azul, % verde, valor em risco vermelho).
- Hero grid 2 colunas (8/4):
  - **Esquerda (card azul sólido `--primary`):** TOTAL EM APROVAÇÃO, valor R$ gigante (display font), subtítulo "N lotes ativos · período", badge "+X% vs mês anterior" no canto, três mini-tiles translúcidas (Pago no mês / Lotes encerrados / Taxa de aprovação), e sparkline branca de evolução no rodapé com tooltip ancorado no último ponto.
  - **Direita (card branco):** APROVAÇÃO AUTOMÁTICA · IA, donut SVG 87%/13% com texto central, legenda dois pontos (Automático / Revisão manual). Abaixo, card vermelho-claro "1 lote crítico · R$ X aguardando revisão" + badge "Urgente".

### 2. KPIs (linha de 4 cards)
- 4 cards iguais, largura igual, ordem: Valor em risco, Ciclo médio, Itens aprovados, Glosas registradas.
- Label SMALLCAPS muted, valor display 48px, unidade inline menor.
- Visualização secundária por card:
  - Valor em risco: mini bar-chart 6 barras vermelhas + linha "X% do total · 1 lote crítico"
  - Ciclo médio: pill verde "0,4d mais rápido" + subtítulo
  - Itens aprovados: 6 mini-blocos azul-claros (último destacado) + subtítulo
  - Glosas: pill verde "Zero glosas" + subtítulo

### 3. Funil + Evolução + Por analista
- **Funil**: card único largura total, 5 etapas conectadas por chevron `›`, cada etapa mostra dot colorido, label, valor grande, R$ abaixo, barra de progresso fina. Etapa "Pago" em verde, demais em azul/cinza.
- **Linha inferior 2/3 + 1/3**:
  - Evolução mensal: gráfico de área azul + linha tracejada vermelha (Em risco), legenda topo-direita, tooltip ancorado.
  - Por analista: lista 4 linhas com avatar inicial colorido, nome, barra de progresso, valor R$, %.

### 4. Detalhe do lote
Arquivo: `src/pages/PaymentDetail.tsx` (header + abas).
- Breadcrumb sutil.
- Título grande + subtítulo "N itens · R$ X".
- Tabs de modo (Detalhe/Compacto/Executivo) como pill-tabs, ao lado botões `Reanalisar lote`, `Validação assistencial (2)`, `…`, e badge status "Devolvido ao analista".
- **Stepper horizontal** 5 etapas (Análise → Validação → Aprovação → Pós-NF → Pago) com linha conectora e dot ativo azul preenchido.
- Linha de metadados em card único com 6 colunas (Competência, Previsão, Tipo, Categoria, Trilha, Centro de Custo, Responsável c/ avatar).
- Bloco "Auditoria de TUSS principal" com header próprio (ícone + título + chip "0 pendências" + refresh), sub-tabs `Abertas (N) | Resolvidas (N)`, estado vazio em card neutro.
- Card lateral direito (sticky) com Alertas Assistenciais resumido + botão flutuante "Conversas".
- Cards "Caso especial" (amarelo suave), "Resumo IA" (com chip Risco baixo verde), "Anomalias comportamentais" (vermelho suave).

## Tokens / design system
- Verificar e ajustar em `src/index.css`:
  - `--primary` azul forte (mantém HSL atual; checar contraste sobre branco).
  - Adicionar tokens semânticos faltantes se necessário: `--surface-elevated`, `--success-soft`, `--warning-soft`, `--danger-soft`, `--info-soft` (versões com baixa opacidade para fundos de card).
  - Raios: cards principais `rounded-2xl`, chips/pills `rounded-full`.
  - Sombras suaves `shadow-sm` em cards.
- Tipografia: usar fonte display já existente para números grandes (tabular-nums). Não trocar família principal sem aval.
- Nenhuma cor hardcoded — só tokens.

## Não inclui
- Mudanças em lógica de cálculo, queries, RLS, edge functions.
- Mudanças em rotas ou navegação.
- Trocar família tipográfica global (a menos que você confirme depois).

## Ordem de execução
1. Tokens + utilitários compartilhados (cards, pill-tabs, stat-tile com sparkline/mini-bars).
2. BI · Diretoria (hero + faixa + donut).
3. Linha de KPIs.
4. Funil + Evolução + Por analista.
5. Detalhe do lote (header + stepper + metadados + auditoria + sidebar).
6. Screenshot de verificação após cada bloco.

## Riscos
- Algumas seções podem estar em componentes compartilhados — vou ler antes de tocar para não quebrar outras telas.
- Donut e sparkline simples em SVG inline (sem nova dependência).