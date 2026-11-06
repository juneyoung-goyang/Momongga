/* =====================================================================
   Netlify 서버 함수: 모든 사용자가 키 없이 AI 추천을 쓰도록, 개발자의 API 키를 서버에서만 사용
   개발자는 Netlify 환경 변수에 키를 한 번만 붙여 넣으면 됨 (README의 'AI 키 설정' 참고)

   [A] 학교 BAZE API Gateway (OpenAI 호환)  ← 먼저 확인
       BAZE_API_KEY   발급받은 키
       BAZE_MODEL     BAZE 콘솔 '모델' 탭에서 복사한 모델 ID
       BAZE_BASE_URL  (선택) 기본값 https://factchat-cloud.mindlogic.ai/v1/gateway
   [B] Google AI Studio (Gemini, OpenAI 호환 주소 사용)
       GEMINI_API_KEY   AI Studio에서 만든 키
       GEMINI_MODEL     AI Studio에서 복사한 모델 ID (예: gemini-로 시작하는 이름)
       GEMINI_BASE_URL  (선택) 기본값 https://generativelanguage.googleapis.com/v1beta/openai
   [C] Claude API
       ANTHROPIC_API_KEY, (선택) CLAUDE_MODEL
   (선택) AI_TIMEOUT_MS  외부 AI 응답을 기다리는 최대 시간(기본 8500). Netlify 함수 기본 제한(약 10초)보다 짧아야 원인 문구가 보임
   (선택) GEMINI_REASONING_EFFORT  none | minimal | low | medium | high | off — 생각 시간(기본 low). 모델이 거절하면 자동으로 빼고 재시도
   (선택) GEMINI_FALLBACK_MODELS  쉼표로 구분한 대체 모델 ID. 503(수요 폭주) 등 일시 오류 때 차례로 시도 (예: 모델A,모델B)
   (선택) AI_PROVIDER  baze | gemini | claude  — 키가 여러 개일 때 쓸 곳을 강제로 지정. 없으면 baze → gemini → claude 순서
   (선택) RATE_LIMIT_PER_MIN  한 사람(IP)이 1분에 보낼 수 있는 요청 수, 기본 15

   보호 장치: 키는 응답에 절대 포함하지 않음 · 모델은 서버 설정만 따름 · 다른 사이트에서의 호출 차단
             · IP별 분당 요청 제한 · 질문 길이 제한
   ===================================================================== */
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const hits = new Map(); // 같은 서버 인스턴스가 살아 있는 동안만 유지되는 간단한 제한

function provider() {
  const has = {
    baze: !!process.env.BAZE_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY
  };
  const forced = String(process.env.AI_PROVIDER || '').toLowerCase();
  const name = (forced && has[forced]) ? forced : ['baze', 'gemini', 'claude'].find(n => has[n]);
  if (name === 'baze') { return { name, model: process.env.BAZE_MODEL || '', ready: !!process.env.BAZE_MODEL }; }
  if (name === 'gemini') { return { name, model: process.env.GEMINI_MODEL || '', ready: !!process.env.GEMINI_MODEL }; }
  if (name === 'claude') { return { name, model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', ready: true }; }
  return { name: 'none', model: '', ready: false };
}

/* 제한 시간 안에 응답이 없으면 끊음 (Netlify가 먼저 504로 끊어 버리면 원인을 알 수 없으므로) */
async function fetchWithTimeout(url, options, msOverride) {
  const ms = msOverride || Number(process.env.AI_TIMEOUT_MS || 8500);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({}, options, { signal: ctl.signal })); }
  finally { clearTimeout(timer); }
}
function isTimeout(e) { return e && (e.name === 'AbortError' || e.name === 'TimeoutError'); }

/* BAZE·Gemini 공통 호출(OpenAI 호환). Gemini는 '생각 시간'을 줄이는 reasoning_effort를 보내고,
   모델이 그 값을 거절(400·422)하면 값을 빼고 한 번 더 시도함. 걸린 시간(ms)을 함께 돌려줌 */
async function callCompat(p, system, messages, opt) {
  opt = opt || {};
  const isGemini = p.name === 'gemini';
  const keyName = isGemini ? 'GEMINI_API_KEY' : 'BAZE_API_KEY';
  const base = (isGemini
    ? (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai')
    : (process.env.BAZE_BASE_URL || 'https://factchat-cloud.mindlogic.ai/v1/gateway')).replace(/\/+$/, '');
  const model = opt.model || p.model;
  let effort = isGemini ? (opt.effort !== undefined ? opt.effort : (process.env.GEMINI_REASONING_EFFORT || 'low')) : '';
  if (effort === 'off') { effort = ''; }
  const t0 = Date.now();
  let retried = false;
  for (;;) {
    const body = { model, messages: [{ role: 'system', content: system }].concat(messages), max_tokens: opt.maxTokens || (isGemini ? 1500 : 700), temperature: 0.2 };
    if (effort) { body.reasoning_effort = effort; }
    const res = await fetchWithTimeout(base + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env[keyName] },
      body: JSON.stringify(body)
    }, opt.timeoutMs);
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (e) { /* JSON이 아닌 본문 */ }
    if (!res.ok && effort && !retried && (res.status === 400 || res.status === 422)) { retried = true; effort = ''; continue; }
    return { res, raw, data, ms: Date.now() - t0, effort, retried, model, keyName };
  }
}

/* 외부 AI 오류 응답에서 사람이 읽을 메시지만 뽑음 (OpenAI식 error.message, message, detail 등). 키 문자열은 *** 로 가림 */
function upstreamMessage(data, raw, key) {
  let m = '';
  if (data && typeof data === 'object') {
    const e = data.error;
    if (e && typeof e === 'object') { m = e.message || e.code || ''; }
    else if (typeof e === 'string') { m = e; }
    if (!m) { m = data.message || data.detail || ''; }
    if (m && typeof m !== 'string') { try { m = JSON.stringify(m); } catch (x) { m = ''; } }
  }
  if (!m && raw) { m = String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  m = String(m || '').slice(0, 200);
  if (key) { m = m.split(key).join('***'); }
  return m;
}

function allowedOrigin(origin) {
  if (!origin) { return true; } // 같은 사이트의 일부 요청은 Origin이 없음
  const allow = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL, 'http://localhost:8888']
    .filter(Boolean).map(u => u.replace(/\/+$/, ''));
  return allow.includes(origin.replace(/\/+$/, ''));
}

function limited(ip) {
  const max = Number(process.env.RATE_LIMIT_PER_MIN || 15);
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) { hits.clear(); }
  return list.length > max;
}

exports.handler = async function (event) {
  const p = provider();

  /* 상태 확인: 앱이 "AI 서버 연결됨"을 표시할 때 사용 (키는 알려주지 않음) */
  if (event.httpMethod === 'GET') {
    /* ?models=1 : (Gemini 전용) 이 키로 쓸 수 있는 모델 ID 목록. 모델 이름을 몰라 404가 날 때 확인용. 키는 알려주지 않음 */
    const qs = event.queryStringParameters || {};
    /* ?ping=1[&model=이름][&effort=none|minimal|low|medium|high|off] : 짧은 질문 1번으로 응답 속도(ms)를 잼. 모델·설정을 바꿔 가며 빠른 조합 찾기용 */
    if (qs.ping && (p.name === 'gemini' || p.name === 'baze') && p.ready) {
      const h1 = event.headers || {};
      const ip1 = h1['x-nf-client-connection-ip'] || (h1['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited(ip1)) { return reply(429, { error: '잠시 후 다시 시도해 주세요' }); }
      const okName = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(v);
      const opt = { maxTokens: 200 };
      if (okName(qs.model)) { opt.model = qs.model; }
      if (okName(qs.effort)) { opt.effort = qs.effort; }
      try {
        const r = await callCompat(p, '한 단어로만 답해.', [{ role: 'user', content: '연결 확인. "연결됨"이라고 답해.' }], opt);
        const txt = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
        return reply(200, { provider: p.name, model: r.model, effort: r.effort || '없음', retried_without_effort: r.retried, ok: r.res.ok, status: r.res.status, ms: r.ms,
          answer: r.res.ok ? String(txt || '(빈 응답)').slice(0, 60) : upstreamMessage(r.data, r.raw, process.env[r.keyName]) });
      } catch (e) { return reply(200, { provider: p.name, ok: false, error: isTimeout(e) ? '제한 시간 초과 (' + Number(process.env.AI_TIMEOUT_MS || 8500) + 'ms)' : '연결 실패' }); }
    }
    if (qs.models && p.name === 'gemini') {
      const h = event.headers || {};
      const ip0 = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited(ip0)) { return reply(429, { error: '잠시 후 다시 시도해 주세요' }); }
      try {
        const url = process.env.GEMINI_LIST_URL || 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
        const r = await fetchWithTimeout(url, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
        const raw = await r.text().catch(() => '');
        let d = {};
        try { d = JSON.parse(raw); } catch (e) { /* JSON 아님 */ }
        if (!r.ok) { return reply(502, { error: 'Gemini 모델 목록 오류 (' + r.status + '): ' + upstreamMessage(d, raw, process.env.GEMINI_API_KEY) }); }
        const ids = (d.models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
          .map(m => String(m.name).replace(/^models\//, ''));
        return reply(200, { provider: 'gemini', current_model: p.model, usable_models: ids });
      } catch (e) { return reply(502, { error: isTimeout(e) ? '모델 목록 응답이 너무 오래 걸려요' : '모델 목록을 가져오지 못했어요' }); }
    }
    return reply(200, { ready: p.ready, provider: p.name, model: p.ready ? p.model : '' });
  }
  if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }

  const headers = event.headers || {};
  if (!allowedOrigin(headers.origin || headers.Origin)) { return reply(403, { error: '허용되지 않은 사이트에서의 요청이에요' }); }
  const ip = headers['x-nf-client-connection-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) { return reply(429, { error: '잠시 후 다시 시도해 주세요 (요청이 너무 많아요)' }); }
  if ((event.body || '').length > 45000) { return reply(413, { error: '요청이 너무 커요' }); }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad JSON' }); }
  const system = String(payload.system || '').slice(0, 24000);
  const messages = (Array.isArray(payload.messages) ? payload.messages.slice(-6) : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!messages.length) { return reply(400, { error: 'messages가 비어 있어요' }); }

  if (p.name === 'baze' || p.name === 'gemini') {
    const isGemini = p.name === 'gemini';
    const label = isGemini ? 'Gemini' : 'BAZE';
    if (!p.ready) { return reply(503, { error: (isGemini ? 'GEMINI_MODEL' : 'BAZE_MODEL') + '이 설정되지 않았어요 (콘솔에서 모델 ID 복사)' }); }
    /* 일시적 오류(429·500·502·503·504)는 같은 모델로 한 번 더, 또는 GEMINI_FALLBACK_MODELS(쉼표로 구분)의 다른 모델로 넘어가 시도.
       전체 대기는 AI_TIMEOUT_MS 안에서만. 키·모델 이름 오류(400·401·402·404)는 재시도하지 않고 바로 알려줌 */
    const total = Number(process.env.AI_TIMEOUT_MS || 8500);
    const deadline = Date.now() + total;
    const TRANSIENT = [429, 500, 502, 503, 504];
    const extra = isGemini ? String(process.env.GEMINI_FALLBACK_MODELS || '').split(',').map(x => x.trim().replace(/^models\//, '')).filter(x => /^[A-Za-z0-9._-]{1,60}$/.test(x) && x !== p.model) : [];
    const tries = [p.model].concat(extra.length ? extra : [p.model]);
    let r = null, timedOut = false;
    for (let i = 0; i < tries.length; i++) {
      const remain = deadline - Date.now();
      if (i > 0 && remain < 1500) { break; }
      try { r = await callCompat(p, system, messages, { model: tries[i], timeoutMs: Math.max(remain, 500) }); }
      catch (e) {
        if (isTimeout(e)) { timedOut = true; r = null; break; }
        r = null; return reply(502, { error: label + '에 연결하지 못했어요' });
      }
      console.log('[ai] try ' + (i + 1) + ' ' + p.name + ' ' + r.model + ' status=' + r.res.status + ' ms=' + r.ms + ' effort=' + (r.effort || '-') + (r.retried ? ' (effort removed)' : ''));
      if (r.res.ok || !TRANSIENT.includes(r.res.status)) { break; }
      await new Promise(ok => setTimeout(ok, 500));
    }
    if (!r) {
      return reply(504, { error: label + ' 응답이 너무 오래 걸려요 (' + Math.round(total / 1000) + '초 초과). 더 빠른 모델이나 reasoning 설정을 써 보세요' });
    }
    if (!r.res.ok) {
      /* 상태 코드·메시지를 알려줌. 404를 '함수 없음'으로 오해하지 않도록 502로 감싸 보냄. 키는 가림 */
      const detail = upstreamMessage(r.data, r.raw, process.env[r.keyName]);
      return reply(502, { error: label + ' 오류 (' + r.res.status + ')' + (detail ? ': ' + detail : ''), upstream_status: r.res.status });
    }
    let text = r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
    if (Array.isArray(text)) { text = text.map(c => c.text || '').join(''); }
    if (!text) { return reply(502, { error: label + ' 응답이 비어 있어요 (생각에 출력 한도를 다 썼을 수 있어요)' }); }
    return reply(200, { text, provider: p.name, model: r.model, ms: r.ms });
  }

  if (p.name === 'claude') {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: p.model, max_tokens: 700, system, messages })
      });
    } catch (e) { return reply(502, { error: 'Claude API에 연결하지 못했어요' }); }
    const data = await res.json();
    if (!res.ok) { return reply(res.status, { error: (data.error && data.error.message) || 'Claude API 오류' }); }
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return reply(200, { text, provider: 'claude', model: p.model });
  }

  return reply(503, { error: 'AI 키가 설정되지 않았어요. 개발자가 Netlify 환경 변수에 BAZE_API_KEY와 BAZE_MODEL (또는 GEMINI_API_KEY와 GEMINI_MODEL)을 넣어 주세요' });
};
