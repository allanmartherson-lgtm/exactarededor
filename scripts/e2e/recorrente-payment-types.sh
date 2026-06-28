#!/bin/bash
# E2E: ajuste recorrente com payment_type_ids + data_fim
# 1. Restringe a "Parecer Adulto" → aplica nesse lote, ignora "Produção"
# 2. Encerra ao recuar data_fim para antes da competência
set -e

COMPANY="1fc1e5fa-63c7-419f-8434-23561150a850"   # CLINICA MEDICA MEDCLIN LTDA
TYPE_PARECER="5b9c6f59-d7a6-444e-9ba8-a15161eaad69"
PAY_PARECER="f2853a23-eb1b-4862-9c7e-b19d1ece6e66"  # competence 2026-05-01
PAY_PRODUCAO="28f27492-56c9-4c58-a99d-c95f74156588" # competence 2026-01-01 (type Produção)

URL="${SUPABASE_URL}/functions/v1/apply-company-deductions"
AUTH="Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
APIKEY="apikey: ${SUPABASE_SERVICE_ROLE_KEY}"

call() {
  curl -s -X POST "$URL" -H "$AUTH" -H "$APIKEY" -H "Content-Type: application/json" \
    -d "{\"payment_id\":\"$1\",\"company_id\":\"$COMPANY\"}"
}

REST="${SUPABASE_URL}/rest/v1"
del() {
  # $1 = table, $2 = filter querystring
  curl -s -X DELETE "$REST/$1?$2" -H "$AUTH" -H "$APIKEY" -H "Prefer: return=minimal" >/dev/null
}
cleanup() {
  echo "--- CLEANUP ---"
  # find ids first
  IDS=$(curl -s "$REST/company_financial_adjustments?select=id&descricao=like.E2E_RECORRENTE_TEST*" -H "$AUTH" -H "$APIKEY" | python3 -c "import sys,json;print(','.join(r['id'] for r in json.load(sys.stdin)))")
  if [ -n "$IDS" ]; then
    del "company_adjustment_applications" "adjustment_id=in.($IDS)"
    del "company_financial_adjustments" "id=in.($IDS)"
  fi
}
trap cleanup EXIT
cleanup

echo "=== STEP 1: insere ajuste recorrente restrito a Parecer Adulto, data_fim 2026-12-31 ==="
ADJ_ID=$(psql -tA -c "insert into company_financial_adjustments (company_id, tipo, descricao, valor_total, parcelas_total, parcelas_pagas, data_inicio, ativo, recorrente, data_fim, payment_type_ids) values ('$COMPANY','debito','E2E_RECORRENTE_TEST mensalidade software',150.00,1,0,'2026-01-01',true,true,'2026-12-31',ARRAY['$TYPE_PARECER']::uuid[]) returning id;" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
echo "adjustment_id=$ADJ_ID"

echo
echo "=== STEP 2: motor no lote PARECER (deve aplicar mensal R$150) ==="
R1=$(call "$PAY_PARECER")
echo "$R1" | python3 -m json.tool
PROP1=$(echo "$R1" | python3 -c "import sys,json;print(json.load(sys.stdin)['summary']['debitos']['proposed'])")
[ "$PROP1" = "1" ] || { echo "FAIL: esperava proposed=1, recebi $PROP1"; exit 1; }
echo "OK ✓ proposed=1 no lote Parecer"

echo
echo "=== STEP 3: motor no lote PRODUÇÃO (deve ignorar — tipo restrito) ==="
R2=$(call "$PAY_PRODUCAO")
echo "$R2" | python3 -m json.tool
PROP2=$(echo "$R2" | python3 -c "import sys,json;print(json.load(sys.stdin)['summary']['debitos']['proposed'])")
[ "$PROP2" = "0" ] || { echo "FAIL: esperava proposed=0 no lote Produção, recebi $PROP2"; exit 1; }
echo "OK ✓ proposed=0 no lote Produção (filtro payment_type_ids funciona)"

echo
echo "=== STEP 4: encurta data_fim para 2026-04-30 (antes da competência 2026-05-01) ==="
curl -s -X PATCH "$REST/company_financial_adjustments?id=eq.$ADJ_ID" -H "$AUTH" -H "$APIKEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '{"data_fim":"2026-04-30"}' >/dev/null

echo
echo "=== STEP 5: motor no lote PARECER novamente — deve reverter (encerrado) ==="
R3=$(call "$PAY_PARECER")
echo "$R3" | python3 -m json.tool
REV=$(echo "$R3" | python3 -c "import sys,json;print(json.load(sys.stdin)['summary']['debitos']['reverted_stale'])")
[ "$REV" = "1" ] || { echo "FAIL: esperava reverted_stale=1, recebi $REV"; exit 1; }
echo "OK ✓ reverted_stale=1 (encerramento por data_fim funciona)"

echo
echo "==============================================="
echo "✅ E2E PASSOU: payment_type_ids + data_fim OK"
echo "==============================================="
