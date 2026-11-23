/* =========================================================
 * Lucky7 Hub — 大廳互動（分頁切換、共用籌包同步）
 * ========================================================= */
(function (global) {
  'use strict';

  var L7 = global.L7;
  if (!L7) return;

  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('[role="tabpanel"]'));

  function activate(tab, focusIt) {
    tabs.forEach(function (t) {
      var selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });

    // 讓 Canvas 在顯示後重新計算尺寸（ResizeObserver 會接手）
    var panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) {
      var canvas = panel.querySelector('canvas');
      if (canvas) {
        global.requestAnimationFrame(function () {
          global.dispatchEvent(new Event('resize'));
        });
      }
    }
    if (focusIt) tab.focus();
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { activate(tab, false); });
    tab.addEventListener('keydown', function (e) {
      var next = null;
      if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        activate(next, true);
      }
    });
  });

  // 共用籌包同步到所有顯示位置
  var displays = [
    document.getElementById('credits'),
    document.getElementById('hub-credits'),
    document.getElementById('hub-credits-2')
  ].filter(Boolean);

  function syncCredits(value) {
    var text = L7.formatNumber(value);
    displays.forEach(function (el) { el.textContent = text; });
  }

  L7.wallet.onChange(syncCredits);
  syncCredits(L7.wallet.get());

  //  Email / 頁面可見性：回到分頁時重繪輪盤（由 table-games 監聽 visibilitychange）
  global.addEventListener('pagehide', function () {
    // 無需額外動作，籌包已即時寫入 localStorage
  });
})(window);
