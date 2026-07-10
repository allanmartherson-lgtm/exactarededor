"""
Playwright — Verifica que o botão "Entrar com Google" na tela de login
dispara `lovable.auth.signInWithOAuth("google", { redirect_uri: <origin puro> })`
em navegadores Safari/WebKit, em viewports mobile e desktop.

Motivação: o helper `@lovable.dev/cloud-auth-js` valida a resposta `web_message`
do popup contra o `redirect_uri`. Se algum dia voltarmos a concatenar `next` ou
uma rota protegida no `redirect_uri`, o login Google no Safari mobile trava em
"conectando". Este teste falha imediatamente nesse cenário.

Rodar local:
  python tests/e2e/auth-google-safari.py

Requisitos: dev server em http://localhost:8080 (já rodando no sandbox / CI).
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
OUT = Path("/tmp/browser/auth-google-safari")
OUT.mkdir(parents=True, exist_ok=True)

# Viewports representativos: iPhone (Safari mobile), iPad e desktop.
VIEWPORTS = [
    {"name": "iphone-14", "width": 390, "height": 844, "mobile": True},
    {"name": "ipad-air", "width": 820, "height": 1180, "mobile": True},
    {"name": "desktop-hd", "width": 1280, "height": 800, "mobile": False},
]

# Rotas com `next` que NÃO devem contaminar o redirect_uri final.
NEXT_TARGETS = [
    "/",
    "/.lovable/oauth/consent?authorization_id=test-123",
    "/dashboard",
]


async def run_case(playwright, viewport, next_target):
    browser = await playwright.webkit.launch(headless=True)
    context = await browser.new_context(
        viewport={"width": viewport["width"], "height": viewport["height"]},
        is_mobile=viewport["mobile"],
        has_touch=viewport["mobile"],
    )
    page = await context.new_page()

    # Intercepta a chamada real ao helper: substituímos `lovable.auth.signInWithOAuth`
    # por um espião que grava as opções e evita a navegação para o provider.
    await page.add_init_script(
        """
        window.__oauthCalls = [];
        const install = () => {
          const l = window.lovable;
          if (!l || !l.auth || !l.auth.signInWithOAuth) return false;
          const original = l.auth.signInWithOAuth.bind(l.auth);
          l.auth.signInWithOAuth = async (provider, opts) => {
            window.__oauthCalls.push({ provider, opts });
            return { error: null, redirected: false };
          };
          return true;
        };
        if (!install()) {
          const iv = setInterval(() => { if (install()) clearInterval(iv); }, 50);
        }
        """
    )

    url = f"{BASE_URL}/auth?next={next_target}"
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_selector("text=Entrar com Google")
    # Garante que o shim foi instalado antes do clique.
    await page.wait_for_function("() => window.lovable && window.lovable.auth")

    await page.get_by_role("button", name="Entrar com Google").click()

    calls = await page.evaluate("window.__oauthCalls")
    origin = await page.evaluate("window.location.origin")

    shot = OUT / f"{viewport['name']}-{next_target.replace('/', '_').replace('?', '_')}.png"
    await page.screenshot(path=str(shot))

    await browser.close()

    assert len(calls) == 1, f"[{viewport['name']} next={next_target}] esperado 1 chamada, veio {len(calls)}"
    call = calls[0]
    assert call["provider"] == "google", f"provider incorreto: {call['provider']}"
    redirect = (call.get("opts") or {}).get("redirect_uri")
    assert redirect == origin, (
        f"[{viewport['name']} next={next_target}] redirect_uri DEVE ser origin puro "
        f"({origin!r}), mas veio {redirect!r}. Concatenar `next` quebra o web_message "
        "do Safari mobile — reverta a alteração em src/pages/Auth.tsx."
    )
    return {"viewport": viewport["name"], "next": next_target, "redirect_uri": redirect}


async def main():
    results = []
    failures = []
    async with async_playwright() as playwright:
        for vp in VIEWPORTS:
            for nxt in NEXT_TARGETS:
                try:
                    results.append(await run_case(playwright, vp, nxt))
                except AssertionError as e:
                    failures.append(str(e))

    print(json.dumps({"results": results, "failures": failures}, indent=2))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
