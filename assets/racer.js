/* =========================================================
 * Lucky7 Hub — 輕量原創 pseudo-3D 賽車（純前端、零外部依賴）
 *
 * 本檔案為原創實作，僅參考「分段道路透視投影」這個公開的遊戲程式設計
 * 概念，沒有使用任何外部專案的程式碼、素材或資源。
 *
 * 技術摘要：
 *  - 道路由大量 segment 組成，每段記錄曲率 curve 與高度 y。
 *  - 將世界座標透過透視除法投影到 Canvas 2D 畫面。
 *  - 由遠而近繪製路面，並以累積曲率製造彎道視覺。
 *  - 玩家具備加速、煞車、轉向、越野減速、碰撞與三圈計時。
 *  - 下注與派彩共用 L7.wallet（虛擬籌碼，不涉及真實金錢）。
 *  - 使用 requestAnimationFrame；分頁隱藏或離開分頁時自動暫停。
 * ========================================================= */
(function (global) {
  'use strict';

  var L7 = global.L7;
  if (!L7) return;

  /* ---------------- 常數設定 ---------------- */
  var SEGMENT_LENGTH = 200;          // 每段道路長度（世界單位）
  var RUMBLE_LENGTH = 3;             // 每幾段切換一次路肩顏色
  var ROAD_WIDTH = 2000;             // 道路半寬（世界單位）
  var LANES = 3;                     // 車道數
  var DRAW_DISTANCE = 220;           // 繪製距離（段數）
  var CAMERA_HEIGHT = 1100;          // 相機高度
  var FIELD_OF_VIEW = 100;           // 視野角（度）
  var CAMERA_DEPTH = 1 / Math.tan((FIELD_OF_VIEW / 2) * Math.PI / 180);
  var PLAYER_Z_OFFSET = CAMERA_HEIGHT * CAMERA_DEPTH; // 相機到玩家車的距離
  var MAX_SPEED = SEGMENT_LENGTH * 60;                // 每秒最大前進距離
  var ACCEL = MAX_SPEED / 4;         // 加速度
  var BRAKING = -MAX_SPEED / 2;      // 煞車減速度
  var DECEL = -MAX_SPEED / 6;        // 自然減速
  var OFFROAD_DECEL = -MAX_SPEED / 2;// 越野減速
  var OFFROAD_LIMIT = MAX_SPEED / 3.5;
  var STEER_SPEED = 2.2;             // 轉向速度（每秒）
  var CENTRIFUGAL = 0.3;             // 離心力係數（彎道把車往外推）
  var TOTAL_LAPS = 3;                // 比賽圈數
  var OPPONENT_COUNT = 5;            // 對手車數量

  var COLORS = {
    LIGHT:  { road: '#6b7280', grass: '#15803d', rumble: '#f8fafc', lane: '#d1d5db' },
    DARK:   { road: '#4b5563', grass: '#166534', rumble: '#dc2626', lane: null },
    START:  { road: '#e5e7eb', grass: '#15803d', rumble: '#f8fafc', lane: null },
    FINISH: { road: '#111827', grass: '#15803d', rumble: '#111827', lane: '#f8fafc' }
  };

  var CAR_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#14b8a6'];
  var CAR_SPEEDS = [0.74, 0.82, 0.7, 0.79, 0.76]; // 佔 MAX_SPEED 比例
  var CAR_OFFSETS = [-0.68, 0.66, -0.28, 0.3, 0.82];

  /* ---------------- DOM ---------------- */
  var panel = document.getElementById('panel-racer');
  var canvas = document.getElementById('racer-canvas');
  var statusEl = document.getElementById('racer-status');
  var speedEl = document.getElementById('racer-speed');
  var lapEl = document.getElementById('racer-lap');
  var posEl = document.getElementById('racer-pos');
  var timeEl = document.getElementById('racer-time');
  var bestEl = document.getElementById('racer-best');
  var startBtn = document.getElementById('racer-start');
  if (!panel || !canvas || !startBtn) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var W = 600;
  var H = 340;

  /* ---------------- 工具函式 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function easeIn(a, b, p) { return a + (b - a) * p * p; }
  function easeInOut(a, b, p) { return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5); }
  function percentRemaining(n, total) { return (n % total) / total; }
  function interpolate(a, b, p) { return a + (b - a) * p; }

  function formatTime(seconds) {
    if (seconds === null || !isFinite(seconds)) return '—';
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    var tenths = Math.floor((seconds % 1) * 10);
    return (mins < 10 ? '0' : '') + mins + ':' +
           (secs < 10 ? '0' : '') + secs + '.' + tenths;
  }

  /* ---------------- 建立賽道 ---------------- */
  var segments = [];
  var trackLength = 0;

  function lastY() {
    return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
  }

  function addSegment(curve, y) {
    var n = segments.length;
    segments.push({
      index: n,
      p1: { world: { x: 0, y: lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
      p2: { world: { x: 0, y: y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
      curve: curve,
      color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.DARK : COLORS.LIGHT
    });
  }

  function addRoad(enter, hold, leave, curve, y) {
    var startY = lastY();
    var endY = startY + y * SEGMENT_LENGTH;
    var total = enter + hold + leave;
    var n;
    for (n = 0; n < enter; n += 1) {
      addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    }
    for (n = 0; n < hold; n += 1) {
      addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    }
    for (n = 0; n < leave; n += 1) {
      addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
    }
  }

  function buildTrack() {
    segments = [];
    addRoad(30, 30, 30, 0, 0);      // 起跑直線
    addRoad(30, 40, 30, 3, 0);      // 右彎
    addRoad(30, 30, 30, 0, 40);     // 上坡
    addRoad(30, 40, 30, -4, -40);   // 左彎下坡
    addRoad(20, 30, 20, 0, 0);      // 短直線
    addRoad(30, 50, 30, 5, 20);     // 長右彎上坡
    addRoad(30, 30, 30, 0, -20);    // 下坡
    addRoad(40, 40, 40, -3, 0);     // 長左彎
    addRoad(30, 30, 30, 0, 0);      // 回到起點

    // 標記起跑線與終點線
    segments[0].color = COLORS.START;
    segments[1].color = COLORS.START;
    segments[2].color = COLORS.START;
    segments[segments.length - 3].color = COLORS.FINISH;
    segments[segments.length - 2].color = COLORS.FINISH;
    segments[segments.length - 1].color = COLORS.FINISH;
    trackLength = segments.length * SEGMENT_LENGTH;
  }

  function findSegment(z) {
    var index = Math.floor(z / SEGMENT_LENGTH) % segments.length;
    if (index < 0) index += segments.length;
    return segments[index];
  }

  /* ---------------- 遊戲狀態 ---------------- */
  var state = {
    phase: 'ready',       // ready / racing / finished
    position: 0,          // 玩家目前 z（未取模，可大於trackLength）
    speed: 0,
    playerX: 0,           // -1..1 為路面，超出為越野
    lap: 1,
    elapsed: 0,
    lapStart: 0,
    lapTimes: [],
    bestLap: null,
    bet: 25,
    finishPosition: 0,
    payout: 0,
    rank: 1,
    offroad: false
  };

  var cars = [];
  var keys = Object.create(null);
  var rafId = 0;
  var lastTime = 0;
  var backgroundOffset = 0;
  var reduceMotion = false;
  try {
    reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) { reduceMotion = false; }

  function resetCars() {
    cars = [];
    for (var i = 0; i < OPPONENT_COUNT; i += 1) {
      // 起跑排位：僅領先玩家數個車身距離，而非大半圈
      var startDistance = (i + 1) * SEGMENT_LENGTH * 10;
      cars.push({
        distance: startDistance,
        z: startDistance % trackLength,
        offset: CAR_OFFSETS[i],
        speed: MAX_SPEED * CAR_SPEEDS[i],
        color: CAR_COLORS[i],
        segment: null,
        bumped: false,
        phase: i * 1.7
      });
    }
  }

  /* ---------------- 投影與繪製 ---------------- */
  function project(p, cameraX, cameraY, cameraZ) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    p.screen.scale = CAMERA_DEPTH / p.camera.z;
    p.screen.x = Math.round((W / 2) + (p.screen.scale * p.camera.x * W / 2));
    p.screen.y = Math.round((H / 2) - (p.screen.scale * p.camera.y * H / 2));
    p.screen.w = Math.round(p.screen.scale * ROAD_WIDTH * W / 2);
  }

  function polygon(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  function rumbleWidth(projectedW) { return projectedW / Math.max(6, 2 * LANES); }
  function laneWidth(projectedW) { return projectedW / Math.max(24, 8 * LANES); }

  function renderSegment(x1, y1, w1, x2, y2, w2, color) {
    var r1 = rumbleWidth(w1), r2 = rumbleWidth(w2);
    var l1 = laneWidth(w1), l2 = laneWidth(w2);
    ctx.fillStyle = color.grass;
    ctx.fillRect(0, y2, W, y1 - y2);
    polygon(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, color.rumble);
    polygon(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, color.rumble);
    polygon(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, color.road);
    if (color.lane) {
      var laneW1 = (w1 * 2) / LANES;
      var laneW2 = (w2 * 2) / LANES;
      var lx1 = x1 - w1 + laneW1;
      var lx2 = x2 - w2 + laneW2;
      for (var i = 1; i < LANES; i += 1) {
        polygon(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, color.lane);
        lx1 += laneW1;
        lx2 += laneW2;
      }
    }
  }

  function drawBackground(horizon) {
    var sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    sky.addColorStop(0, '#0b1021');
    sky.addColorStop(1, '#1e3a5f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, Math.max(1, horizon));

    // 太陽
    ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
    ctx.beginPath();
    ctx.arc(W * 0.76, horizon * 0.42, Math.max(8, W * 0.035), 0, Math.PI * 2);
    ctx.fill();

    if (reduceMotion) return;

    // 遠山（以背景偏移量製造視差）
    ctx.fillStyle = '#183153';
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    var step = Math.max(24, W / 18);
    for (var x = 0; x <= W + step; x += step) {
      var wave = Math.sin((x + backgroundOffset) * 0.011) * 0.5 +
                 Math.sin((x + backgroundOffset) * 0.027) * 0.5;
      ctx.lineTo(x, horizon - (0.1 + (wave + 1) * 0.07) * H);
    }
    ctx.lineTo(W, horizon);
    ctx.closePath();
    ctx.fill();
  }

  function drawCar(cx, cy, w, h, color, isPlayer) {
    var bodyW = w;
    var bodyH = h;
    var x0 = cx - bodyW / 2;
    var y0 = cy - bodyH;
    // 輪胎
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x0 + bodyW * 0.08, y0 + bodyH * 0.7, bodyW * 0.18, bodyH * 0.3);
    ctx.fillRect(x0 + bodyW * 0.74, y0 + bodyH * 0.7, bodyW * 0.18, bodyH * 0.3);
    // 車身
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0 + bodyW * 0.18, y0 + bodyH * 0.78);
    ctx.lineTo(x0 + bodyW * 0.24, y0 + bodyH * 0.36);
    ctx.lineTo(x0 + bodyW * 0.38, y0 + bodyH * 0.08);
    ctx.lineTo(x0 + bodyW * 0.62, y0 + bodyH * 0.08);
    ctx.lineTo(x0 + bodyW * 0.76, y0 + bodyH * 0.36);
    ctx.lineTo(x0 + bodyW * 0.82, y0 + bodyH * 0.78);
    ctx.closePath();
    ctx.fill();
    // 擋風玻璃
    ctx.fillStyle = isPlayer ? '#bae6fd' : '#93c5fd';
    ctx.beginPath();
    ctx.moveTo(x0 + bodyW * 0.32, y0 + bodyH * 0.38);
    ctx.lineTo(x0 + bodyW * 0.41, y0 + bodyH * 0.16);
    ctx.lineTo(x0 + bodyW * 0.59, y0 + bodyH * 0.16);
    ctx.lineTo(x0 + bodyW * 0.68, y0 + bodyH * 0.38);
    ctx.closePath();
    ctx.fill();
    // 車燈
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(x0 + bodyW * 0.16, y0 + bodyH * 0.56, bodyW * 0.12, bodyH * 0.1);
    ctx.fillRect(x0 + bodyW * 0.72, y0 + bodyH * 0.56, bodyW * 0.12, bodyH * 0.1);
  }

  function render() {
    if (!segments.length) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#15803d';
    ctx.fillRect(0, 0, W, H);

    var baseSegment = findSegment(state.position);
    var basePercent = percentRemaining(state.position, SEGMENT_LENGTH);
    var playerSegment = findSegment(state.position + PLAYER_Z_OFFSET);
    var playerPercent = percentRemaining(state.position + PLAYER_Z_OFFSET, SEGMENT_LENGTH);
    var playerY = interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
    var maxy = H;
    var x = 0;
    var dx = -(baseSegment.curve * basePercent);
    var n;
    var segment;

    // 標記每輛車所屬的 segment
    for (n = 0; n < cars.length; n += 1) {
      cars[n].segment = findSegment(cars[n].z);
    }

    // 由遠而近繪製道路
    for (n = 0; n < DRAW_DISTANCE; n += 1) {
      segment = segments[(baseSegment.index + n) % segments.length];
      var looped = segment.index < baseSegment.index;
      var cameraZ = state.position - (looped ? trackLength : 0);

      project(segment.p1, (state.playerX * ROAD_WIDTH) - x, playerY + CAMERA_HEIGHT, cameraZ);
      project(segment.p2, (state.playerX * ROAD_WIDTH) - x - dx, playerY + CAMERA_HEIGHT, cameraZ);

      x += dx;
      dx += segment.curve;

      if (segment.p1.camera.z <= CAMERA_DEPTH ||
          segment.p2.screen.y >= segment.p1.screen.y ||
          segment.p2.screen.y >= maxy) {
        continue;
      }

      renderSegment(
        segment.p1.screen.x, segment.p1.screen.y, segment.p1.screen.w,
        segment.p2.screen.x, segment.p2.screen.y, segment.p2.screen.w,
        segment.color
      );
      maxy = segment.p2.screen.y;
    }

    drawBackground(maxy);

    // 由遠而近繪製對手車
    for (n = DRAW_DISTANCE - 1; n >= 0; n -= 1) {
      segment = segments[(baseSegment.index + n) % segments.length];
      for (var c = 0; c < cars.length; c += 1) {
        var car = cars[c];
        if (car.segment !== segment) continue;
        var carPercent = percentRemaining(car.z, SEGMENT_LENGTH);
        var carScale = interpolate(segment.p1.screen.scale, segment.p2.screen.scale, carPercent);
        var carX = interpolate(segment.p1.screen.x, segment.p2.screen.x, carPercent) +
                   carScale * car.offset * ROAD_WIDTH * W / 2;
        var carY = interpolate(segment.p1.screen.y, segment.p2.screen.y, carPercent);
        var carW = Math.max(6, carScale * ROAD_WIDTH * W / 2 * 0.28);
        var carH = carW * 0.62;
        drawCar(carX, carY, carW, carH, car.color, false);
      }
    }

    // 玩家車（固定於畫面下方，依轉向與速度做小幅飄移）
    var bounce = state.phase === 'racing' && !reduceMotion
      ? Math.sin(state.elapsed * 18) * (state.speed / MAX_SPEED) * 2
      : 0;
    var playerCarW = Math.max(44, W * 0.14);
    drawCar(
      W / 2 + state.playerX * W * 0.2 - (keys.left ? 4 : 0) + (keys.right ? 4 : 0),
      H - 14 + bounce,
      playerCarW,
      playerCarW * 0.62,
      '#fbbf24',
      true
    );

    // 越野提示
    if (state.offroad) {
      ctx.fillStyle = 'rgba(220, 38, 38, 0.16)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------- HUD ---------------- */
  function syncHUD() {
    var kmh = Math.round(state.speed / MAX_SPEED * 240);
    if (speedEl) speedEl.textContent = String(kmh);
    if (lapEl) lapEl.textContent = Math.min(state.lap, TOTAL_LAPS) + '/' + TOTAL_LAPS;
    if (posEl) posEl.textContent = state.phase === 'ready' ? '—' : String(state.rank);
    if (timeEl) timeEl.textContent = formatTime(state.phase === 'ready' ? 0 : state.elapsed);
    if (bestEl) bestEl.textContent = formatTime(state.bestLap);
  }

  function say(message, isWin) {
    L7.announce(statusEl, message, isWin);
  }

  /* ---------------- 比賽流程 ---------------- */
  function getBet() {
    var checked = panel.querySelector('input[name="racer-bet"]:checked');
    var value = checked ? parseInt(checked.value, 10) : 25;
    return isFinite(value) && value > 0 ? value : 25;
  }

  function startRace() {
    if (state.phase === 'racing') return;
    var bet = getBet();
    if (!L7.wallet.canBet(bet)) {
      say('籌碼不足，無法支付下注。請重置籌碼或選擇較低下注額。', false);
      return;
    }
    L7.wallet.bet(bet);
    state.bet = bet;
    state.phase = 'racing';
    state.position = 0;
    state.speed = 0;
    state.playerX = 0;
    state.lap = 1;
    state.elapsed = 0;
    state.lapStart = 0;
    state.lapTimes = [];
    state.bestLap = null;
    state.finishPosition = 0;
    state.payout = 0;
    state.rank = OPPONENT_COUNT + 1;
    state.offroad = false;
    keys = Object.create(null);
    resetCars();
    L7.audio.chip();
    if (startBtn) startBtn.disabled = true;
    say('比賽開始！使用方向鍵或 WASD 駕駛，超車搶進前三名可獲得派彩。', undefined);
    syncHUD();
    render();
    setRunning(true);
  }

  function finishRace() {
    state.phase = 'finished';
    var multipliers = [0, 5, 3, 2, 1, 1, 1];
    var mult = multipliers[state.finishPosition] || 1;
    state.payout = state.bet * mult;
    L7.wallet.payout(state.payout);
    setRunning(false);
    if (startBtn) startBtn.disabled = false;
    if (state.payout > state.bet) {
      L7.audio.win(state.finishPosition === 1);
      say('完賽！第 ' + state.finishPosition + ' 名，派彩 ' +
          L7.formatNumber(state.payout) + ' 籌碼（' + mult + ' 倍）。最快單圈 ' +
          formatTime(state.bestLap) + '。', true);
    } else {
      L7.audio.lose();
      say('完賽！第 ' + state.finishPosition + ' 名，退回 ' +
          L7.formatNumber(state.payout) + ' 籌碼。最快單圈 ' +
          formatTime(state.bestLap) + '。', false);
    }
    syncHUD();
    render();
  }

  /* ---------------- 更新迴圈 ---------------- */
  function update(dt, now) {
    if (state.phase !== 'racing') return;

    state.elapsed += dt;

    // 輸入對應
    var accelerating = Boolean(keys.up);
    var braking = Boolean(keys.down);
    var steering = 0;
    if (keys.left) steering -= 1;
    if (keys.right) steering += 1;

    if (accelerating) state.speed += ACCEL * dt;
    else if (braking) state.speed += BRAKING * dt;
    else state.speed += DECEL * dt;

    var playerSegment = findSegment(state.position + PLAYER_Z_OFFSET);
    var speedPercent = state.speed / MAX_SPEED;
    var dx = dt * 2 * speedPercent;

    state.playerX += steering * STEER_SPEED * dt * (0.4 + speedPercent * 0.6);
    state.playerX -= dx * speedPercent * playerSegment.curve * CENTRIFUGAL; // 離心力
    state.playerX = clamp(state.playerX, -2, 2);

    // 越野減速：速度高於限制時才額外衰減，最終收斂到 OFFROAD_LIMIT
    state.offroad = Math.abs(state.playerX) > 1;
    if (state.offroad && state.speed > OFFROAD_LIMIT) {
      state.speed = Math.max(OFFROAD_LIMIT, state.speed + OFFROAD_DECEL * dt);
    }
    state.speed = clamp(state.speed, 0, MAX_SPEED);

    state.position += state.speed * dt;
    if (!reduceMotion) backgroundOffset += state.speed * dt * 0.02;

    // 更新對手
    for (var i = 0; i < cars.length; i += 1) {
      var car = cars[i];
      car.distance += car.speed * dt;
      car.z = car.distance % trackLength;
      // 輕微左右飄移，但保持在路面內
      car.offset += Math.sin(now * 0.0004 + car.phase) * dt * 0.02;
      car.offset = clamp(car.offset, -0.9, 0.9);
    }

    // 碰撞偵測
    var playerZ = state.position + PLAYER_Z_OFFSET;
    for (i = 0; i < cars.length; i += 1) {
      var other = cars[i];
      var near = Math.abs(other.z - (playerZ % trackLength));
      if (near > trackLength / 2) near = trackLength - near;
      if (near < SEGMENT_LENGTH * 1.8 && Math.abs(other.offset - state.playerX) < 0.3) {
        state.speed = Math.min(state.speed, other.speed * 0.65);
        if (!other.bumped) {
          other.bumped = true;
          L7.audio.tone(140, 0.1, 'sawtooth', 0.035, 0);
        }
      } else {
        other.bumped = false;
      }
    }

    // 名次：比較累積距離
    var ahead = 0;
    var playerDistance = state.position;
    for (i = 0; i < cars.length; i += 1) {
      if (cars[i].distance > playerDistance) ahead += 1;
    }
    state.rank = ahead + 1;

    // 圈數計算
    var completedLaps = Math.floor(state.position / trackLength);
    if (completedLaps > state.lap - 1) {
      var lapTime = state.elapsed - state.lapStart;
      state.lapTimes.push(lapTime);
      if (state.bestLap === null || lapTime < state.bestLap) state.bestLap = lapTime;
      state.lapStart = state.elapsed;
      state.lap = completedLaps + 1;
      if (state.lap > TOTAL_LAPS) {
        state.finishPosition = state.rank;
        finishRace();
        return;
      }
      L7.audio.tone(880, 0.12, 'square', 0.035, 0);
      say('第 ' + Math.min(state.lap, TOTAL_LAPS) + ' 圈！單圈 ' + formatTime(lapTime) + '。', undefined);
    }

    syncHUD();
  }

  function canRun() {
    return state.phase === 'racing' && !document.hidden && !panel.hidden;
  }

  function setRunning(on) {
    if (on) {
      if (!rafId && canRun()) {
        lastTime = (global.performance && performance.now) ? performance.now() : Date.now();
        rafId = requestAnimationFrame(tick);
      }
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function tick(now) {
    rafId = 0;
    if (!canRun()) return;
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    update(dt, now);
    if (canRun()) {
      render();
      rafId = requestAnimationFrame(tick);
    }
  }

  /* ---------------- 輸入事件 ---------------- */
  var KEY_MAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };

  global.addEventListener('keydown', function (e) {
    if (panel.hidden) return;
    var action = KEY_MAP[e.code];
    if (action) {
      keys[action] = true;
      e.preventDefault();
      return;
    }
    if ((e.code === 'Space' || e.code === 'Enter') && state.phase !== 'racing' &&
        document.activeElement !== startBtn) {
      e.preventDefault();
      startRace();
    }
  });

  global.addEventListener('keyup', function (e) {
    var action = KEY_MAP[e.code];
    if (action) keys[action] = false;
  });

  global.addEventListener('blur', function () { keys = Object.create(null); });

  if (startBtn) {
    startBtn.addEventListener('click', startRace);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) setRunning(false);
    else if (state.phase === 'racing') setRunning(true);
  });

  // 分頁切換時暫停 / 復原
  if (global.MutationObserver) {
    var observer = new MutationObserver(function () {
      if (panel.hidden) setRunning(false);
      else {
        render();
        if (state.phase === 'racing') setRunning(true);
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ---------------- 畫布尺寸 ---------------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round((rect.width || 600) * dpr));
    var h = Math.max(1, Math.round((rect.height || 340) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    W = w;
    H = h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    render();
  }

  if (global.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    global.addEventListener('resize', resize);
  }

  /* ---------------- 初始化 ---------------- */
  buildTrack();
  resetCars();
  resize();
  syncHUD();
  say('準備就緒。選擇下注額後按下「開始比賽」，使用方向鍵或 WASD 駕駛。', undefined);
})(window);
