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

    # Fora de iframe (nosso cenário headless), o helper faz
    # `window.location.href = <broker>?redirect_uri=...` — top-level navigation.
    # Interceptamos qualquer request cujo query contenha `redirect_uri` e
    # abortamos para não sair do domínio.
    captured: list[str] = []

    async def route_handler(route):
        req = route.request
        url = req.url
        if "redirect_uri=" in url:
            captured.append(url)
            await route.abort()
        else:
            await route.continue_()

    await page.route("**/*", route_handler)

    url = f"{BASE_URL}/auth?next={next_target}"
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_selector("text=Entrar com Google")

    origin = await page.evaluate("window.location.origin")

    await page.get_by_role("button", name="Entrar com Google").click()

    # Aguarda a navegação/request que o helper dispara.
    for _ in range(50):
        if captured:
            break
        await asyncio.sleep(0.1)

    shot = OUT / f"{viewport['name']}-{next_target.replace('/', '_').replace('?', '_')}.png"
    await page.screenshot(path=str(shot))

    await browser.close()

    assert captured, f"[{viewport['name']} next={next_target}] nenhum request de OAuth capturado"
    broker_url = captured[0]
    from urllib.parse import urlparse, parse_qs, unquote
    parsed = urlparse(broker_url)
    qs = parse_qs(parsed.query)
    redirect = None
    for key in ("redirect_uri", "redirect_to"):
        if key in qs:
            redirect = unquote(qs[key][0])
            break
    assert redirect == origin, (
        f"[{viewport['name']} next={next_target}] redirect_uri DEVE ser origin puro "
        f"({origin!r}), mas veio {redirect!r} (broker URL: {broker_url}). "
        "Concatenar `next`/rota protegida quebra o web_message do Safari mobile — "
        "reverta a alteração em src/pages/Auth.tsx."
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
