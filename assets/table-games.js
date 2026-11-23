/* =========================================================
 * Lucky7 Hub — 桌面博弈遊戲（歐式輪盤 / 21 點 / 百家樂）
 *
 * 全部為純前端展示用邏輯，使用 L7 共用籌包與音效。
 * 籌碼皆為虛擬，不涉及真實金錢；正式平台必須由伺服器端
 * 產生結果並結算，前端不得決定中獎或派彩。
 * ========================================================= */
(function (global) {
  'use strict';

  var L7 = global.L7;
  if (!L7) return;

  var wallet = L7.wallet;
  var audio = L7.audio;
  var fmt = L7.formatNumber;

  /* =========================================================
   * 一、歐式輪盤（European Roulette，0–36）
   * ======================================================= */

  var ROULETTE_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  var ROULETTE_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
  ];

  function rouletteColor(n) {
    if (n === 0) return 'green';
    return ROULETTE_RED.indexOf(n) >= 0 ? 'red' : 'black';
  }

  function rouletteColorLabel(n) {
    var c = rouletteColor(n);
    return c === 'red' ? '紅' : (c === 'black' ? '黑' : '綠');
  }

  (function initRoulette() {
    var canvas = document.getElementById('roulette-wheel');
    var ctx = canvas && canvas.getContext('2d');
    if (!ctx) return;

    var statusEl = document.getElementById('roulette-status');
    var resultEl = document.getElementById('roulette-result');
    var spinBtn = document.getElementById('roulette-spin');
    var betRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="roulette-bet"]'));
    var typeRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="roulette-type"]'));
    var numberSelect = document.getElementById('roulette-number');

    var bet = 25;
    var betType = 'red';
    var busy = false;
    var angle = 0;
    var raf = 0;
    var REDUCED = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 填充號碼下拉（0–36）
    if (numberSelect) {
      for (var n = 0; n <= 36; n += 1) {
        var opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = n + '（' + rouletteColorLabel(n) + '）';
        numberSelect.appendChild(opt);
      }
    }

    function layout() {
      var rect = canvas.getBoundingClientRect();
      var size = Math.max(240, Math.min(360, Math.round(rect.width || 320)));
      var dpr = L7.clamp(global.devicePixelRatio || 1, 1, 2);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return size;
    }

    var size = 320;

    function drawWheel() {
      var cx = size / 2;
      var cy = size / 2;
      var radius = size * 0.44;
      var seg = (Math.PI * 2) / 37;

      ctx.clearRect(0, 0, size, size);

      // 外圈
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
      ctx.fillStyle = '#1b2444';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fbbf24';
      ctx.stroke();

      for (var i = 0; i < 37; i += 1) {
        var start = -Math.PI / 2 + angle + i * seg;
        var end = start + seg;
        var color = rouletteColor(ROULETTE_ORDER[i]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = color === 'red' ? '#dc2626' : (color === 'black' ? '#111827' : '#15803d');
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(start + seg / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.font = '600 ' + Math.round(size * 0.026) + 'px system-ui, sans-serif';
        ctx.fillText(String(ROULETTE_ORDER[i]), radius - 7, 0);
        ctx.restore();
      }

      // 中心
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.fillStyle = '#0b1021';
      ctx.font = '800 ' + Math.round(size * 0.05) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('L7', cx, cy + 1);

      // 固定指針（頂端）
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius - 18);
      ctx.lineTo(cx - 9, cy - radius - 34);
      ctx.lineTo(cx + 9, cy - radius - 34);
      ctx.closePath();
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
    }

    function sync() {
      if (spinBtn) spinBtn.disabled = busy;
      if (numberSelect) numberSelect.disabled = betType !== 'number';
    }

    function isWinningNumber(result, type, picked) {
      if (type === 'number') return result === picked;
      if (type === 'red') return rouletteColor(result) === 'red';
      if (type === 'black') return rouletteColor(result) === 'black';
      if (type === 'odd') return result !== 0 && result % 2 === 1;
      if (type === 'even') return result !== 0 && result % 2 === 0;
      if (type === 'low') return result >= 1 && result <= 18;
      if (type === 'high') return result >= 19 && result <= 36;
      return false;
    }

    function oddsFor(type) {
      return type === 'number' ? 35 : 1; // 一點賠率（不含本金）
    }

    function spin() {
      if (busy) return;
      if (!wallet.bet(bet)) {
        L7.announce(statusEl, '籌碼不足，請降低下注額或重置籌碼。', false);
        audio.lose();
        return;
      }
      busy = true;
      sync();
      audio.spin();
      L7.announce(statusEl, '輪盤旋轉中…');

      var picked = parseInt(numberSelect ? numberSelect.value : '0', 10) || 0;
      var result = L7.randomInt(37);
      var index = ROULETTE_ORDER.indexOf(result);
      var seg = (Math.PI * 2) / 37;
      var spins = REDUCED ? 1 : 4;
      // 讓目標號碼停在顶端指針：angle + (index+0.5)*seg 必須為 2π 的整數倍
      var delta = ((-(index + 0.5) * seg - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      var target = angle + spins * Math.PI * 2 + delta;

      var duration = REDUCED ? 220 : 1750;
      var startAngle = angle;
      var t0 = performance.now();

      function frame(now) {
        var t = L7.clamp((now - t0) / duration, 0, 1);
        var eased = 1 - Math.pow(1 - t, 4);
        angle = startAngle + (target - startAngle) * eased;
        drawWheel();
        if (t < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          angle = angle % (Math.PI * 2);
          raf = 0;
          settle(result, picked);
        }
      }
      raf = requestAnimationFrame(frame);
    }

    function settle(result, picked) {
      var win = isWinningNumber(result, betType, picked);
      var odds = oddsFor(betType);
      var detail = result + '（' + rouletteColorLabel(result) + '）';

      if (resultEl) {
        resultEl.textContent = detail;
        resultEl.className = 'result-number color-' + rouletteColor(result);
      }

      if (win) {
        var payout = bet * (odds + 1);
        wallet.payout(payout);
        L7.announce(statusEl, '中獎！號碼 ' + detail + '，獲得 ' + fmt(payout) + ' 籌碼。', true);
        audio.win(odds >= 35);
      } else {
        L7.announce(statusEl, '未中獎。開出 ' + detail + '。', false);
        audio.lose();
      }
      drawWheel();
      busy = false;
      sync();
    }

    betRadios.forEach(function (r) {
      r.addEventListener('change', function () { bet = parseInt(r.value, 10) || 25; });
    });
    typeRadios.forEach(function (r) {
      r.addEventListener('change', function () { betType = r.value; sync(); });
    });
    if (spinBtn) spinBtn.addEventListener('click', spin);

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { size = layout(); drawWheel(); }).observe(canvas);
    } else {
      global.addEventListener('resize', function () { size = layout(); drawWheel(); });
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) drawWheel();
    });

    size = layout();
    drawWheel();
    sync();
  })();

  /* =========================================================
   * 二、21 點（Blackjack）
   * ======================================================= */

  (function initBlackjack() {
    var playerEl = document.getElementById('bj-player-cards');
    var dealerEl = document.getElementById('bj-dealer-cards');
    var playerScoreEl = document.getElementById('bj-player-score');
    var dealerScoreEl = document.getElementById('bj-dealer-score');
    var statusEl = document.getElementById('bj-status');
    var hitBtn = document.getElementById('bj-hit');
    var standBtn = document.getElementById('bj-stand');
    var dealBtn = document.getElementById('bj-deal');
    var betRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="bj-bet"]'));

    var SUITS = ['♠', '♥', '♦', '♣'];
    var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    var deck = [];
    var player = [];
    var dealer = [];
    var bet = 25;
    var inRound = false;
    var busy = false;

    function buildDeck() {
      var cards = [];
      for (var s = 0; s < SUITS.length; s += 1) {
        for (var r = 0; r < RANKS.length; r += 1) {
          cards.push({ rank: RANKS[r], suit: SUITS[s] });
        }
      }
      return L7.shuffle(cards);
    }

    function valueOf(card) {
      if (card.rank === 'A') return 11;
      if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
      return parseInt(card.rank, 10);
    }

    function score(hand) {
      var total = 0;
      var aces = 0;
      for (var i = 0; i < hand.length; i += 1) {
        var v = valueOf(hand[i]);
        total += v;
        if (hand[i].rank === 'A') aces += 1;
      }
      while (total > 21 && aces > 0) {
        total -= 10;
        aces -= 1;
      }
      return total;
    }

    function cardElement(card, hidden) {
      var div = document.createElement('div');
      div.className = 'playing-card';
      if (hidden) {
        div.classList.add('card-hidden');
        div.setAttribute('aria-label', '蓋牌');
        div.textContent = '✦';
        return div;
      }
      var red = card.suit === '♥' || card.suit === '♦';
      div.classList.add(red ? 'card-red' : 'card-black');
      var rank = document.createElement('span');
      rank.className = 'card-rank';
      rank.textContent = card.rank;
      var suit = document.createElement('span');
      suit.className = 'card-suit';
      suit.textContent = card.suit;
      div.appendChild(rank);
      div.appendChild(suit);
      div.setAttribute('aria-label', card.rank + card.suit);
      return div;
    }

    function render(hideHole) {
      if (playerEl) {
        playerEl.innerHTML = '';
        player.forEach(function (c) { playerEl.appendChild(cardElement(c, false)); });
      }
      if (dealerEl) {
        dealerEl.innerHTML = '';
        dealer.forEach(function (c, i) { dealerEl.appendChild(cardElement(c, hideHole && i === 1)); });
      }
      if (playerScoreEl) playerScoreEl.textContent = player.length ? String(score(player)) : '—';
      if (dealerScoreEl) {
        dealerScoreEl.textContent = dealer.length
          ? (hideHole ? String(valueOf(dealer[0])) + ' + ?' : String(score(dealer)))
          : '—';
      }
    }

    function sync() {
      if (hitBtn) hitBtn.disabled = !inRound || busy;
      if (standBtn) standBtn.disabled = !inRound || busy;
      if (dealBtn) dealBtn.disabled = busy || (inRound && false);
    }

    function deal() {
      if (busy) return;
      if (!wallet.bet(bet)) {
        L7.announce(statusEl, '籌碼不足，請降低下注額或重置籌碼。', false);
        audio.lose();
        return;
      }
      deck = buildDeck();
      player = [deck.pop(), deck.pop()];
      dealer = [deck.pop(), deck.pop()];
      inRound = true;
      busy = false;
      render(true);
      sync();
      audio.card();

      var ps = score(player);
      var ds = score(dealer);
      if (ps === 21 && ds === 21) {
        finish('push', '雙方都是 Blackjack，平局退回下注。');
      } else if (ps === 21) {
        finish('blackjack', 'Blackjack！獲得 ' + fmt(Math.round(bet * 2.5)) + ' 籌碼。');
      } else if (ds === 21) {
        finish('lose', '莊家 Blackjack，本局輸掉下注。');
      } else {
        L7.announce(statusEl, '您的點數 ' + ps + '。要補牌還是停牌？');
      }
    }

    function hit() {
      if (!inRound || busy) return;
      player.push(deck.pop());
      audio.card();
      var ps = score(player);
      render(true);
      if (ps > 21) {
        finish('lose', '爆牌！您的點數 ' + ps + '，本局輸掉下注。');
      } else if (ps === 21) {
        stand();
      } else {
        L7.announce(statusEl, '您目前 ' + ps + ' 點。可繼續補牌或停牌。');
      }
    }

    function stand() {
      if (!inRound || busy) return;
      busy = true;
      sync();
      L7.announce(statusEl, '莊家補牌中…');

      var steps = 0;
      function step() {
        var ds = score(dealer);
        if (ds < 17) {
          dealer.push(deck.pop());
          audio.card();
          render(false);
          steps += 1;
          if (steps < 8) {
            setTimeout(step, REDUCED_MOTION_DELAY());
            return;
          }
        }
        var finalDealer = score(dealer);
        var finalPlayer = score(player);
        render(false);
        if (finalDealer > 21) {
          finish('win', '莊家爆牌（' + finalDealer + ' 點），您獲得 ' + fmt(bet * 2) + ' 籌碼。');
        } else if (finalPlayer > finalDealer) {
          finish('win', '您 ' + finalPlayer + ' 點勝過莊家 ' + finalDealer + ' 點，獲得 ' + fmt(bet * 2) + ' 籌碼。');
        } else if (finalPlayer < finalDealer) {
          finish('lose', '莊家 ' + finalDealer + ' 點勝過您 ' + finalPlayer + ' 點，本局輸掉下注。');
        } else {
          finish('push', '雙方皆為 ' + finalPlayer + ' 點，平局退回下注。');
        }
      }
      setTimeout(step, REDUCED_MOTION_DELAY());
    }

    function REDUCED_MOTION_DELAY() {
      return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches ? 30 : 260;
    }

    function finish(kind, message) {
      if (kind === 'blackjack') {
        wallet.payout(Math.round(bet * 2.5));
        audio.win(true);
      } else if (kind === 'win') {
        wallet.payout(bet * 2);
        audio.win(false);
      } else if (kind === 'push') {
        wallet.payout(bet);
        audio.card();
      } else {
        audio.lose();
      }
      L7.announce(statusEl, message, kind === 'win' || kind === 'blackjack');
      inRound = false;
      busy = false;
      render(false);
      sync();
    }

    betRadios.forEach(function (r) {
      r.addEventListener('change', function () { bet = parseInt(r.value, 10) || 25; });
    });
    if (dealBtn) dealBtn.addEventListener('click', deal);
    if (hitBtn) hitBtn.addEventListener('click', hit);
    if (standBtn) standBtn.addEventListener('click', stand);

    render(true);
    sync();
  })();

  /* =========================================================
   * 三、百家樂（Baccarat，簡化單副牌）
   * ======================================================= */

  (function initBaccarat() {
    var playerEl = document.getElementById('bc-player-cards');
    var bankerEl = document.getElementById('bc-banker-cards');
    var playerScoreEl = document.getElementById('bc-player-score');
    var bankerScoreEl = document.getElementById('bc-banker-score');
    var statusEl = document.getElementById('bc-status');
    var dealBtn = document.getElementById('bc-deal');
    var betRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="bc-bet"]'));

    var SUITS = ['♠', '♥', '♦', '♣'];
    var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    var deck = [];
    var bet = 25;
    var side = 'player';
    var busy = false;

    function baccaratValue(card) {
      if (card.rank === 'A') return 1;
      if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K' || card.rank === '10') return 0;
      return parseInt(card.rank, 10);
    }

    function total(hand) {
      var sum = 0;
      for (var i = 0; i < hand.length; i += 1) sum += baccaratValue(hand[i]);
      return sum % 10;
    }

    function buildDeck() {
      var cards = [];
      for (var s = 0; s < SUITS.length; s += 1) {
        for (var r = 0; r < RANKS.length; r += 1) {
          cards.push({ rank: RANKS[r], suit: SUITS[s] });
        }
      }
      return L7.shuffle(cards);
    }

    function cardEl(card) {
      var div = document.createElement('div');
      div.className = 'playing-card';
      var red = card.suit === '♥' || card.suit === '♦';
      div.classList.add(red ? 'card-red' : 'card-black');
      var rank = document.createElement('span');
      rank.className = 'card-rank';
      rank.textContent = card.rank;
      var suit = document.createElement('span');
      suit.className = 'card-suit';
      suit.textContent = card.suit;
      div.appendChild(rank);
      div.appendChild(suit);
      div.setAttribute('aria-label', card.rank + card.suit);
      return div;
    }

    function render(player, banker) {
      if (playerEl) {
        playerEl.innerHTML = '';
        player.forEach(function (c) { playerEl.appendChild(cardEl(c)); });
      }
      if (bankerEl) {
        bankerEl.innerHTML = '';
        banker.forEach(function (c) { bankerEl.appendChild(cardEl(c)); });
      }
      if (playerScoreEl) playerScoreEl.textContent = player.length ? String(total(player)) : '—';
      if (bankerScoreEl) bankerScoreEl.textContent = banker.length ? String(total(banker)) : '—';
    }

    // 莊家補牌規則（依玩家第三張牌決定）
    function bankerShouldDraw(bankerTotal, playerThird) {
      if (bankerTotal <= 2) return true;
      if (bankerTotal === 3) return playerThird !== 8;
      if (bankerTotal === 4) return playerThird >= 2 && playerThird <= 7;
      if (bankerTotal === 5) return playerThird >= 4 && playerThird <= 7;
      if (bankerTotal === 6) return playerThird >= 6 && playerThird <= 7;
      return false; // 7 點以上停牌
    }

    function play() {
      if (busy) return;
      if (!wallet.bet(bet)) {
        L7.announce(statusEl, '籌碼不足，請降低下注額或重置籌碼。', false);
        audio.lose();
        return;
      }
      busy = true;
      if (dealBtn) dealBtn.disabled = true;
      L7.announce(statusEl, '發牌中…');
      audio.card();

      deck = buildDeck();
      var player = [deck.pop(), deck.pop()];
      var banker = [deck.pop(), deck.pop()];
      var pt = total(player);
      var bt = total(banker);
      var playerThird = null;

      if (pt <= 5) {
        player.push(deck.pop());
        playerThird = baccaratValue(player[2]);
        pt = total(player);
      }

      if (pt >= 8 || bt >= 8) {
        // 天生 8 / 9，雙方皆不補牌
      } else if (playerThird === null) {
        if (bt <= 5) banker.push(deck.pop());
      } else if (bankerShouldDraw(bt, playerThird)) {
        banker.push(deck.pop());
      }

      pt = total(player);
      bt = total(banker);
      render(player, banker);

      var result;
      if (pt === bt) result = 'tie';
      else if (pt > bt) result = 'player';
      else result = 'banker';

      var payout = 0;
      var message;
      if (result === side) {
        if (result === 'banker') {
          payout = Math.round(bet * 1.95); // 莊家 1:1 扣 5% 傭金
          message = '莊家勝（' + bt + ' 比 ' + pt + '），扣除 5% 傭金後獲得 ' + fmt(payout) + ' 籌碼。';
        } else if (result === 'player') {
          payout = bet * 2;
          message = '玩家勝（' + pt + ' 比 ' + bt + '），獲得 ' + fmt(payout) + ' 籌碼。';
        } else {
          payout = bet * 9;
          message = '和局（雙方 ' + pt + ' 點），獲得 ' + fmt(payout) + ' 籌碼。';
        }
        wallet.payout(payout);
        audio.win(result === 'tie');
      } else {
        message = (result === 'tie' ? '和局' : (result === 'player' ? '玩家勝' : '莊家勝')) +
          '（' + pt + ' 比 ' + bt + '），本局未中注。';
        audio.lose();
      }

      L7.announce(statusEl, message, result === side);
      busy = false;
      if (dealBtn) dealBtn.disabled = false;
    }

    betRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        bet = parseInt(r.value, 10) || 25;
        if (r.name === 'bc-side') side = r.value;
      });
    });
    var sideRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="bc-side"]'));
    sideRadios.forEach(function (r) {
      r.addEventListener('change', function () { side = r.value; });
    });
    if (dealBtn) dealBtn.addEventListener('click', play);

    render([], []);
  })();

})(window);
