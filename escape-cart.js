/*
 * escape.id カート追加ブックマークレット
 * escape.id のイベントページ（日付・時間を選んだあと: ?d=...&u=...）で実行する
 */
(function () {
  "use strict";

  var PANEL_ID = "esc-cart-panel";
  var STORE_KEY = "escCartSettings";

  if (location.hostname !== "escape.id") {
    alert("escape.id のイベントページで実行してください。");
    return;
  }
  var existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.style.display = "block";
    return;
  }

  // ---------- ユーティリティ ----------
  function decodeAstro(v) {
    if (!Array.isArray(v) || v.length !== 2) return v;
    var kind = v[0], data = v[1];
    if (kind === 0) {
      if (data && typeof data === "object" && !Array.isArray(data)) {
        var o = {};
        Object.keys(data).forEach(function (k) { o[k] = decodeAstro(data[k]); });
        return o;
      }
      return data;
    }
    if (kind === 1) return data.map(decodeAstro);
    return data;
  }

  function devalueParse(text) {
    var values = typeof text === "string" ? JSON.parse(text) : text;
    var special = { "-1": undefined, "-2": undefined, "-3": NaN, "-4": Infinity, "-5": -Infinity, "-6": -0 };
    var cache = {};
    function hydrate(i) {
      if (i < 0) return special[String(i)];
      if (i in cache) return cache[i];
      var v = values[i], out;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        out = {}; cache[i] = out;
        Object.keys(v).forEach(function (k) { out[k] = hydrate(v[k]); });
        return out;
      }
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === "string") {
          var t = v[0];
          if (t === "Date" || t === "BigInt" || t === "URL" || t === "RegExp") { cache[i] = v[1]; return v[1]; }
          if (t === "Set") { out = v.slice(1).map(hydrate); cache[i] = out; return out; }
          out = v.slice(1); cache[i] = out; return out;
        }
        out = []; cache[i] = out;
        v.forEach(function (j) { out.push(hydrate(j)); });
        return out;
      }
      cache[i] = v;
      return v;
    }
    return hydrate(0);
  }

  function getEventInfo() {
    var el = document.querySelector('astro-island[component-export="EventInitializer"]');
    if (!el) throw new Error("イベント情報がページ内に見つかりません。");
    var raw = JSON.parse(el.getAttribute("props"));
    var props = {};
    Object.keys(raw).forEach(function (k) { props[k] = decodeAstro(raw[k]); });
    if (!props.info) throw new Error("イベント情報の形式が想定と違います。");
    return props.info;
  }

  function fetchSlotDetail(slotUuid) {
    return fetch("/_actions/getEventSlotDetailForSingle/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ uuid: slotUuid })
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) throw new Error("時間枠の取得に失敗しました（" + res.status + "）: " + text.slice(0, 200));
        var root = devalueParse(text);
        if (root && root.data && !root.detail) root = root.data;
        if (!root || !root.detail) throw new Error("時間枠の情報が見つかりません。");
        return root.detail;
      });
    });
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toLocalInput(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }
  function fmtTime(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) +
      "." + ("00" + date.getMilliseconds()).slice(-3);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくても続行 */ }
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- パネル ----------
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML =
    '<style>' +
    '#' + PANEL_ID + '{position:fixed;left:8px;right:8px;bottom:8px;max-height:85vh;overflow:auto;z-index:2147483647;' +
    'background:rgb(255,255,255);color:rgb(17,17,17);border:2px solid rgb(17,17,17);border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;padding:12px;max-width:560px;margin:0 auto}' +
    '#' + PANEL_ID + ' *{box-sizing:border-box;font:inherit;color:inherit}' +
    '#' + PANEL_ID + ' h3{margin:0 0 8px;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center}' +
    '#' + PANEL_ID + ' label{display:block;margin:8px 0 2px;font-weight:600;font-size:12px;color:rgb(80,80,80)}' +
    '#' + PANEL_ID + ' select,#' + PANEL_ID + ' input{width:100%;padding:8px;border:1px solid rgb(170,170,170);border-radius:6px;background:rgb(255,255,255);font-size:16px}' +
    '#' + PANEL_ID + ' .row{display:flex;gap:8px}#' + PANEL_ID + ' .row>div{flex:1}' +
    '#' + PANEL_ID + ' button{padding:10px 14px;border-radius:8px;border:2px solid rgb(17,17,17);background:rgb(255,255,255);font-weight:700;font-size:15px}' +
    '#' + PANEL_ID + ' button.primary{background:rgb(17,17,17);color:rgb(255,255,255)}' +
    '#' + PANEL_ID + ' button:disabled{opacity:.35}' +
    '#' + PANEL_ID + ' .btns{display:flex;gap:8px;margin-top:12px}#' + PANEL_ID + ' .btns button{flex:1}' +
    '#' + PANEL_ID + ' .x{border:none;padding:0 4px;font-size:20px;line-height:1}' +
    '#' + PANEL_ID + ' .status{margin-top:10px;font-weight:700;font-size:16px;text-align:center}' +
    '#' + PANEL_ID + ' .log{margin-top:8px;background:rgb(244,244,244);border-radius:6px;padding:6px 8px;font:12px/1.4 ui-monospace,Menlo,monospace;' +
    'max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all}' +
    '#' + PANEL_ID + ' .muted{color:rgb(110,110,110);font-size:12px}' +
    '</style>' +
    '<h3><span>カート追加ツール</span><button class="x" data-act="hide" title="閉じる">×</button></h3>' +
    '<div class="info muted">読込中...</div>' +
    '<div class="form" style="display:none">' +
    '  <label>プラン</label><select data-f="plan"></select>' +
    '  <div class="row"><div><label>枚数</label><input data-f="qty" type="number" min="1" value="1" inputmode="numeric"></div>' +
    '  <div><label>再試行（回）</label><input data-f="rounds" type="number" min="1" value="20" inputmode="numeric"></div>' +
    '  <div><label>間隔（分）</label><input data-f="interval" type="number" min="1" value="9" inputmode="numeric"></div></div>' +
    '  <label>開始時刻</label><input data-f="target" type="datetime-local" step="1">' +
    '  <div class="inq"></div>' +
    '  <div class="btns"><button class="primary" data-act="start">開始</button><button data-act="stop" disabled>停止</button></div>' +
    '</div>' +
    '<div class="status"></div>' +
    '<div class="log"></div>';
  document.body.appendChild(panel);

  function q(sel) { return panel.querySelector(sel); }
  var logEl = q(".log"), statusEl = q(".status");
  function log(msg) {
    logEl.textContent += "[" + fmtTime(new Date()) + "] " + msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(msg) { statusEl.textContent = msg; }

  // ---------- 状態 ----------
  var state = { slot: null, event: null, running: false, stop: false, wakeLock: null };

  function buildInquiryAnswers() {
    var answers = [], missing = [];
    (state.event.inquiries || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .forEach(function (inq) {
        var input = panel.querySelector('[data-inq="' + inq.uuid + '"]');
        var val = input ? input.value : "";
        if (val) answers.push({ uuid: inq.uuid, answer: val });
        else if (inq.required) missing.push(inq.question);
      });
    return { answers: answers, missing: missing };
  }

  function renderInquiries() {
    var box = q(".inq");
    var html = "";
    (state.event.inquiries || []).forEach(function (inq) {
      var options = String(inq.options || "").split("\n").filter(function (o) { return o.trim(); });
      var title = esc(String(inq.question || "").split("\n")[0]) + (inq.required ? "（必須）" : "");
      if (inq.type === "checkbox" && options.length) {
        html += '<label>' + title + '</label><select data-inq="' + esc(inq.uuid) + '">' +
          options.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join("") +
          (inq.required ? "" : '<option value="">（回答しない）</option>') + '</select>';
      } else if (options.length) {
        html += '<label>' + title + '</label><select data-inq="' + esc(inq.uuid) + '">' +
          '<option value="">選択してください</option>' +
          options.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join("") + '</select>';
      } else {
        html += '<label>' + title + '</label><input data-inq="' + esc(inq.uuid) + '" type="text">';
      }
    });
    box.innerHTML = html ? '<div class="muted" style="margin-top:10px">設問への回答</div>' + html : "";
  }

  // ---------- 初期化 ----------
  function init() {
    var slotUuid = new URLSearchParams(location.search).get("u");
    if (!slotUuid) {
      q(".info").textContent = "日付と時間を選んでから実行してください（URL に u=... が必要です）。";
      return;
    }
    try {
      state.event = getEventInfo();
    } catch (e) {
      q(".info").textContent = e.message;
      return;
    }
    fetchSlotDetail(slotUuid).then(function (detail) {
      state.slot = detail;
      var plans = detail.plans || [];
      var saved = loadSettings();

      var salesStart = detail.salesStartAt ? new Date(detail.salesStartAt) : null;
      q(".info").innerHTML =
        "<b>" + esc(state.event.eventName) + "</b><br>" +
        esc(detail.startTimeString) + " の回 ／ 空き: " + esc(detail.vacancyType) +
        (salesStart ? "<br>販売開始: " + esc(salesStart.toLocaleString("ja-JP")) : "");

      var sel = q('[data-f="plan"]');
      sel.innerHTML = plans.map(function (p, i) {
        return '<option value="' + i + '">' + esc(p.planName) + "（" + esc(p.unitPrice) + "円）</option>";
      }).join("");
      if (saved.planName) {
        plans.forEach(function (p, i) { if (p.planName === saved.planName) sel.value = String(i); });
      }
      if (saved.qty) q('[data-f="qty"]').value = saved.qty;
      if (saved.rounds) q('[data-f="rounds"]').value = saved.rounds;
      if (saved.interval) q('[data-f="interval"]').value = saved.interval;

      var target = salesStart && salesStart > new Date() ? salesStart : new Date(Date.now() + 10000);
      q('[data-f="target"]').value = toLocalInput(target);

      renderInquiries();
      q(".form").style.display = plans.length ? "block" : "none";
      if (!plans.length) log("この時間枠にはプランがありません。");
      log("準備完了。プランと時刻を確認して「開始」を押してください。");
    }).catch(function (e) {
      q(".info").textContent = e.message;
      log(e.message);
    });
  }

  // ---------- カート追加 ----------
  function addToCart(payload) {
    return fetch("/api/cart/item/add", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/plain, */*" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.status !== 200) {
          log("エラー " + res.status + ": " + text.slice(0, 300));
          return false;
        }
        var json;
        try { json = JSON.parse(text); } catch (e) { log("応答が JSON ではありません: " + text.slice(0, 200)); return false; }
        var warnings = json.warnings || [];
        if (warnings.some(function (w) { return w && w.type === "NOT_IN_SALES_PERIOD"; })) {
          log("販売期間外（まだ販売開始前）");
          return false;
        }
        log("成功: " + text.slice(0, 300));
        return true;
      });
    }).catch(function (e) {
      log("通信エラー: " + e.message);
      return false;
    });
  }

  function checkStop() { if (state.stop) throw new Error("STOPPED"); }

  async function waitUntil(target) {
    while (true) {
      checkStop();
      var remain = target - Date.now();
      if (remain <= 0) return;
      var s = Math.ceil(remain / 1000);
      setStatus("開始まで " + Math.floor(s / 60) + "分" + pad(s % 60) + "秒");
      if (remain > 3000) await sleep(Math.min(1000, remain - 2000));
      else if (remain > 50) await sleep(10);
      else await sleep(0);
    }
  }

  async function attempt(payload, target) {
    await waitUntil(target);
    log("実行");
    if (await addToCart(payload)) return true;
    for (var i = 0; i < 10; i++) {
      checkStop();
      await sleep(20);
      if (await addToCart(payload)) return true;
    }
    return false;
  }
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        log("画面スリープを防止しています。");
      } else {
        log("この端末は画面スリープ防止に非対応です。自動ロックをオフにしてください。");
      }
    } catch (e) {
      log("画面スリープ防止に失敗: " + e.message);
    }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.running && !state.wakeLock) requestWakeLock();
  });

  async function start() {
    var plans = state.slot.plans || [];
    var plan = plans[Number(q('[data-f="plan"]').value)];
    var qty = parseInt(q('[data-f="qty"]').value, 10);
    var rounds = parseInt(q('[data-f="rounds"]').value, 10);
    var interval = parseFloat(q('[data-f="interval"]').value);
    var target = new Date(q('[data-f="target"]').value);

    if (!plan || !(qty > 0) || !(rounds > 0) || !(interval > 0) || isNaN(target)) {
      alert("入力内容を確認してください。");
      return;
    }
    var inq = buildInquiryAnswers();
    if (inq.missing.length) {
      alert("必須の設問に回答してください:\n" + inq.missing.join("\n"));
      return;
    }

    var payload = {
      slotTicketPlans: [{ uuid: plan.uuid, quantity: qty }],
      inquiryAnswers: inq.answers,
      productListings: []
    };
    saveSettings({ planName: plan.planName, qty: qty, rounds: rounds, interval: interval });
    log("payload: " + JSON.stringify(payload));

    state.running = true;
    state.stop = false;
    q('[data-act="start"]').disabled = true;
    q('[data-act="stop"]').disabled = false;
    await requestWakeLock();

    var nextAt = target.getTime();
    try {
      for (var r = 0; r < rounds; r++) {
        log("===== " + (r + 1) + " / " + rounds + " 回目 =====");
        var ok = await attempt(payload, nextAt);
        setStatus(ok ? "カート追加成功" : "カート追加失敗");
        if (ok) log("カートを確認して購入手続きを進めてください。");
        nextAt = Date.now() + interval * 60000;
      }
      setStatus("すべての回が終わりました");
    } catch (e) {
      if (e.message === "STOPPED") { setStatus("停止しました"); log("停止しました。"); }
      else { setStatus("エラー"); log("エラー: " + e.message); }
    } finally {
      state.running = false;
      q('[data-act="start"]').disabled = false;
      q('[data-act="stop"]').disabled = true;
      if (state.wakeLock) { try { state.wakeLock.release(); } catch (e) { /* ignore */ } state.wakeLock = null; }
    }
  }

  panel.addEventListener("click", function (ev) {
    var act = ev.target.getAttribute && ev.target.getAttribute("data-act");
    if (act === "start") start();
    else if (act === "stop") state.stop = true;
    else if (act === "hide") {
      if (state.running && !confirm("実行中です。パネルを閉じても処理は続きます。閉じますか？")) return;
      panel.style.display = "none";
    }
  });

  init();
})();
