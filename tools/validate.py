#!/usr/bin/env python3
"""Pre-deployment validator for the Lucky7 hub SEO/GEO artifacts."""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
errors = []

blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
if len(blocks) != 9:
    errors.append(f"JSON-LD 區塊數量不符合預期：{len(blocks)}")
else:
    types = []
    for i, block in enumerate(blocks, 1):
        try:
            data = json.loads(block)
            types.append(data.get("@type"))
        except json.JSONDecodeError as e:
            errors.append(f"JSON-LD #{i} 解析失敗：{e}")
    expected = {
        "WebSite", "Organization", "ItemList", "SoftwareApplication",
        "BreadcrumbList", "FAQPage"
    }
    if not expected.issubset(set(types)):
        errors.append(f"JSON-LD 類型不符：{types}")
    if types.count("SoftwareApplication") != 4:
        errors.append(f"SoftwareApplication 數量應為 4，實際 {types.count('SoftwareApplication')}")

required_meta = [
    '<meta charset="utf-8">',
    'name="viewport"',
    '<title>',
    'name="description"',
    'name="keywords"',
    'name="robots"',
    'rel="canonical"',
    'property="og:title"',
    'property="og:description"',
    'property="og:url"',
    'property="og:image"',
    'name="twitter:card"',
]
for token in required_meta:
    if token not in html:
        errors.append(f"缺少 meta：{token}")

semantic = ["<header", "<main", "<article", "<section", "<footer", "<table", "<caption", "<dl", "<dt>", "<dd>", "<details"]
for tag in semantic:
    if tag not in html:
        errors.append(f"缺少語意化標籤：{tag}")

for game_id in ["panel-slots", "panel-roulette", "panel-blackjack", "panel-baccarat"]:
    if f'id="{game_id}"' not in html:
        errors.append(f"缺少遊戲面板：{game_id}")

for script in ["core.js", "slots.js", "table-games.js", "lobby.js"]:
    if f'assets/{script}' not in html:
        errors.append(f"缺少腳本引用：{script}")

required_files = [
    "index.html", "robots.txt", "sitemap.xml", "llms.txt", "manifest.webmanifest",
    "LICENSE", "README.md", "_headers",
    "assets/core.js", "assets/slots.js", "assets/table-games.js", "assets/lobby.js",
    "assets/styles.css", "assets/favicon.svg", "assets/og-image.png",
]
for rel in required_files:
    if not os.path.isfile(os.path.join(ROOT, rel)):
        errors.append(f"缺少檔案：{rel}")

if "vip-4.github.io/lucky-7-casino" not in html:
    errors.append("canonical / OG 網域不正確")

if len(re.findall(r'role="tab"', html)) != 4:
    errors.append("遊戲分頁數量應為 4")

if errors:
    print("驗證失敗：")
    for e in errors:
        print(" -", e)
    sys.exit(1)

print(f"檢查通過：{len(blocks)} 組 JSON-LD、{len(required_meta)} 個必要 meta、"
      f"{len(required_files)} 個必要檔案、4 款遊戲面板皆完整。")
