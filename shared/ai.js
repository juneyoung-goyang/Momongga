/* =====================================================================
   MJC Table AI 메뉴 추천 (shared/ai.js)
   흐름: 학생의 자연어 질문
         → Claude가 menus 테이블용 SQL + 추천 문장 생성 (NL2SQL)
         → 브라우저 안 SQLite(sql.js)에서 SQL 실행
         → 학생 프로필(남은 칼로리, 어제 먹은 메뉴, 피할 재료)로 순서 정리
   Claude 호출 순서: ① Netlify 서버 함수(키를 서버에 보관) → ② 이 기기에 저장한 키 → ③ 규칙 기반
   ===================================================================== */
(function (global) {
  'use strict';

  var MODEL = 'claude-sonnet-5-5';
  var SCHEMA = 'CREATE TABLE menus (menu_id INTEGER, name TEXT, category TEXT, price INTEGER, cook_minutes INTEGER, ' +
    'kcal INTEGER, protein INTEGER, spicy INTEGER, has_meat INTEGER, soup INTEGER, sold_out INTEGER, wait_minutes INTEGER, restaurant TEXT);';
  var SCHEMA_DOC = SCHEMA + '\n-- category: 밥 | 면 | 돈까스 | 분식 | 국물\n-- restaurant: 한그릇 덮밥 | 면 공방 | 바삭 돈까스 | 분식 스테이션 | 든든 국밥\n-- spicy, has_meat, soup, sold_out: 0 또는 1\n' +
    '-- wait_minutes: 지금 주문하면 받기까지 걸리는 예상 시간(분, 조리 대기열 포함)';

  var sqlEngine = null;
  function loadSql() {
    if (sqlEngine) { return sqlEngine; }
    sqlEngine = new Promise(function (resolve) {
      if (!global.initSqlJs) { resolve(null); return; }
      global.initSqlJs({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/' + f; } })
        .then(resolve).catch(function () { resolve(null); });
    });
    return sqlEngine;
  }

  function tableRows(menus, pred) {
    return menus.filter(function (m) { return m.visible !== false; }).map(function (m) {
      return [m.menu_id, m.name, m.category, m.price, m.cook, m.kcal, m.protein, m.spicy, m.has_meat, m.soup, m.orderable === false || m.sold_out ? 1 : 0, Store.menuWait(m, pred), m.restaurantName || ''];
    });
  }

  function cleanSql(sql) {
    var s = String(sql || '').trim().replace(/;+\s*$/, '');
    if (!/^select\b/i.test(s)) { throw new Error('SELECT 문만 실행할 수 있어요'); }
    if (/;|--|\/\*|\b(insert|update|delete|drop|alter|create|attach|pragma|replace)\b/i.test(s)) { throw new Error('허용되지 않은 SQL이에요'); }
    if (!/\bfrom\s+menus\b/i.test(s)) { throw new Error('menus 테이블만 조회할 수 있어요'); }
    return s;
  }

  async function runSql(sql, menus, pred) {
    var safe = cleanSql(sql);
    var SQL = await loadSql();
    if (!SQL) { return null; }
    var db = new SQL.Database();
    try {
      db.run(SCHEMA);
      var stmt = db.prepare('INSERT INTO menus VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
      tableRows(menus, pred).forEach(function (r) { stmt.run(r); });
      stmt.free();
      var res = db.exec(safe);
      if (!res.length) { return []; }
      var cols = res[0].columns;
      var idCol = cols.indexOf('menu_id');
      var nameCol = cols.indexOf('name');
      return res[0].values.map(function (v) {
        if (idCol >= 0) { return Number(v[idCol]); }
        if (nameCol >= 0) { var m = menus.find(function (x) { return x.name === v[nameCol]; }); return m ? m.menu_id : null; }
        return null;
      }).filter(function (x) { return x !== null; });
    } finally { db.close(); }
  }

  /* ---------- 학생 맥락 ---------- */
  function context() {
    var pred = Store.predict();
    var member = Store.isMember();
    var profile = member ? Store.getProfile() : { name: '비회원', avoid: [], spicy: '보통', history: [], meals: [], dailyGoal: 0 };
    var intake = member ? Store.todayIntake() : { meals: [], total: 0, goal: 0, remain: 99999 };
    var menus = Store.getMenus();
    var hist = profile.history.slice().sort(function (a, b) { return a.daysAgo - b.daysAgo; }).map(function (h) {
      var m = menus.find(function (x) { return x.menu_id === h.menu_id; });
      return { daysAgo: h.daysAgo, name: m ? m.name : '', spicy: m ? m.spicy : 0 };
    });
    return { member: member, pred: pred, profile: profile, intake: intake, menus: menus, history: hist, yesterday: hist.find(function (h) { return h.daysAgo === 1; }) || null };
  }

  /* ---------- LLM 호출: BAZE 게이트웨이(OpenAI 호환) 또는 Claude API ---------- */
  var BAZE_BASE_DEFAULT = 'https://factchat-cloud.mindlogic.ai/v1/gateway';
  var CFG_KEYS = { provider: 'smartorder.llmProvider', bazeKey: 'smartorder.bazeKey', bazeModel: 'smartorder.bazeModel', bazeBase: 'smartorder.bazeBase' };
  /* 이 키들은 shared/supabase-sync.js의 동기화 대상이 아니므로 서버로 올라가지 않고 이 기기에만 남음 */

  function getConfig() {
    return {
      provider: Store.readRaw(CFG_KEYS.provider) || 'baze',
      bazeKey: Store.readRaw(CFG_KEYS.bazeKey) || '',
      bazeModel: Store.readRaw(CFG_KEYS.bazeModel) || '',
      bazeBase: (Store.readRaw(CFG_KEYS.bazeBase) || BAZE_BASE_DEFAULT).replace(/\/+$/, ''),
      claudeKey: Store.readRaw(Store.KEYS.claudeKey) || ''
    };
  }
  function saveConfig(patch) {
    if (patch.provider !== undefined) { Store.writeRaw(CFG_KEYS.provider, patch.provider); }
    if (patch.bazeKey !== undefined) { patch.bazeKey ? Store.writeRaw(CFG_KEYS.bazeKey, patch.bazeKey) : Store.removeKey(CFG_KEYS.bazeKey); }
    if (patch.bazeModel !== undefined) { patch.bazeModel ? Store.writeRaw(CFG_KEYS.bazeModel, patch.bazeModel) : Store.removeKey(CFG_KEYS.bazeModel); }
    if (patch.bazeBase !== undefined) { patch.bazeBase ? Store.writeRaw(CFG_KEYS.bazeBase, patch.bazeBase) : Store.removeKey(CFG_KEYS.bazeBase); }
    if (patch.claudeKey !== undefined) { patch.claudeKey ? Store.writeRaw(Store.KEYS.claudeKey, patch.claudeKey) : Store.removeKey(Store.KEYS.claudeKey); }
  }
  function hasLocalKey() {
    var c = getConfig();
    return c.provider === 'baze' ? !!c.bazeKey : !!c.claudeKey;
  }

  function httpError(res, label) {
    if (res.status === 401 || res.status === 403) { return new Error(label + ' 키가 올바르지 않거나 권한이 없어요 (' + res.status + ')'); }
    if (res.status === 402 || res.status === 429) { return new Error(label + ' 크레딧이나 사용 한도를 확인해 주세요 (' + res.status + ')'); }
    if (res.status === 404) { return new Error(label + ' 주소나 모델 ID를 확인해 주세요 (404)'); }
    return new Error(label + ' 응답 오류 (' + res.status + ')');
  }
  async function readError(res, label) {
    var err = httpError(res, label);
    try { var j = await res.json(); var m = j && (j.error && (j.error.message || j.error) || j.message); if (m && typeof m === 'string') { err.message += ': ' + m.slice(0, 120); } } catch (e) { /* 본문 없음 */ }
    return err;
  }

  async function callLLM(system, messages) {
    var cfg = getConfig();
    /* ① 배포한 사이트(Netlify)의 서버 함수: 키가 서버에만 있어 가장 안전 */
    var serverErr = null;
    if (/^https?:/.test(location.protocol)) {
      try {
        var r = await fetch('/.netlify/functions/ai', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ system: system, messages: messages })
        });
        if (r.ok) { var d = await r.json(); if (d && d.text) { return { text: d.text, via: 'server', provider: d.provider || '', model: d.model || '' }; } }
        else if (r.status !== 404) {
          try { var ej = await r.json(); serverErr = typeof ej.error === 'string' ? ej.error : 'AI 서버 오류 (' + r.status + ')'; } catch (x) { serverErr = 'AI 서버 오류 (' + r.status + ')'; }
        }
      } catch (e) { /* 서버 함수가 없으면 다음 방법 */ }
    }
    if (serverErr && !hasLocalKey()) { throw new Error(serverErr); }
    /* ② 이 기기에 저장한 키 */
    if (cfg.provider === 'baze') {
      if (!cfg.bazeKey) { return null; }
      if (!cfg.bazeModel) { throw new Error('모델 ID를 먼저 입력해 주세요 (BAZE 콘솔의 모델 탭에서 복사)'); }
      var res;
      try {
        res = await fetch(cfg.bazeBase + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + cfg.bazeKey },
          body: JSON.stringify({ model: cfg.bazeModel, messages: [{ role: 'system', content: system }].concat(messages), max_tokens: 700, temperature: 0.2 })
        });
      } catch (e) {
        throw new Error('BAZE에 연결하지 못했어요. 인터넷 연결을 확인하고, 계속 안 되면 브라우저 직접 호출이 막힌 것일 수 있어요(CORS). 이 경우 Netlify 서버 함수를 쓰세요');
      }
      if (!res.ok) { throw await readError(res, 'BAZE'); }
      var data = await res.json();
      var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (Array.isArray(text)) { text = text.map(function (c) { return c.text || ''; }).join(''); }
      if (!text) { throw new Error('BAZE 응답이 비어 있어요'); }
      return { text: text, via: 'browser', provider: 'baze', model: cfg.bazeModel };
    }
    if (!cfg.claudeKey) { return null; }
    var res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: system, messages: messages })
    });
    if (!res2.ok) { throw await readError(res2, 'Claude API'); }
    var data2 = await res2.json();
    return { text: (data2.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(''), via: 'browser', provider: 'claude', model: MODEL };
  }

  function parseJSON(text) {
    var t = String(text || '').replace(/```json|```/g, '');
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < 0) { throw new Error('JSON 없음'); }
    return JSON.parse(t.slice(a, b + 1));
  }

  function systemPrompt(ctx) {
    var p = ctx.pred;
    return [
      '너는 명지전문대 학생식당 앱 "MJC Table"의 AI 메뉴 도우미야.',
      '학생의 질문을 아래 SQLite 테이블을 조회하는 SELECT 문 하나로 바꾸고, 결과를 바탕으로 추천해.',
      '', SCHEMA_DOC, '',
      '[오늘 메뉴 데이터]', JSON.stringify(tableRows(ctx.menus, p).map(function (r) {
        return { menu_id: r[0], name: r[1], restaurant: r[12], category: r[2], price: r[3], cook_minutes: r[4], kcal: r[5], protein: r[6], spicy: r[7], has_meat: r[8], soup: r[9], sold_out: r[10], wait_minutes: r[11] };
      })),
      ctx.member
        ? '[학생 정보] 이름 ' + ctx.profile.name + ', 하루 목표 ' + ctx.intake.goal + 'kcal, 오늘 먹은 양 ' + ctx.intake.total + 'kcal, 남은 양 ' + ctx.intake.remain + 'kcal, ' +
          '피할 재료: ' + (ctx.profile.avoid.length ? ctx.profile.avoid.join(', ') : '없음') + ', 매운맛 ' + ctx.profile.spicy + ', ' +
          '최근 먹은 메뉴: ' + ctx.history.map(function (h) { return h.daysAgo + '일 전 ' + h.name; }).join(', ')
        : '[학생 정보] 비회원이라 개인 기록이 없어. 칼로리나 최근 주문 이야기는 하지 말고 오늘 메뉴와 대기 시간만으로 추천해. 칼로리 맞춤 추천을 원하면 로그인하면 된다고 짧게 알려 줘.',
      '[지금 식당 상황] 예상 대기 ' + p.currentWait + '분(' + p.level + '), ' + (p.recTime ? p.recTime + '에 오면 약 ' + p.recWait + '분' : '추천 시간 없음'),
      '',
      '규칙:',
      '1. sql은 menus 테이블만 조회하는 SELECT 문 하나. 반드시 sold_out = 0 조건을 넣고 SELECT menu_id, name 으로 시작.',
      '2. 학생이 시간 제한을 말하면 wait_minutes로 비교. 칼로리 이야기는 남은 칼로리와 비교.',
      '3. 질문에 조건이 없으면 학생의 최근 메뉴와 겹치지 않게 고르고, 어제 매운 걸 먹었다면 순한 메뉴를 우선.',
      '4. reply는 해요체 2문장 이내, 숫자(분, kcal, 원)를 넣어 구체적으로. 메뉴에 없는 정보는 지어내지 마.',
      '   여러 메뉴를 함께 주문받을 때 합계 금액과 총 소요 시간은 말하지 마(앱이 계산해서 보여 줌). 개별 메뉴의 분·원은 위 데이터 값만 써.',
      '5. 학생이 정한 시간 안에 받을 수 없거나 지금 혼잡하면 action.type을 "reserve"로 하고 추천 시간에 예약을 권해.',
      '   학생이 주문까지 해 달라고 하면 action.type을 "add"로. 그 외에는 "none".',
      '6. 학생이 메뉴 이름을 직접 말하며 담아 달라고 하면 action.items에 말한 메뉴를 모두 넣어. 수량을 말하면 qty에 숫자로(말 안 하면 1).',
      '   메뉴 이름은 [오늘 메뉴 데이터]의 menu_id로만 찾아. 데이터에 없는 메뉴는 items에 넣지 말고 reply에서 없다고 알려 줘.',
      '7. 아직 장바구니에 담지 않았어. 앱이 버튼으로 담아 주니까 reply에 "담아드렸어요" 같은 완료 표현은 쓰지 말고 "담을 수 있어요", "아래 버튼으로 담아 보세요"처럼 말해.',
      '출력은 JSON 하나만: {"sql": "...", "reply": "...", "pick_ids": [숫자], "action": {"type": "none|add|reserve", "items": [{"menu_id": 숫자, "qty": 숫자}]}}',
      'action.type이 "none"이면 items는 빈 배열 [].'
    ].join('\n');
  }

  /* ---------- 규칙 기반 (키가 없을 때) ---------- */
  function ruleBased(q, ctx) {
    var t = q.replace(/\s/g, '');
    var where = ['sold_out = 0'];
    var order = 'wait_minutes ASC';
    var why = [];
    var limitMin = (t.match(/(\d+)분/) || [])[1];
    if (/고기(말고|빼|없|안)|채식|비건/.test(t)) { where.push('has_meat = 0'); why.push('고기 없는'); }
    if (/국물|따뜻|뜨끈/.test(t)) { where.push('soup = 1'); why.push('국물 있는'); }
    if (/안매운|덜매운|순한|맵지않/.test(t)) { where.push('spicy = 0'); why.push('순한'); }
    else if (/매운|얼큰|칼칼/.test(t)) { where.push('spicy = 1'); why.push('매콤한'); }
    if (limitMin) { where.push('wait_minutes <= ' + Number(limitMin)); why.push(limitMin + '분 안에 받는'); }
    if (/단백질|헬스|운동|근육/.test(t)) { order = 'protein DESC'; why.push('단백질 많은'); }
    else if (/가성비|싼|저렴|싸게/.test(t)) { order = 'price ASC'; why.push('저렴한'); }
    else if (/칼로리|다이어트|가볍|살/.test(t)) { if (ctx.member) { where.push('kcal <= ' + Math.max(400, ctx.intake.remain)); why.push('남은 칼로리에 맞는'); } else { why.push('칼로리가 낮은'); } order = 'kcal ASC'; }
    if (/어제|다른거|질려|새로운/.test(t) && ctx.yesterday) {
      var y = ctx.menus.find(function (m) { return m.name === ctx.yesterday.name; });
      if (y) { where.push('menu_id <> ' + y.menu_id); }
      if (ctx.yesterday.spicy) { where.push('spicy = 0'); why.push('어제와 다른 순한'); }
    }
    var sql = 'SELECT menu_id, name FROM menus WHERE ' + where.join(' AND ') + ' ORDER BY ' + order + ' LIMIT 3';
    var action = { type: 'none', menu_id: null };
    if (limitMin && ctx.pred.currentWait > Number(limitMin) && ctx.pred.recTime) { action = { type: 'reserve', menu_id: null }; }
    return { sql: sql, why: why, action: action };
  }

  function jsFilter(sql, menus, pred) {
    /* sql.js를 못 불러온 경우의 대체: 규칙 기반 조건만 해석 */
    var rows = menus.filter(function (m) { return m.visible !== false && !m.sold_out; }).map(function (m) {
      return Object.assign({}, m, { wait_minutes: Store.menuWait(m, pred) });
    });
    var w = (sql.match(/WHERE (.*?)( ORDER BY|$)/i) || [])[1] || '';
    w.split(' AND ').forEach(function (c) {
      var m = c.trim().match(/^(\w+)\s*(<=|>=|<>|=|<|>)\s*(\d+)$/);
      if (!m) { return; }
      var col = m[1] === 'cook_minutes' ? 'cook' : m[1], op = m[2], v = Number(m[3]);
      rows = rows.filter(function (r) {
        var x = Number(r[col]);
        return op === '=' ? x === v : op === '<>' ? x !== v : op === '<=' ? x <= v : op === '>=' ? x >= v : op === '<' ? x < v : x > v;
      });
    });
    var o = (sql.match(/ORDER BY (\w+) (ASC|DESC)/i) || []);
    if (o[1]) { var k = o[1] === 'cook_minutes' ? 'cook' : o[1]; rows.sort(function (a, b) { return (o[2].toUpperCase() === 'DESC' ? -1 : 1) * (a[k] - b[k]); }); }
    return rows.slice(0, 3).map(function (r) { return r.menu_id; });
  }

  /* LLM이 준 action을 안전하게 정리: 존재하고 주문 가능한 메뉴만, 수량 1~9, 최대 5개. 예전 형식(menu_id 하나)도 받아 줌 */
  function normalizeAction(action, menus) {
    var a = action && typeof action === 'object' ? action : {};
    var type = (a.type === 'add' || a.type === 'reserve') ? a.type : 'none';
    var raw = Array.isArray(a.items) ? a.items : [];
    if (!raw.length && a.menu_id) { raw = [{ menu_id: a.menu_id, qty: 1 }]; }
    var seen = {}, items = [];
    raw.forEach(function (it) {
      var id = Number(it && it.menu_id);
      var m = menus.find(function (x) { return x.menu_id === id; });
      if (!m || seen[id]) { return; }
      seen[id] = true;
      var q = Math.round(Number(it.qty));
      items.push({ menu_id: id, qty: q >= 1 && q <= 9 ? q : 1 });
    });
    items = items.slice(0, 5);
    return { type: type, menu_id: items.length ? items[0].menu_id : null, items: items };
  }

  /* 실제로 담지 않았는데 '담아드렸어요'라고 말하는 문장을 막음 */
  function fixReply(text) {
    return String(text || '').replace(/(장바구니에\s*)?담아\s*드렸(어요|습니다)[.!]?/g, '아래 버튼으로 담을 수 있어요.');
  }

  /* 여러 메뉴 주문일 때 AI가 지어낼 수 있는 합계 금액·총 시간 문장을 지움(앱이 정확히 계산해서 보여 줌) */
  function dropTotals(text) {
    var parts = String(text || '').split(/(?<=[.!?])\s+/);
    var kept = parts.filter(function (p) { return !/합계|총\s*[\d,]+\s*원|[\d,]+\s*원에\s*\d+\s*분|\d+\s*분\s*(내로|안에)\s*(준비|받|나)/.test(p); });
    var r = kept.join(' ').trim();
    return r || '아래 버튼으로 담을 수 있어요.';
  }

  function objName(w) { var c = w.charCodeAt(w.length - 1); var b = c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; return w + (b ? '을' : '를'); }

  /* ---------- 공개 함수 ---------- */
  async function ask(question, history) {
    var ctx = context();
    var pred = ctx.pred;
    var out = { engine: 'rule', via: null, sql: '', reply: '', ids: [], action: { type: 'none', menu_id: null, items: [] }, error: null };

    var claude = null;
    try {
      var msgs = (history || []).slice(-4).concat([{ role: 'user', content: question }]);
      claude = await callLLM(systemPrompt(ctx), msgs);
    } catch (e) { out.error = e.message; }

    if (claude) {
      try {
        var j = parseJSON(claude.text);
        out.engine = 'llm'; out.via = claude.via; out.provider = claude.provider; out.model = claude.model;
        out.sql = j.sql || ''; out.reply = j.reply || '';
        out.action = normalizeAction(j.action, ctx.menus);
        out.reply = fixReply(out.reply);
        var ids = null;
        try { ids = await runSql(out.sql, ctx.menus, pred); } catch (e) { out.error = 'SQL 실행 실패: ' + e.message; }
        if (ids === null) { ids = jsFilter(out.sql, ctx.menus, pred); }
        var picks = (j.pick_ids || []).map(Number);
        out.ids = picks.filter(function (id) { return ids.indexOf(id) >= 0; }).concat(ids.filter(function (id) { return picks.indexOf(id) < 0; })).slice(0, 3);
        if (!out.ids.length && picks.length) { out.ids = picks.slice(0, 3); }
        /* 학생이 직접 고른 메뉴(items)는 SQL 결과와 상관없이 카드에 모두 보여 줌 */
        var itemIds = out.action.items.map(function (it) { return it.menu_id; });
        if (itemIds.length >= 2) {
          /* 여러 메뉴를 직접 골랐으면 고른 메뉴만 보여 줌(다른 추천 카드가 섞이면 헷갈림). 합계·시간은 앱이 계산하므로 AI 문장의 합계 표현은 지움 */
          out.ids = itemIds;
          out.reply = dropTotals(out.reply);
        } else if (itemIds.length) {
          out.ids = itemIds.concat(out.ids.filter(function (id) { return itemIds.indexOf(id) < 0; })).slice(0, 3);
        }
      } catch (e) { claude = null; out.error = 'AI 응답을 해석하지 못했어요'; }
    }

    if (!claude) {
      var r = ruleBased(question, ctx);
      out.sql = r.sql; out.action = { type: r.action.type, menu_id: null, items: [] };
      var rid = null;
      try { rid = await runSql(r.sql, ctx.menus, pred); } catch (e) { rid = null; }
      out.ids = rid === null ? jsFilter(r.sql, ctx.menus, pred) : rid;
      var relaxed = false;
      if (!out.ids.length && /wait_minutes <= \d+/.test(r.sql)) {
        /* 정한 시간 안에 받을 수 있는 메뉴가 없으면 시간 조건만 빼고 가장 빠른 메뉴를 찾아 예약을 권함 */
        var sql2 = r.sql.replace(/ AND wait_minutes <= \d+/, '');
        var rid2 = null;
        try { rid2 = await runSql(sql2, ctx.menus, pred); } catch (e) { rid2 = null; }
        out.ids = rid2 === null ? jsFilter(sql2, ctx.menus, pred) : rid2;
        out.sql = sql2; relaxed = out.ids.length > 0;
      }
      var first = ctx.menus.find(function (m) { return m.menu_id === out.ids[0]; });
      if (first && relaxed) {
        var lim = (question.replace(/\s/g, '').match(/(\d+)분/) || [])[1];
        out.reply = '지금은 ' + lim + '분 안에 받을 수 있는 메뉴가 없어요. 가장 빠른 건 ' + objName(first.name).replace(/[을를]$/, '') + '(약 ' + Store.menuWait(first, pred) + '분)이에요.' +
          (pred.recTime ? ' ' + pred.recTime + '에 예약하면 대기 약 ' + pred.recWait + '분이에요.' : '');
        out.action = pred.recTime ? { type: 'reserve', menu_id: first.menu_id, items: [{ menu_id: first.menu_id, qty: 1 }] } : { type: 'none', menu_id: null, items: [] };
      } else if (!first) {
        out.reply = '조건에 맞는 메뉴가 지금은 없어요. 조건을 하나 빼고 다시 물어봐 주세요.';
      } else {
        out.reply = (r.why.length ? r.why.join(', ') + ' 메뉴로 ' : '') + objName(first.name) + ' 추천해요. 지금 주문하면 약 ' + Store.menuWait(first, pred) + '분, ' + first.kcal + 'kcal예요.';
        if (out.action.type === 'reserve') { out.reply += ' 정한 시간 안에는 어려워서 ' + pred.recTime + ' 예약을 권해요(대기 약 ' + pred.recWait + '분).'; }
      }
    }
    out.menus = out.ids.map(function (id) { return ctx.menus.find(function (m) { return m.menu_id === id; }); }).filter(Boolean);
    out.pred = pred;
    return out;
  }

  /* 서버에 키가 설정됐는지 확인 (키 값은 받지 않음) */
  async function serverStatus() {
    if (!/^https?:/.test(location.protocol)) { return { ready: false, reason: 'local' }; }
    try {
      var r = await fetch('/.netlify/functions/ai', { method: 'GET', headers: { accept: 'application/json' } });
      if (!r.ok) { return { ready: false, reason: r.status === 404 ? 'nofunction' : 'error' }; }
      var d = await r.json();
      return { ready: !!d.ready, provider: d.provider, model: d.model, reason: d.ready ? '' : 'nokey' };
    } catch (e) { return { ready: false, reason: 'nofunction' }; }
  }

  async function testConnection() {
    var r = await callLLM('한 단어로만 답해.', [{ role: 'user', content: '연결 확인. "연결됨"이라고 답해.' }]);
    return r ? { via: r.via, provider: r.provider, model: r.model } : null;
  }

  global.MJCAI = { ask: ask, testConnection: testConnection, serverStatus: serverStatus, getConfig: getConfig, saveConfig: saveConfig, hasLocalKey: hasLocalKey, BAZE_BASE_DEFAULT: BAZE_BASE_DEFAULT, MODEL: MODEL, SCHEMA: SCHEMA_DOC, context: context };
})(window);
