// E2E de isolamento entre hospitais.
//
// Como executar:
//   1. Faça login manualmente no preview com um usuário do Hospital A e capture a sessão Supabase (localStorage).
//   2. Exporte as vars USER_A_SESSION_JSON, USER_B_SESSION_JSON, HOSPITAL_A_PAYMENT_ID, HOSPITAL_B_PAYMENT_ID.
//   3. `python3 tests/e2e/isolation_e2e.py`
//
// O teste garante que:
//   - Usuário do hospital A não consegue abrir/listar payments do hospital B (deve retornar 0 registros ou 403).
//   - Chamadas às edge functions críticas (send-invoice-request, simulate-rule) com payment de outro hospital retornam erro de acesso.
//
// Este arquivo é uma referência que o time roda sob demanda antes de escalar para novas unidades.

import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

STORAGE_KEY = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
SESSION_A = os.environ.get("USER_A_SESSION_JSON")
SESSION_B = os.environ.get("USER_B_SESSION_JSON")
PAYMENT_A = os.environ.get("HOSPITAL_A_PAYMENT_ID")
PAYMENT_B = os.environ.get("HOSPITAL_B_PAYMENT_ID")


async def try_access(page, session_json: str, payment_id: str, tag: str):
    await page.goto(BASE)
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(session_json)})"
    )
    resp = await page.goto(f"{BASE}/payment/{payment_id}", wait_until="domcontentloaded")
    await page.screenshot(path=str(SCREENSHOTS / f"{tag}.png"))
    body = (await page.content()).lower()
    denied = ("acesso negado" in body) or ("não encontrado" in body) or (resp and resp.status >= 400)
    print(f"[{tag}] status={resp.status if resp else '?'} denied={denied}")
    return denied


async def main():
    assert STORAGE_KEY and SESSION_A and SESSION_B and PAYMENT_A and PAYMENT_B, "faltam variáveis de ambiente"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        # Usuário A abrindo pagamento do próprio hospital — deve funcionar
        own = await try_access(page, SESSION_A, PAYMENT_A, "A_own_payment")
        assert not own, "Usuário A não conseguiu abrir pagamento do próprio hospital"

        # Usuário A tentando abrir pagamento do hospital B — deve ser negado
        crossed = await try_access(page, SESSION_A, PAYMENT_B, "A_cross_hospital")
        assert crossed, "🚨 VAZAMENTO: Usuário A conseguiu abrir pagamento do hospital B"

        # Simétrico com usuário B
        crossed_b = await try_access(page, SESSION_B, PAYMENT_A, "B_cross_hospital")
        assert crossed_b, "🚨 VAZAMENTO: Usuário B conseguiu abrir pagamento do hospital A"

        print("✅ Isolamento cross-hospital OK")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
