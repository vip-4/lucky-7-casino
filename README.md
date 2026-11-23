# Lucky7 Casino Hub

五款輕量 H5 遊戲整合於單一靜態首頁：幸運 7 老虎機、歐式輪盤、21 點、百家樂與原創輕量賽車。

## 特性

- 純前端、零外部依賴、零建置流程
- 五款遊戲共用同一組虛擬籌碼（localStorage）
- Canvas 2D 老虎機、輪盤與原創 pseudo-3D 賽車，DOM 撲克牌遊戲
- 賽車為原創實作：分段道路透視投影、彎道坡道、對手車碰撞、三圈計時與名次派彩；未使用外部專案程式碼或素材
- 完整 SEO / GEO：meta、Open Graph、Twitter Card、十組 JSON-LD、`robots.txt`、`sitemap.xml`、`llms.txt`
- RWD、鍵盤操作、ARIA live region、`prefers-reduced-motion`
- 「更多開源遊戲」區塊收錄已驗證的真實開源專案（含 mini-browser-games 130 款單檔遊戲 MIT、Open-Source-Games 189 款遊戲目錄 CC BY-NC-SA 4.0、sausi-7/games 142 款遊戲大廳 MIT、Open Star Fighter Godot 4 原生射擊 MIT），僅提供連結與署名

## 本機預覽

```bash
python -m http.server 8000
# 開啟 http://localhost:8000/
```

## 驗證

```bash
python tools/validate.py
```

## 檔案結構

```
index.html                  語意化首頁（所有遊戲內容皆在 HTML 中）
assets/core.js              RNG / 共用籌包 / 音效
assets/slots.js             老虎機
assets/table-games.js       輪盤 / 21 點 / 百家樂
assets/racer.js             原創輕量賽車
assets/lobby.js             分頁切換與籌包同步
assets/styles.css           全域樣式
assets/og-image.png         1200×630 Open Graph 圖片
tools/generate_og.py        OG 圖片產生器
tools/validate.py           部署前驗證
```

## 免責聲明

所有籌碼皆為虛擬展示數值，僅供技術示範與娛樂，不涉及真實金錢。正式博弈平台必須由伺服器端產生結果並結算。
