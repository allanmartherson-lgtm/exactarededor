"""
E2E Playwright — Estado vazio de filtros no detalhe do lote.

Fluxo:
1. Autentica com a sessão Supabase injetada.
2. Abre um lote conhecido (HDF Maio/2026 — 139 empresas).
3. Aplica filtros conflitantes ("Financeiro > Com glosas em aberto" + "Pend. cadastro")
   até chegar no estado vazio ("Nenhum grupo ou item casa com os filtros selecionados.").
4. Clica em "Limpar todos os filtros" na mensagem de vazio.
5. Confirma que os grupos de empresas voltam a aparecer.

Rodar:
    python3 tests/e2e/payment-filters-empty-state.py
"""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect

PAYMENT_ID = "c188e09b-128c-49c2-872d-d4464d7c33ac"
BASE_URL = "http://localhost:8080"
SCREENSHOTS = Path("/tmp/browser/payment-filters-empty") / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if not (storage_key and session_json):
        raise RuntimeError("Sessão Supabase não injetada — aborte.")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)
    await page.goto(BASE_URL)
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )


async def click_financeiro_glosas(page):
    """Abre o dropdown 'Financeiro' na barra de filtros e ativa 'Com glosas em aberto'."""
    # O botão de filtro tem title="Filtrar empresas deste lote por glosas...".
    btn = page.locator("button[title^='Filtrar empresas deste lote']")
    await expect(btn).to_be_visible(timeout=10000)
    await btn.scroll_into_view_if_needed()
    await btn.click()
    item = page.get_by_role("menuitemcheckbox", name="Com glosas em aberto")
    await expect(item).to_be_visible(timeout=5000)
    await item.click()
    await page.keyboard.press("Escape")


async def click_pend_cadastro(page):
    """Ativa o filtro 'Pend. cadastro' — normalmente reduz drasticamente a lista."""
    btn = page.locator("button", has_text="Pend. cadastro").first
    await btn.scroll_into_view_if_needed()
    await btn.click(force=True)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        await restore_session(context, page)
        await page.goto(f"{BASE_URL}/pagamentos/{PAYMENT_ID}", wait_until="domcontentloaded")

        # Espera o lote carregar (barra de filtros aparece).
        await expect(page.locator("button:has-text('Financeiro')").last).to_be_visible(timeout=30000)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SCREENSHOTS / "1_loaded.png"))

        # 1) Aplica filtros conflitantes até chegar no estado vazio.
        await click_financeiro_glosas(page)
        await page.wait_for_timeout(1500)
        await click_pend_cadastro(page)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SCREENSHOTS / "2_filters_applied.png"))

        empty = page.get_by_text("Nenhum grupo ou item casa com os filtros selecionados.")
        # Fallback: se a combinação escolhida ainda retornar resultados neste lote,
        # força o estado vazio via busca por termo inexistente.
        try:
            await expect(empty).to_be_visible(timeout=5000)
        except Exception:
            search = page.get_by_placeholder("Buscar médico, paciente, atendimento, CC…")
            await search.fill("__ZZZ_INEXISTENTE_ZZZ__")
            await page.wait_for_timeout(1500)
            await expect(empty).to_be_visible(timeout=5000)
        await page.screenshot(path=str(SCREENSHOTS / "3_empty_state.png"))
        print("✓ Estado vazio renderizado")

        # 2) Clica em "Limpar todos os filtros" na própria mensagem.
        clear_btn = page.get_by_role("button", name="Limpar todos os filtros")
        await expect(clear_btn).to_be_visible()
        await clear_btn.click()
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(SCREENSHOTS / "4_after_clear.png"))

        # 3) Confirma que os grupos voltaram — a mensagem de vazio desaparece
        #    e ao menos um card de empresa aparece.
        await expect(empty).to_have_count(0, timeout=5000)
        # Cards de empresa têm o texto "· X itens · R$".
        first_group = page.locator("text=/·\\s+\\d+\\s+itens\\s+·/").first
        await expect(first_group).to_be_visible(timeout=5000)
        print("✓ Lista de empresas restaurada após limpar filtros")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
