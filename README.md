# Lucky7 Casino Hub

四款輕量 H5 博弈遊戲整合於單一靜態首頁：幸運 7 老虎機、歐式輪盤、21 點與百家樂。

## 特性

- 純前端、零外部依賴、零建置流程
- 四款遊戲共用同一組虛擬籌碼（localStorage）
- Canvas 2D 老虎機與輪盤、DOM 撲克牌遊戲
- 完整 SEO / GEO：meta、Open Graph、Twitter Card、九組 JSON-LD、`robots.txt`、`sitemap.xml`、`llms.txt`
- RWD、鍵盤操作、ARIA live region、`prefers-reduced-motion`

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
assets/lobby.js             分頁切換與籌包同步
assets/styles.css           全域樣式
assets/og-image.png         1200×630 Open Graph 圖片
tools/generate_og.py        OG 圖片產生器
tools/validate.py           部署前驗證
```

## 免責聲明

所有籌碼皆為虛擬展示數值，僅供技術示範與娛樂，不涉及真實金錢。正式博弈平台必須由伺服器端產生結果並結算。
