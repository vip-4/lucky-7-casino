/* =========================================================
 * 幸運 7 老虎機 — 遊戲邏輯（純前端示範）
 *
 * 重要資安提醒：
 * 本檔案的 RNG、賠率與派彩僅用於「表現層」展示。
 * 正式博弈平台必須由伺服器端產生結果、伺服器結算，
 * 並保存可稽核日誌；前端不得決定中獎，亦不可信任任何前端數值。
 * ========================================================= */
(function () {
  'use strict';

  /* ---------------- DOM 參照 ---------------- */
  const canvas = document.getElementById('reels');
  const ctx = canvas && canvas.getContext('2d', { alpha: false });
  const creditsEl = document.getElementById('credits');
  const betEl = document.getElementById('bet');
  const lastWinEl = document.getElementById('last-win');
  const statusEl = document.getElementById('status');
  const spinBtn = document.getElementById('spin');
  const soundBtn = document.getElementById('sound');
  const resetBtn = document.getElementById('reset');
  const betRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="bet"]'));

  if (!ctx) {
    if (statusEl) statusEl.textContent = '無法初始化 Canvas，請更換現代瀏覽器。';
    return;
  }

  /* ---------------- 常數與設定 ---------------- */
  const INITIAL_CREDITS = 1000;
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STATE = Object.freeze({ IDLE: 'idle', SPINNING: 'spinning', EVALUATING: 'evaluating' });

  // 符號表：weight 控制出現頻率，mult 為三個連線時的派彩倍率
  const SYMBOLS = Object.freeze([
    { id: 'cherry', glyph: '🍒', label: '櫻桃', weight: 30, mult: 5, color: '#ef4444' },
    { id: 'lemon', glyph: '🍋', label: '檸檬', weight: 24, mult: 8, color: '#facc15' },
    { id: 'bell', glyph: '🔔', label: '鈴鐺', weight: 18, mult: 12, color: '#fb923c' },
    { id: 'star', glyph: '⭐', label: '星星', weight: 12, mult: 20, color: '#fde68a' },
    { id: 'diamond', glyph: '💎', label: '鑽石', weight: 8, mult: 35, color: '#38bdf8' },
    { id: 'seven', glyph: '7️⃣', label: '幸運 7', weight: 3, mult: 80, color: '#c084fc' }
  ]);
  const TOTAL_WEIGHT = SYMBOLS.reduce(function (sum, s) { return sum + s.weight; }, 0);

  /* ---------------- 遊戲狀態 ---------------- */
  let state = STATE.IDLE;
  let credits = INITIAL_CREDITS;
  let bet = 25;
  let grid = [
    [SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]],
    [SYMBOLS[3], SYMBOLS[4], SYMBOLS[5]],
    [SYMBOLS[1], SYMBOLS[0], SYMBOLS[4]]
  ];
  let winLines = [];
  let winUntil = 0;
  let shake = 0;
  let rafId = 0;
  let lastFrame = 0;
  let audioCtx = null;
  let muted = false;

  const reels = [
    { duration: REDUCED_MOTION ? 140 : 620, elapsed: 0, travel: 16, strip: [] },
    { duration: REDUCED_MOTION ? 160 : 820, elapsed: 0, travel: 20, strip: [] },
    { duration: REDUCED_MOTION ? 180 : 1040, elapsed: 0, travel: 24, strip: [] }
  ];

  let layout = { w: 600, h: 360, reelW: 180, reelH: 320, gap: 18, left: 20, top: 20, rowH: 100, radius: 14 };

  /* ---------------- 工具函式 ---------------- */

  // 加權隨機：優先使用 crypto.getRandomValues，避免 Math.random 的可預測性
  function secureRandom() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random(); // 僅作為舊瀏覽器的降級路徑
  }

  function weightedSymbol() {
    let r = secureRandom() * TOTAL_WEIGHT;
    for (let i = 0; i < SYMBOLS.length; i += 1) {
      r -= SYMBOLS[i].weight;
      if (r <= 0) return SYMBOLS[i];
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function formatNumber(n) {
    return n.toLocaleString('zh-Hant');
  }

  // 相容舊版瀏覽器的圓角矩形繪製
  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function setStatus(text, isWin) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-win', Boolean(isWin));
  }

  function syncUI() {
    if (creditsEl) creditsEl.textContent = formatNumber(credits);
    if (betEl) betEl.textContent = formatNumber(bet);
    if (spinBtn) spinBtn.disabled = state !== STATE.IDLE;
  }

  /* ---------------- 音效（Web Audio API） ---------------- */

  function unlockAudio() {
    if (muted) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (err) {
      // 某些瀏覽器在無使用者手勢時會拋錯，直接忽略即可
    }
  }

  function tone(freq, duration, type, volume, delay) {
    if (muted || !audioCtx || audioCtx.state !== 'running') return;
    try {
      const t0 = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume || 0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (err) {
      // 音訊失敗不影響遊戲流程
    }
  }

  function playSpin() {
    tone(220, 0.12, 'triangle', 0.045, 0);
    tone(330, 0.12, 'triangle', 0.035, 0.08);
  }

  function playWin(big) {
    const notes = big ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach(function (f, i) { tone(f, 0.18, 'sine', 0.06, i * 0.09); });
  }

  function playLose() {
    tone(160, 0.16, 'sine', 0.035, 0);
  }

  /* ---------------- 粒子物件池 ---------------- */

  const PARTICLE_MAX = REDUCED_MOTION ? 0 : 120;
  const particles = [];
  for (let i = 0; i < PARTICLE_MAX; i += 1) {
    particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 3, color: '#fbbf24' });
  }

  function spawnBurst(x, y, count, color) {
    let spawned = 0;
    for (let i = 0; i < particles.length && spawned < count; i += 1) {
      const p = particles[i];
      if (p.active) continue;
      const angle = secureRandom() * Math.PI * 2;
      const speed = 2 + secureRandom() * 5;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 3;
      p.maxLife = 45 + Math.floor(secureRandom() * 35);
      p.life = p.maxLife;
      p.size = 2 + secureRandom() * 3;
      p.color = color;
      spawned += 1;
    }
    if (spawned > 0) startLoop();
  }

  function updateParticles() {
    let alive = false;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.active) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.16; // 重力
      p.vx *= 0.99;
      p.life -= 1;
      if (p.life <= 0 || p.y > layout.h + 20) {
        p.active = false;
      } else {
        alive = true;
      }
    }
    return alive;
  }

  function drawParticles() {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.active) continue;
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- 畫面配置 ---------------- */

  function computeLayout(w, h) {
    const margin = Math.max(10, Math.round(w * 0.03));
    const gap = Math.max(8, Math.round(w * 0.025));
    const reelW = (w - margin * 2 - gap * 2) / 3;
    const top = Math.max(12, Math.round(h * 0.05));
    const reelH = h - top * 2;
    return {
      w: w,
      h: h,
      left: margin,
      top: top,
      gap: gap,
      reelW: reelW,
      reelH: reelH,
      rowH: reelH / 3,
      radius: Math.max(8, Math.round(reelW * 0.09))
    };
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.round(rect.width || 600));
    const cssH = Math.round(cssW * 0.6);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2); // 限制 DPR，降低高解析手機填充率
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = computeLayout(cssW, cssH);
    render();
  }

  /* ---------------- 渲染 ---------------- */

  function drawSymbol(sym, cx, cy, size) {
    // 底色圓片：即使系統缺少 Emoji 字型，仍能辨識符號
    ctx.fillStyle = sym.color + '33';
    ctx.beginPath();
    ctx.arc(cx, cy - size * 0.08, size * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.round(size * 0.52) + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.fillText(sym.glyph, cx, cy - size * 0.06);

    ctx.font = '600 ' + Math.round(size * 0.15) + 'px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = '#dbe4ff';
    ctx.fillText(sym.label, cx, cy + size * 0.33);
  }

  function drawReel(reel, index) {
    const L = layout;
    const x = L.left + index * (L.reelW + L.gap);
    const y = L.top;
    const t = clamp(reel.elapsed / reel.duration, 0, 1);
    const spinning = state === STATE.SPINNING && t < 1;
    const rowPos = reel.travel * easeOutQuart(t);
    const base = Math.floor(rowPos);
    const sub = rowPos - base;
    const strip = reel.strip;

    // 捲軸外框
    roundRect(ctx, x, y, L.reelW, L.reelH, L.radius);
    ctx.fillStyle = '#0d1530';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#334170';
    ctx.stroke();

    ctx.save();
    roundRect(ctx, x + 3, y + 3, L.reelW - 6, L.reelH - 6, L.radius - 2);
    ctx.clip();

    //  spinning 時加入動態模糊（特徵偵測，避免舊 Safari 不支援 filter）
    if (spinning && !REDUCED_MOTION && 'filter' in ctx) {
      const blur = Math.max(0, 2.6 * (1 - t));
      if (blur > 0.1) ctx.filter = 'blur(' + blur.toFixed(2) + 'px)';
    }

    for (let r = -1; r <= 3; r += 1) {
      const rawIndex = base + r;
      const wrapped = ((rawIndex % strip.length) + strip.length) % strip.length;
      const sym = strip[wrapped];
      const cy = y + (r + 1) * L.rowH - sub * L.rowH + L.rowH / 2;
      if (cy < y - L.rowH || cy > y + L.reelH + L.rowH) continue;

      const cellX = x + 8;
      const cellY = cy - L.rowH / 2 + 5;
      const cellW = L.reelW - 16;
      const cellH = L.rowH - 10;
      roundRect(ctx, cellX, cellY, cellW, cellH, Math.max(6, L.radius - 5));
      ctx.fillStyle = (r % 2 === 0) ? '#182246' : '#131c3a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();
      drawSymbol(sym, x + L.reelW / 2, cy, L.rowH);
    }

    ctx.restore();
  }

  function drawWinLines(now) {
    if (!winLines.length || now > winUntil) return;
    const L = layout;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    winLines.forEach(function (row) {
      const y = L.top + row * L.rowH + L.rowH / 2;
      ctx.beginPath();
      ctx.moveTo(L.left + 6, y);
      ctx.lineTo(L.w - L.left - 6, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  function render() {
    const now = performance.now();
    ctx.save();

    // 中大獎震動（尊重減少動態效果設定）
    if (shake > 0 && !REDUCED_MOTION) {
      const dx = (Math.random() - 0.5) * shake;
      const dy = (Math.random() - 0.5) * shake;
      ctx.translate(dx, dy);
      shake *= 0.88;
      if (shake < 0.4) shake = 0;
    }

    // 背景
    const grad = ctx.createLinearGradient(0, 0, 0, layout.h);
    grad.addColorStop(0, '#111a38');
    grad.addColorStop(1, '#090e1e');
    ctx.fillStyle = grad;
    ctx.fillRect(-10, -10, layout.w + 20, layout.h + 20);

    reels.forEach(function (r, i) { drawReel(r, i); });
    drawWinLines(now);
    drawParticles();
    ctx.restore();
  }

  /* ---------------- 動畫迴圈 ---------------- */

  function startLoop() {
    if (rafId) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function tick(now) {
    rafId = 0;
    const dt = Math.min(now - lastFrame, 64);
    lastFrame = now;

    if (state === STATE.SPINNING) {
      // 以累加 elapsed 而非絕對時間戳，可避免分頁暫停後時間跳躍導致動畫閃跳
      reels.forEach(function (r) { r.elapsed += dt; });
      const done = reels.every(function (r) { return r.elapsed >= r.duration; });
      render();
      if (done) evaluate();
    } else {
      const alive = updateParticles();
      render();
      // 無論中獎與否，都要在結算展示時間結束後解鎖按鈕
      if (now > winUntil) {
        if (winLines.length) winLines = [];
        if (state === STATE.EVALUATING) {
          state = STATE.IDLE;
          syncUI();
        }
      }
      if (!alive && !winLines.length && shake === 0) return; // 無事可做，停止 RAF 節省電量
    }

    // spawnBurst 可能已在 evaluate 中啟動迴圈，避免重複排程造成雙重 RAF
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- 遊戲流程 ---------------- */

  function makeGrid() {
    const result = [];
    for (let r = 0; r < 3; r += 1) {
      const row = [];
      for (let c = 0; c < 3; c += 1) row.push(weightedSymbol());
      result.push(row);
    }
    return result;
  }

  function spin() {
    if (state !== STATE.IDLE) return;
    unlockAudio();

    if (credits < bet) {
      setStatus('籌碼不足，請降低下注額或重置籌碼。');
      playLose();
      return;
    }

    credits -= bet;
    state = STATE.SPINNING;
    winLines = [];
    shake = 0;
    setStatus('滾輪旋轉中…');
    syncUI();
    playSpin();

    grid = makeGrid();
    reels.forEach(function (reel, index) {
      reel.elapsed = 0;
      // 建立捲軸帶：前段隨機，末段為本次結果
      reel.strip = [];
      for (let i = 0; i < reel.travel; i += 1) reel.strip.push(weightedSymbol());
      reel.strip.push(grid[0][index], grid[1][index], grid[2][index]);
    });

    startLoop();
  }

  function evaluate() {
    state = STATE.EVALUATING;
    let totalWin = 0;
    winLines = [];

    for (let r = 0; r < 3; r += 1) {
      const a = grid[r][0];
      if (a.id === grid[r][1].id && a.id === grid[r][2].id) {
        winLines.push(r);
        totalWin += bet * a.mult;
      }
    }

    if (totalWin > 0) {
      credits += totalWin;
      if (lastWinEl) lastWinEl.textContent = '+' + formatNumber(totalWin);
      setStatus('中獎！第 ' + winLines.map(function (r) { return r + 1; }).join('、') + ' 條線命中，獲得 ' + formatNumber(totalWin) + ' 籌碼。', true);
      const big = totalWin >= bet * 20;
      playWin(big);
      if (big) shake = 7;
      winUntil = performance.now() + (REDUCED_MOTION ? 500 : 1300);
      const centerX = layout.w / 2;
      const centerY = layout.h / 2;
      spawnBurst(centerX, centerY, big ? 60 : 26, big ? '#fbbf24' : '#34d399');
    } else {
      if (lastWinEl) lastWinEl.textContent = '0';
      setStatus('未中獎，再試一次。');
      playLose();
      winUntil = performance.now() + 400;
    }

    syncUI();
    startLoop();
  }

  function reset() {
    if (state === STATE.SPINNING) return;
    credits = INITIAL_CREDITS;
    winLines = [];
    shake = 0;
    state = STATE.IDLE;
    if (lastWinEl) lastWinEl.textContent = '—';
    setStatus('已重置為 ' + formatNumber(INITIAL_CREDITS) + ' 籌碼。');
    syncUI();
    render();
  }

  /* ---------------- 事件綁定 ---------------- */

  betRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      bet = parseInt(radio.value, 10) || 25;
      syncUI();
    });
  });

  if (spinBtn) spinBtn.addEventListener('click', spin);
  if (resetBtn) resetBtn.addEventListener('click', reset);

  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      muted = !muted;
      soundBtn.textContent = muted ? '音效：關' : '音效：開';
      soundBtn.setAttribute('aria-pressed', String(!muted));
      if (!muted) {
        unlockAudio();
        tone(660, 0.1, 'sine', 0.04, 0);
      }
    });
  }

  // 首次手勢解鎖 Web Audio（iOS Safari 限制）
  ['pointerdown', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, unlockAudio, { passive: true });
  });

  document.addEventListener('keydown', function (e) {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (!typing && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault();
      spin();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopLoop();
    } else if (state !== STATE.IDLE || particles.some(function (p) { return p.active; })) {
      lastFrame = performance.now();
      startLoop();
    } else {
      render();
    }
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resizeCanvas).observe(canvas);
  } else {
    window.addEventListener('resize', resizeCanvas);
  }

  window.addEventListener('pagehide', stopLoop);

  /* ---------------- 初始化 ---------------- */
  reels.forEach(function (reel) {
    reel.strip = [];
    for (let i = 0; i < reel.travel + 3; i += 1) reel.strip.push(weightedSymbol());
    // 讓初始畫面使用 grid 的內容
    for (let r = 0; r < 3; r += 1) reel.strip[reel.travel + r] = grid[r][reels.indexOf(reel)];
  });

  resizeCanvas();
  syncUI();
})();
