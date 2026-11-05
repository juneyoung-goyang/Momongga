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
   (선택) GEMINI_REASONING_EFFORT  none | minimal | low | medium | high — 생각 시간을 줄여 응답을 빠르게 (모델이 지원할 때만)
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
async function fetchWithTimeout(url, options) {
  const ms = Number(process.env.AI_TIMEOUT_MS || 8500);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({}, options, { signal: ctl.signal })); }
  finally { clearTimeout(timer); }
}
function isTimeout(e) { return e && (e.name === 'AbortError' || e.name === 'TimeoutError'); }

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
    const keyName = isGemini ? 'GEMINI_API_KEY' : 'BAZE_API_KEY';
    if (!p.ready) { return reply(503, { error: (isGemini ? 'GEMINI_MODEL' : 'BAZE_MODEL') + '이 설정되지 않았어요 (콘솔에서 모델 ID 복사)' }); }
    const base = (isGemini
      ? (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai')
      : (process.env.BAZE_BASE_URL || 'https://factchat-cloud.mindlogic.ai/v1/gateway')).replace(/\/+$/, '');
    const body = { model: p.model, messages: [{ role: 'system', content: system }].concat(messages), max_tokens: isGemini ? 2000 : 700, temperature: 0.2 };
    if (isGemini && process.env.GEMINI_REASONING_EFFORT) { body.reasoning_effort = process.env.GEMINI_REASONING_EFFORT; }
    let res;
    try {
      res = await fetchWithTimeout(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env[keyName] },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (isTimeout(e)) { return reply(504, { error: label + ' 응답이 너무 오래 걸려요 (' + Math.round(Number(process.env.AI_TIMEOUT_MS || 8500) / 1000) + '초 초과). 더 빠른 모델로 바꿔 보세요' }); }
      return reply(502, { error: label + '에 연결하지 못했어요' });
    }
    /* 본문을 먼저 글자로 읽어, JSON이 아니어도 원인을 볼 수 있게 함 */
    const raw = await res.text().catch(() => '');
    let data = {};
    try { data = JSON.parse(raw); } catch (e) { /* JSON이 아닌 본문 */ }
    if (!res.ok) {
      /* 상태 코드·메시지를 알려줌. 404를 '함수 없음'으로 오해하지 않도록 502로 감싸 보냄. 키는 가림 */
      const detail = upstreamMessage(data, raw, process.env[keyName]);
      return reply(502, { error: label + ' 오류 (' + res.status + ')' + (detail ? ': ' + detail : ''), upstream_status: res.status });
    }
    let text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (Array.isArray(text)) { text = text.map(c => c.text || '').join(''); }
    if (!text) { return reply(502, { error: label + ' 응답이 비어 있어요' }); }
    return reply(200, { text, provider: p.name, model: p.model });
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
