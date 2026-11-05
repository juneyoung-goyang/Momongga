/* =====================================================================
   Netlify 서버 함수: 모든 사용자가 키 없이 AI 추천을 쓰도록, 개발자의 API 키를 서버에서만 사용
   개발자는 Netlify 환경 변수에 키를 한 번만 붙여 넣으면 됨 (README의 'AI 키 설정' 참고)

   [A] 학교 BAZE API Gateway (OpenAI 호환)  ← 먼저 확인
       BAZE_API_KEY   발급받은 키
       BAZE_MODEL     BAZE 콘솔 '모델' 탭에서 복사한 모델 ID
       BAZE_BASE_URL  (선택) 기본값 https://factchat-cloud.mindlogic.ai/v1/gateway
   [B] Claude API
       ANTHROPIC_API_KEY, (선택) CLAUDE_MODEL
   (선택) RATE_LIMIT_PER_MIN  한 사람(IP)이 1분에 보낼 수 있는 요청 수, 기본 15

   보호 장치: 키는 응답에 절대 포함하지 않음 · 모델은 서버 설정만 따름 · 다른 사이트에서의 호출 차단
             · IP별 분당 요청 제한 · 질문 길이 제한
   ===================================================================== */
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });
const hits = new Map(); // 같은 서버 인스턴스가 살아 있는 동안만 유지되는 간단한 제한

function provider() {
  if (process.env.BAZE_API_KEY) {
    return { name: 'baze', model: process.env.BAZE_MODEL || '', ready: !!process.env.BAZE_MODEL };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { name: 'claude', model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', ready: true };
  }
  return { name: 'none', model: '', ready: false };
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

  if (p.name === 'baze') {
    if (!p.ready) { return reply(503, { error: 'BAZE_MODEL이 설정되지 않았어요 (BAZE 콘솔의 모델 탭에서 모델 ID 복사)' }); }
    const base = (process.env.BAZE_BASE_URL || 'https://factchat-cloud.mindlogic.ai/v1/gateway').replace(/\/+$/, '');
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.BAZE_API_KEY },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'system', content: system }].concat(messages), max_tokens: 700, temperature: 0.2 })
      });
    } catch (e) { return reply(502, { error: 'BAZE에 연결하지 못했어요' }); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) { return reply(res.status, { error: (data.error && (data.error.message || data.error)) || 'BAZE 오류' }); }
    let text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (Array.isArray(text)) { text = text.map(c => c.text || '').join(''); }
    if (!text) { return reply(502, { error: 'BAZE 응답이 비어 있어요' }); }
    return reply(200, { text, provider: 'baze', model: p.model });
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

  return reply(503, { error: 'AI 키가 설정되지 않았어요. 개발자가 Netlify 환경 변수에 BAZE_API_KEY와 BAZE_MODEL을 넣어 주세요' });
};
