/* =====================================================================
   supabase-sync.js
   키오스크/POS가 쓰는 localStorage를 Supabase와 실시간으로 맞춰 주는 어댑터.
   화면 코드는 그대로 두고, 이 파일만 끼우면 다른 기기끼리도 주문이 연동됩니다.
   URL/KEY를 비워 두면 아무것도 하지 않고 기존처럼 브라우저 안에서만 동작합니다.
   ===================================================================== */
(function () {
  'use strict';

  /* ▼ Supabase 대시보드 > Project Settings > API 에서 복사해 붙여넣기 */
  var SUPABASE_URL = '';        // 예: https://abcdefghijkl.supabase.co
  var SUPABASE_ANON_KEY = '';   // anon(public) 키. service_role 키는 절대 넣지 마세요

  var ORDERS_KEY = 'smartorder.orders';
  var SHARED_KEYS = ['smartorder.soldout', 'smartorder.seq', 'smartorder.pos.version', 'smartorder.pos.demoOffset',
    'smartorder.menus', 'smartorder.hours', 'smartorder.purchases', 'smartorder.aiconfig', 'smartorder.restaurants', 'smartorder.aistats'];

  var rawSet = Storage.prototype.setItem;
  var rawRemove = Storage.prototype.removeItem;
  var resolveReady;
  window.dbReady = new Promise(function (r) { resolveReady = r; });
  window.dbStatus = 'local';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase || !window.supabase.createClient) {
    if (SUPABASE_URL && !window.supabase) { console.warn('[supabase-sync] supabase-js CDN을 불러오지 못해 로컬 모드로 동작합니다.'); }
    resolveReady();
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var snapshot = {};               // order_number → 서버와 마지막으로 맞춘 주문 JSON
  var queue = Promise.resolve();   // 쓰기 요청을 순서대로 보내기 위한 큐
  var pullOrdersTimer = null;
  var pullStateTimer = null;
  var pushTimer = null;
  var pendingOrdersJSON = null;

  setTimeout(resolveReady, 4000);  // 네트워크가 느려도 4초 뒤에는 화면을 띄움

  function enqueue(job) {
    queue = queue.then(job).catch(function (e) { console.error('[supabase-sync] 요청 실패', e); });
    return queue;
  }
  /* jsonb는 키 순서를 바꿔 저장하므로 비교는 키 정렬 후에 함 */
  function stable(v) {
    if (Array.isArray(v)) { return '[' + v.map(stable).join(',') + ']'; }
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function local(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function setLocal(key, value) { try { rawSet.call(localStorage, key, value); } catch (e) { /* 저장소 사용 불가 */ } }
  function removeLocal(key) { try { rawRemove.call(localStorage, key); } catch (e) { /* 저장소 사용 불가 */ } }
  /* 같은 탭에서는 storage 이벤트가 안 생기므로 직접 알려서 화면이 바로 갱신되게 함 */
  function announce(key) { try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) { /* 구형 브라우저 */ } }

  /* ---------- 서버 → 브라우저 ---------- */
  async function pullOrders() {
    if (pendingOrdersJSON !== null) { schedulePullOrders(); return; }   // 보낼 변경이 남아 있으면 나중에 받기
    var res = await sb.from('orders').select('order_number,data').order('order_number', { ascending: true });
    if (res.error) { console.error('[supabase-sync] 주문 불러오기 실패', res.error); return; }
    var list = res.data.map(function (r) { return r.data; });
    snapshot = {};
    list.forEach(function (o) { snapshot[o.order_number] = stable(o); });
    var next = JSON.stringify(list);
    if (local(ORDERS_KEY) !== next) { setLocal(ORDERS_KEY, next); announce(ORDERS_KEY); }
  }

  async function pullState() {
    var res = await sb.from('app_state').select('key,value');
    if (res.error) { console.error('[supabase-sync] 상태 불러오기 실패', res.error); return; }
    var remote = {};
    res.data.forEach(function (r) { remote[r.key] = r.value; });
    SHARED_KEYS.forEach(function (k) {
      var before = local(k);
      if (remote[k] === undefined || remote[k] === null) { removeLocal(k); } else { setLocal(k, remote[k]); }
      if (local(k) !== before) { announce(k); }
    });
  }

  function schedulePullOrders() { clearTimeout(pullOrdersTimer); pullOrdersTimer = setTimeout(function () { enqueue(pullOrders); }, 200); }
  function schedulePullState() { clearTimeout(pullStateTimer); pullStateTimer = setTimeout(function () { enqueue(pullState); }, 200); }

  /* ---------- 브라우저 → 서버 (바뀐 주문만 전송) ---------- */
  function pushOrderChanges() {
    var json = pendingOrdersJSON;
    pendingOrdersJSON = null;
    var list = [];
    try { list = JSON.parse(json) || []; } catch (e) { list = []; }
    var rows = [];
    list.forEach(function (o) {
      if (!o || typeof o.order_number !== 'number') { return; }
      var s = stable(o);
      if (snapshot[o.order_number] === s) { return; }
      snapshot[o.order_number] = s;
      rows.push({
        order_number: o.order_number,
        order_status: o.order_status,
        channel: o.channel || null,
        total_price: o.total_price || 0,
        data: o,
        updated_at: new Date().toISOString()
      });
    });
    if (!rows.length) { return; }
    enqueue(async function () {
      var res = await sb.from('orders').upsert(rows, { onConflict: 'order_number' });
      if (res.error) { console.error('[supabase-sync] 주문 저장 실패', res.error); }
    });
  }

  function pushState(key, value) {
    enqueue(async function () {
      var res = await sb.from('app_state').upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (res.error) { console.error('[supabase-sync] 상태 저장 실패', res.error); }
    });
  }

  function deleteAllOrders() {
    snapshot = {};
    enqueue(async function () {
      var res = await sb.from('orders').delete().gte('order_number', 0);
      if (res.error) { console.error('[supabase-sync] 주문 초기화 실패', res.error); }
    });
  }

  /* ---------- localStorage 가로채기 ---------- */
  Storage.prototype.setItem = function (key, value) {
    rawSet.call(this, key, value);
    if (this !== window.localStorage) { return; }
    if (key === ORDERS_KEY) {
      pendingOrdersJSON = String(value);
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushOrderChanges, 120);
    } else if (SHARED_KEYS.indexOf(key) !== -1) {
      pushState(key, String(value));
    }
  };

  Storage.prototype.removeItem = function (key) {
    rawRemove.call(this, key);
    if (this !== window.localStorage) { return; }
    if (key === ORDERS_KEY) {
      clearTimeout(pushTimer);
      pendingOrdersJSON = null;
      deleteAllOrders();
    } else if (SHARED_KEYS.indexOf(key) !== -1) {
      pushState(key, null);
    }
  };

  /* ---------- 실시간 구독 ---------- */
  sb.channel('smartorder-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, schedulePullOrders)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, schedulePullState)
    .subscribe(function (status) {
      window.dbStatus = status === 'SUBSCRIBED' ? 'live' : status;
      var label = document.getElementById('syncText');
      if (label && status === 'SUBSCRIBED') { label.textContent = 'Supabase 실시간 연결'; }
      if (status === 'SUBSCRIBED') { schedulePullOrders(); schedulePullState(); }
    });

  /* ---------- 첫 로딩: 서버 데이터를 먼저 받은 뒤 화면 시작 ---------- */
  enqueue(function () { return Promise.all([pullOrders(), pullState()]); }).then(function () {
    window.dbStatus = window.dbStatus === 'local' ? 'connected' : window.dbStatus;
    resolveReady();
  });

  window.supabaseSync = { client: sb, pullOrders: pullOrders, pullState: pullState, localOrders: function () { return local(ORDERS_KEY); } };
})();
