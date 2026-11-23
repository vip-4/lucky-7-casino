/* =========================================================
 * Lucky7 Hub — 核心共用模組（純前端、零外部依賴）
 *
 * 提供：安全隨機數、共用虛擬籌包、Web Audio 音效、工具函式。
 * 所有遊戲共用同一個籌包；籌碼皆為虛擬，不涉及真實金錢。
 * ========================================================= */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'lucky7hub.credits.v1';
  var SOUND_KEY = 'lucky7hub.sound.v1';
  var INITIAL_CREDITS = 1000;

  /* ---------------- 隨機數 ---------------- */

  // 優先使用 crypto.getRandomValues；降級路徑僅供舊瀏覽器展示用
  function secureRandom() {
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      var buf = new Uint32Array(1);
      global.crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }

  function randomInt(maxExclusive) {
    return Math.floor(secureRandom() * maxExclusive);
  }

  function weightedPick(items, weightOf) {
    var total = 0;
    var i;
    for (i = 0; i < items.length; i += 1) total += weightOf(items[i]);
    var r = secureRandom() * total;
    for (i = 0; i < items.length; i += 1) {
      r -= weightOf(items[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function shuffle(array) {
    var arr = array.slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = randomInt(i + 1);
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /* ---------------- 格式化 ---------------- */

  function formatNumber(n) {
    return Number(n).toLocaleString('zh-Hant');
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  /* ---------------- 共用籌包 ---------------- */

  var listeners = [];

  function readStoredCredits() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      var value = raw === null ? NaN : parseInt(raw, 10);
      return isFinite(value) && value >= 0 ? value : INITIAL_CREDITS;
    } catch (err) {
      return INITIAL_CREDITS;
    }
  }

  var wallet = {
    credits: readStoredCredits(),

    get: function () {
      return this.credits;
    },

    save: function () {
      try {
        if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, String(this.credits));
      } catch (err) {
        // 隱私模式下 localStorage 可能不可寫，忽略即可
      }
      this.emit();
    },

    canBet: function (amount) {
      return this.credits >= amount && amount > 0;
    },

    bet: function (amount) {
      if (!this.canBet(amount)) return false;
      this.credits -= amount;
      this.save();
      return true;
    },

    payout: function (amount) {
      this.credits += amount;
      this.save();
    },

    reset: function () {
      this.credits = INITIAL_CREDITS;
      this.save();
    },

    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },

    emit: function () {
      for (var i = 0; i < listeners.length; i += 1) {
        try {
          listeners[i](this.credits);
        } catch (err) {
          // 單一監聽器失敗不影響其他遊戲
        }
      }
    }
  };

  /* ---------------- 共用音效 ---------------- */

  var audioCtx = null;
  var muted = false;

  try {
    var rawSound = global.localStorage && global.localStorage.getItem(SOUND_KEY);
    muted = rawSound === '0';
  } catch (err) {
    muted = false;
  }

  var audio = {
    isMuted: function () {
      return muted;
    },

    unlock: function () {
      if (muted) return;
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume();
      } catch (err) {
        // 無使用者手勢時某些瀏覽器會拋錯，忽略即可
      }
    },

    toggle: function () {
      muted = !muted;
      try {
        if (global.localStorage) global.localStorage.setItem(SOUND_KEY, muted ? '0' : '1');
      } catch (err) {
        // 忽略
      }
      if (!muted) {
        this.unlock();
        this.tone(660, 0.1, 'sine', 0.04, 0);
      }
      return muted;
    },

    tone: function (freq, duration, type, volume, delay) {
      if (muted || !audioCtx || audioCtx.state !== 'running') return;
      try {
        var t0 = audioCtx.currentTime + (delay || 0);
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
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
        // 音效失敗不影響遊戲流程
      }
    },

    spin: function () {
      this.tone(220, 0.12, 'triangle', 0.045, 0);
      this.tone(330, 0.12, 'triangle', 0.035, 0.08);
    },

    win: function (big) {
      var notes = big ? [523, 659, 784, 1047] : [523, 659, 784];
      for (var i = 0; i < notes.length; i += 1) {
        this.tone(notes[i], 0.18, 'sine', 0.06, i * 0.09);
      }
    },

    lose: function () {
      this.tone(160, 0.16, 'sine', 0.035, 0);
    },

    card: function () {
      this.tone(480, 0.07, 'triangle', 0.035, 0);
    },

    chip: function () {
      this.tone(780, 0.06, 'square', 0.025, 0);
    }
  };

  /* ---------------- 狀態提示 ---------------- */

  function announce(element, message, isWin) {
    if (!element) return;
    element.textContent = message;
    if (isWin === undefined) {
      element.classList.remove('is-win', 'is-lose');
    } else {
      element.classList.toggle('is-win', Boolean(isWin));
      element.classList.toggle('is-lose', !isWin);
    }
  }

  function setBusy(button, busy, busyText, idleText) {
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busyText && idleText) {
      var label = button.querySelector('[data-label]');
      if (label) label.textContent = busy ? busyText : idleText;
    }
  }

  /* ---------------- 匯出 ---------------- */

  global.L7 = {
    secureRandom: secureRandom,
    randomInt: randomInt,
    weightedPick: weightedPick,
    shuffle: shuffle,
    formatNumber: formatNumber,
    clamp: clamp,
    wallet: wallet,
    audio: audio,
    announce: announce,
    setBusy: setBusy,
    INITIAL_CREDITS: INITIAL_CREDITS
  };

  // 首次手勢解鎖 Web Audio（iOS Safari 限制）
  ['pointerdown', 'keydown'].forEach(function (evt) {
    global.document.addEventListener(evt, function () {
      audio.unlock();
    }, { passive: true });
  });
})(window);
