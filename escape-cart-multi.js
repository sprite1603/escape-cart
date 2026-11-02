/*
 * escape.id カート追加ブックマークレット（複数日程版）
 * escape.id のどのページでも実行できる。日程は
 *   - 「このページの日程を追加」（日付・時間を選んだページで）
 *   - URL をまとめて貼り付けて「URLから追加」
 * で登録する。登録した日程はこのブラウザに保存され、次回も残る。
 */
(function () {
  "use strict";

  var PANEL_ID = "esc-multi-panel";
  var STORE_KEY = "escCartMulti";

  if (location.hostname !== "escape.id") {
    alert("escape.id のページで実行してください。");
    return;
  }
  var existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.style.display = "block";
    return;
  }

  // ---------- 解析 ----------
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

  function eventInfoFromDoc(doc) {
    var el = doc.querySelector('astro-island[component-export="EventInitializer"]');
    if (!el) throw new Error("イベント情報が見つかりません");
    var raw = JSON.parse(el.getAttribute("props"));
    var props = {};
    Object.keys(raw).forEach(function (k) { props[k] = decodeAstro(raw[k]); });
    if (!props.info) throw new Error("イベント情報の形式が想定と違います");
    return props.info;
  }

  // イベントページ（パス単位）ごとに設問情報をキャッシュ
  var eventCache = {};
  function getEventInfo(url) {
    var u = new URL(url, location.href);
    var key = u.pathname;
    if (eventCache[key]) return Promise.resolve(eventCache[key]);
    if (u.pathname === location.pathname) {
      try { eventCache[key] = eventInfoFromDoc(document); return Promise.resolve(eventCache[key]); } catch (e) { /* 取得し直す */ }
    }
    return fetch(u.pathname, { credentials: "include" }).then(function (res) {
      if (!res.ok) throw new Error("イベントページの取得に失敗（" + res.status + "）");
      return res.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      eventCache[key] = eventInfoFromDoc(doc);
      return eventCache[key];
    });
  }

  function fetchSlotDetail(slotUuid) {
    return fetch("/_actions/getEventSlotDetailForSingle/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ uuid: slotUuid })
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) throw new Error("時間枠の取得に失敗（" + res.status + "）");
        var root = devalueParse(text);
        if (root && root.data && !root.detail) root = root.data;
        if (!root || !root.detail) throw new Error("時間枠の情報が見つかりません");
        return root.detail;
      });
    });
  }

  // ---------- ユーティリティ ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toLocalInput(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function fmtTime(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + "." + ("00" + d.getMilliseconds()).slice(-3);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function slotUuidOf(url) {
    try { return new URL(url, location.href).searchParams.get("u"); } catch (e) { return null; }
  }
  function normalizeUrl(url) {
    var u = new URL(url, location.href);
    return u.origin + u.pathname + "?" + (u.searchParams.get("d") ? "d=" + u.searchParams.get("d") + "&" : "") + "u=" + u.searchParams.get("u");
  }
  function slotLabel(slot, event) {
    var d = slot.startAt ? new Date(slot.startAt) : null;
    var date = d ? (d.getMonth() + 1) + "/" + d.getDate() + "(" + "日月火水木金土"[d.getDay()] + ") " : "";
    return (event.eventName || "") + "　" + date + (slot.startTimeString || "");
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveStore() {
    var s = {
      rounds: q('[data-f="rounds"]').value,
      interval: q('[data-f="interval"]').value,
      slots: slots.map(function (s) {
        return {
          url: s.url,
          enabled: s.el && !s.error ? s.el.querySelector('[data-s="enabled"]').checked : s.saved.enabled !== false,
          planName: s.plan && s.plan() ? s.plan().planName : s.saved.planName,
          qty: s.el && !s.error ? s.el.querySelector('[data-s="qty"]').value : s.saved.qty
        };
      })
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくても続行 */ }
  }

  // ---------- パネル ----------
  var P = "#" + PANEL_ID;
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML =
    "<style>" +
    P + "{position:fixed;left:8px;right:8px;bottom:8px;max-height:88vh;overflow:auto;z-index:2147483647;background:rgb(255,255,255);color:rgb(17,17,17);" +
    "border:2px solid rgb(17,17,17);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;padding:12px;max-width:560px;margin:0 auto}" +
    P + " *{box-sizing:border-box;font:inherit;color:inherit}" +
    P + " h3{margin:0 0 8px;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center}" +
    P + " label{display:block;margin:6px 0 2px;font-weight:600;font-size:12px;color:rgb(80,80,80)}" +
    P + " select," + P + " input[type=number]," + P + " input[type=text]," + P + " input[type=datetime-local]," + P + " textarea{width:100%;padding:8px;border:1px solid rgb(170,170,170);border-radius:6px;background:rgb(255,255,255);font-size:16px}" +
    P + " textarea{height:70px;font-size:13px}" +
    P + " .row{display:flex;gap:8px}" + P + " .row>div{flex:1}" +
    P + " button{padding:9px 12px;border-radius:8px;border:2px solid rgb(17,17,17);background:rgb(255,255,255);font-weight:700;font-size:14px}" +
    P + " button.primary{background:rgb(17,17,17);color:rgb(255,255,255)}" +
    P + " button:disabled{opacity:.35}" +
    P + " .btns{display:flex;gap:8px;margin-top:10px}" + P + " .btns button{flex:1}" +
    P + " .x{border:none;padding:0 4px;font-size:20px;line-height:1}" +
    P + " .card{border:1px solid rgb(200,200,200);border-radius:8px;padding:8px 10px;margin-top:8px}" +
    P + " .card.off{opacity:.45}" +
    P + " .card .head{display:flex;align-items:center;gap:8px;font-weight:700}" +
    P + " .card .head input{width:20px;height:20px}" +
    P + " .card .head span{flex:1}" +
    P + " .card .del{border:none;padding:2px 6px;font-size:13px;color:rgb(180,30,30)}" +
    P + " .st{margin-top:6px;font-weight:700}" +
    P + " .muted{color:rgb(110,110,110);font-size:12px}" +
    P + " .log{margin-top:8px;background:rgb(244,244,244);border-radius:6px;padding:6px 8px;font:12px/1.4 ui-monospace,Menlo,monospace;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-all}" +
    P + " details{margin-top:8px}" + P + " summary{font-weight:700;font-size:13px}" +
    "</style>" +
    '<h3><span>カート追加ツール（複数日程）</span><button class="x" data-act="hide">×</button></h3>' +
    '<div class="btns" style="margin-top:0"><button data-act="addhere">このページの日程を追加</button></div>' +
    "<details><summary>URLをまとめて追加</summary>" +
    '<textarea data-f="urls" placeholder="日付と時間を選んだあとのURLを1行に1つ"></textarea>' +
    '<div class="btns"><button data-act="addurls">URLから追加</button></div></details>' +
    '<div class="list"></div>' +
    '<div class="row"><div><label>再試行（回）</label><input data-f="rounds" type="number" min="1" value="20" inputmode="numeric"></div>' +
    '<div><label>間隔（分）</label><input data-f="interval" type="number" min="1" value="9" inputmode="numeric"></div></div>' +
    '<div class="btns"><button class="primary" data-act="start" disabled>開始</button><button data-act="stop" disabled>停止</button></div>' +
    '<div class="log"></div>';
  document.body.appendChild(panel);

  function q(sel) { return panel.querySelector(sel); }
  var logEl = q(".log");
  function log(msg) {
    logEl.textContent += "[" + fmtTime(new Date()) + "] " + msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------- 日程 ----------
  var slots = [];         // {url, uuid, slot, event, saved, el, plan(), label}
  var running = false, stopFlag = false, wakeLock = null;

  function renderSlot(s) {
    var plans = s.slot.plans || [];
    var sales = s.slot.salesStartAt ? new Date(s.slot.salesStartAt) : null;
    var target = sales && sales > new Date() ? sales : new Date(Date.now() + 10000);
    var el = document.createElement("div");
    el.className = "card";
    var inqHtml = "";
    (s.event.inquiries || []).forEach(function (inq) {
      var options = String(inq.options || "").split("\n").filter(function (o) { return o.trim(); });
      if (inq.type === "checkbox" && options.length) return; // 同意系は自動で回答
      var title = esc(String(inq.question || "").split("\n")[0]) + (inq.required ? "（必須）" : "");
      inqHtml += "<label>" + title + "</label>" + (options.length
        ? '<select data-inq="' + esc(inq.uuid) + '"><option value="">選択してください</option>' +
          options.map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select>"
        : '<input type="text" data-inq="' + esc(inq.uuid) + '">');
    });
    el.innerHTML =
      '<div class="head"><input type="checkbox" data-s="enabled"' + (s.saved.enabled === false ? "" : " checked") + ">" +
      "<span>" + esc(s.label) + '</span><button class="del" data-s="del">削除</button></div>' +
      '<div class="muted">空き: ' + esc(s.slot.vacancyType) + (sales ? "　販売開始: " + esc(sales.toLocaleString("ja-JP")) : "") + "</div>" +
      '<div class="row"><div style="flex:2"><label>プラン</label><select data-s="plan">' +
      plans.map(function (p, i) { return '<option value="' + i + '">' + esc(p.planName) + "（" + esc(p.unitPrice) + "円）</option>"; }).join("") +
      '</select></div><div><label>枚数</label><input data-s="qty" type="number" min="1" inputmode="numeric" value="' + esc(s.saved.qty || 1) + '"></div></div>' +
      '<label>開始時刻</label><input data-s="target" type="datetime-local" step="1" value="' + toLocalInput(target) + '">' +
      inqHtml +
      '<div class="st" data-s="status"></div>';
    var sel = el.querySelector('[data-s="plan"]');
    plans.forEach(function (p, i) { if (p.planName === s.saved.planName) sel.value = String(i); });
    s.plan = function () { return plans[Number(sel.value)]; };
    s.el = el;
    s.setStatus = function (t) { el.querySelector('[data-s="status"]').textContent = t; };
    function syncOff() { el.classList.toggle("off", !el.querySelector('[data-s="enabled"]').checked); }
    el.querySelector('[data-s="enabled"]').addEventListener("change", function () { syncOff(); saveStore(); });
    sel.addEventListener("change", saveStore);
    el.querySelector('[data-s="qty"]').addEventListener("change", saveStore);
    el.querySelector('[data-s="del"]').addEventListener("click", function () {
      if (running) { alert("実行中は削除できません。"); return; }
      slots = slots.filter(function (x) { return x !== s; });
      el.remove();
      saveStore();
      updateButtons();
    });
    syncOff();
    q(".list").appendChild(el);
  }

  function renderError(s) {
    var el = document.createElement("div");
    el.className = "card off";
    el.innerHTML = '<div class="head"><span>' + esc(s.url) + '</span><button class="del" data-s="del">削除</button></div>' +
      '<div class="st">読み込み失敗: ' + esc(s.error) + "</div>";
    el.querySelector('[data-s="del"]').addEventListener("click", function () {
      if (running) { alert("実行中は削除できません。"); return; }
      slots = slots.filter(function (x) { return x !== s; });
      el.remove();
      saveStore();
      updateButtons();
    });
    s.el = el;
    q(".list").appendChild(el);
  }

  function addSlot(url, saved) {
    var uuid = slotUuidOf(url);
    if (!uuid) return Promise.reject(new Error("u=（時間枠）がないURLです: " + url));
    var norm = normalizeUrl(url);
    if (slots.some(function (s) { return s.uuid === uuid; })) {
      log("登録済みのためスキップ: " + norm);
      return Promise.resolve();
    }
    var s = { url: norm, uuid: uuid, saved: saved || {} };
    slots.push(s); // 並び順を保つため先に場所を確保
    return Promise.all([fetchSlotDetail(uuid), getEventInfo(norm)]).then(function (r) {
      s.slot = r[0]; s.event = r[1];
      s.label = slotLabel(s.slot, s.event);
      renderSlot(s);
      log("追加: " + s.label);
    }).catch(function (e) {
      if (saved) {
        // 保存済みの日程は一時的な失敗で消さず、エラー表示で残す
        s.error = e.message;
        renderError(s);
      } else {
        slots = slots.filter(function (x) { return x !== s; });
      }
      throw new Error(e.message + "（" + norm + "）");
    });
  }

  function addMany(urls, savedMap) {
    // 表示順を入力順にそろえるため1件ずつ
    return urls.reduce(function (p, url) {
      return p.then(function () {
        return addSlot(url, savedMap && savedMap[url]).catch(function (e) { log("失敗: " + e.message); });
      });
    }, Promise.resolve()).then(function () { saveStore(); updateButtons(); });
  }

  function updateButtons() {
    q('[data-act="start"]').disabled = running || !slots.some(function (s) { return !s.error && s.el; });
    q('[data-act="stop"]').disabled = !running;
    q('[data-act="addhere"]').disabled = running;
    q('[data-act="addurls"]').disabled = running;
  }

  // ---------- 実行 ----------
  function addToCart(s, payload) {
    return fetch("/api/cart/item/add", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/plain, */*" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.status !== 200) { log("[" + s.label + "] エラー " + res.status + ": " + text.slice(0, 200)); return false; }
        var json;
        try { json = JSON.parse(text); } catch (e) { log("[" + s.label + "] 応答が JSON ではありません"); return false; }
        if ((json.warnings || []).some(function (w) { return w && w.type === "NOT_IN_SALES_PERIOD"; })) {
          log("[" + s.label + "] 販売期間外");
          return false;
        }
        log("[" + s.label + "] 成功: " + text.slice(0, 200));
        return true;
      });
    }).catch(function (e) { log("[" + s.label + "] 通信エラー: " + e.message); return false; });
  }

  function checkStop() { if (stopFlag) throw new Error("STOPPED"); }

  async function waitUntil(s, target) {
    var shown = null;
    while (true) {
      checkStop();
      var remain = target - Date.now();
      if (remain <= 0) return;
      var sec = Math.ceil(remain / 1000);
      if (sec !== shown) { shown = sec; s.setStatus("待機中 あと" + Math.floor(sec / 60) + "分" + pad(sec % 60) + "秒"); }
      if (remain > 3000) await sleep(Math.min(1000, remain - 2000));
      else if (remain > 50) await sleep(10);
      else await sleep(0);
    }
  }

  async function runSlot(s, job, rounds, interval) {
    var nextAt = job.target, wins = 0;
    try {
      for (var r = 0; r < rounds; r++) {
        await waitUntil(s, nextAt);
        s.setStatus("送信中");
        log("[" + s.label + "] " + (r + 1) + "/" + rounds + " 回目 実行");
        var ok = await addToCart(s, job.payload);
        for (var i = 0; !ok && i < 10; i++) {
          checkStop();
          await sleep(20);
          ok = await addToCart(s, job.payload);
        }
        if (ok) wins++;
        s.setStatus((r + 1) + "回目 " + (ok ? "成功" : "失敗") + "（成功 " + wins + "回）");
        nextAt = Date.now() + interval * 60000;
      }
      s.setStatus("完了（成功 " + wins + "回）");
    } catch (e) {
      s.setStatus(e.message === "STOPPED" ? "停止" : "エラー: " + e.message);
    }
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) { wakeLock = await navigator.wakeLock.request("screen"); log("画面スリープを防止しています。"); }
      else log("この端末は画面スリープ防止に非対応です。自動ロックをオフにしてください。");
    } catch (e) { log("画面スリープ防止に失敗: " + e.message); }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && running && !wakeLock) requestWakeLock();
  });

  async function start() {
    var rounds = parseInt(q('[data-f="rounds"]').value, 10);
    var interval = parseFloat(q('[data-f="interval"]').value);
    if (!(rounds > 0) || !(interval > 0)) { alert("再試行の回数と間隔を確認してください。"); return; }

    var jobs = [], errors = [];
    slots.forEach(function (s) {
      if (s.error) return;
      if (!s.el.querySelector('[data-s="enabled"]').checked) { s.setStatus("（実行しない）"); return; }
      var plan = s.plan();
      var qty = parseInt(s.el.querySelector('[data-s="qty"]').value, 10);
      var target = new Date(s.el.querySelector('[data-s="target"]').value);
      if (!plan || !(qty > 0) || isNaN(target)) { errors.push(s.label + ": プラン・枚数・開始時刻を確認"); return; }
      var answers = [];
      (s.event.inquiries || []).forEach(function (inq) {
        var options = String(inq.options || "").split("\n").filter(function (o) { return o.trim(); });
        var input = s.el.querySelector('[data-inq="' + inq.uuid + '"]');
        var val = input ? input.value : (inq.type === "checkbox" && options.length ? options[0] : "");
        if (val) answers.push({ uuid: inq.uuid, answer: val });
        else if (inq.required) errors.push(s.label + ": 設問に回答してください");
      });
      jobs.push({ s: s, target: target.getTime(), payload: {
        slotTicketPlans: [{ uuid: plan.uuid, quantity: qty }],
        inquiryAnswers: answers,
        productListings: []
      } });
    });
    if (errors.length) { alert(errors.join("\n")); return; }
    if (!jobs.length) { alert("実行する日程にチェックを入れてください。"); return; }

    saveStore();
    jobs.forEach(function (j) { log("[" + j.s.label + "] " + JSON.stringify(j.payload.slotTicketPlans)); });
    running = true; stopFlag = false; updateButtons();
    await requestWakeLock();
    await Promise.all(jobs.map(function (j) { return runSlot(j.s, j, rounds, interval); }));
    running = false; updateButtons();
    if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
    log("すべての日程が終わりました。");
  }

  panel.addEventListener("click", function (ev) {
    var act = ev.target.getAttribute && ev.target.getAttribute("data-act");
    if (act === "start") start();
    else if (act === "stop") { stopFlag = true; log("停止します..."); }
    else if (act === "addhere") {
      if (!slotUuidOf(location.href)) { alert("日付と時間を選んだページで押してください（URL に u=... が必要です）。"); return; }
      addMany([location.href]);
    } else if (act === "addurls") {
      var urls = q('[data-f="urls"]').value.split(/\s+/).filter(function (u) { return u; });
      if (!urls.length) return;
      q('[data-f="urls"]').value = "";
      addMany(urls);
    } else if (act === "hide") {
      if (running && !confirm("実行中です。パネルを閉じても処理は続きます。閉じますか？")) return;
      panel.style.display = "none";
    }
  });
  q('[data-f="rounds"]').addEventListener("change", saveStore);
  q('[data-f="interval"]').addEventListener("change", saveStore);

  // ---------- 初期化：保存済みの日程を読み込み直す ----------
  var store = loadStore();
  if (store.rounds) q('[data-f="rounds"]').value = store.rounds;
  if (store.interval) q('[data-f="interval"]').value = store.interval;
  var savedSlots = store.slots || [];
  var savedMap = {};
  savedSlots.forEach(function (s) { savedMap[s.url] = s; });
  var initial = savedSlots.map(function (s) { return s.url; });
  if (slotUuidOf(location.href) && !savedSlots.length) initial.push(location.href);
  if (initial.length) {
    log("日程を読み込んでいます...");
    addMany(initial, savedMap);
  } else {
    log("日付と時間を選んだページで「このページの日程を追加」を押すか、URLをまとめて追加してください。");
  }
})();
