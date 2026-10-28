'use strict';
/* =========================================================
   RegeneCure Journey — client interface
   Access: personal link + 6-digit code on WhatsApp. Read-only protocol,
   interactive dose check-ins and stage confirmations.
   ========================================================= */
const PREVIEW = new URLSearchParams(location.search).has('preview');
APP.mode = PREVIEW ? 'preview' : 'client';
const PATH_M = location.pathname.match(/\/c\/([A-Za-z0-9_-]{16,64})(?:\.([a-z]+))?/) || [];
const TOKEN = PATH_M[1] || '';
const GOTO = PATH_M[2] || '';
if(TOKEN && !new URLSearchParams(location.search).has('preview')) APP.fitlineHref = `/f/${TOKEN}`;   // tracked redirect   // 'fu' → follow-up stage, 'today' → today's doses (links from WhatsApp)
const browserTz = () => { try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){ return ''; } };
const SESSION_KEY = 'regenecure.session.' + TOKEN;
const ADMIN_AUTH_KEY = 'sb-gfdiwphqxyimckoxuqgs-auth-token';
const CL = { view:'loading', step:'start', to:'', minutes:10, error:'', busy:false, cooldown:0 };

function getSession(){ try{ return localStorage.getItem(SESSION_KEY) || ''; }catch(e){ return CL.mem || ''; } }
function setSession(v){ CL.mem = v; try{ if(v) localStorage.setItem(SESSION_KEY, v); else localStorage.removeItem(SESSION_KEY); }catch(e){} }
function adminBearer(){ try{ return JSON.parse(localStorage.getItem(ADMIN_AUTH_KEY) || 'null')?.access_token || ''; }catch(e){ return ''; } }
function hasLangPref(){ try{ return !!localStorage.getItem(LANG_KEY); }catch(e){ return false; } }

class ApiError extends Error{ constructor(status, code, extra){ super(code); this.status = status; this.code = code; this.extra = extra || {}; } }
async function api(action, body){
  const headers = { 'Content-Type':'application/json', 'X-TZ':browserTz() };
  if(PREVIEW) headers['Authorization'] = `Bearer ${adminBearer()}`; else if(getSession()) headers['X-Session'] = getSession();
  const isGet = body === undefined;
  const url = `/api/client/${action}${isGet ? `?token=${encodeURIComponent(TOKEN)}` : ''}`;
  let res;
  try{ res = await fetch(url, { method:isGet ? 'GET' : 'POST', headers, body:isGet ? undefined : JSON.stringify(body) }); }
  catch(e){ throw new ApiError(0, 'network'); }
  let j = null; try{ j = await res.json(); }catch(e){}
  if(!res.ok){ const { error, ...extra } = j || {}; throw new ApiError(res.status, error || 'http_' + res.status, extra); }
  return j;
}

/* ---------- Load ---------- */
async function boot(){
  if(!TOKEN){ CL.view = 'error'; CL.error = t('cl_notFound'); return renderClient(); }
  if(PREVIEW || getSession()) return load();
  CL.view = 'login'; renderClient();
}
async function load(){
  CL.view = 'loading'; renderClient();
  try{
    const r = await api('journey');
    APP.settings.shopUrl = r.settings?.shop_url || DEFAULT_SHOP;
    APP.settings.fitlineUrl = r.settings?.fitline_url || '';
    APP.client = rowToClient(r.client, r.checks);
    if(!hasLangPref()) APP.lang = APP.client.lang;
    ui.stage = null; ui.day = todayISO();
    if(GOTO === 'fu') ui.stage = 4;
    CL.view = 'journey'; renderClient();
    if(GOTO){
      try{ history.replaceState(null, '', `/c/${TOKEN}${location.search}`); }catch(e){}
      setTimeout(() => (GOTO === 'fu' ? $('#attendance') || $('#stagePanel') : $('.today'))?.scrollIntoView({ behavior:'smooth', block:'center' }), 300);
    }
    if(canWrite()) setTimeout(afterChange, 600);
  }catch(e){
    if(e.status === 401 && !PREVIEW){ setSession(''); CL.view = 'login'; CL.step = 'start'; CL.error = ''; return renderClient(); }
    CL.view = 'error'; CL.error = e.status === 404 ? t('cl_notFound') : e.code === 'network' ? t('cl_offline') : t('cl_sendFail');
    renderClient();
  }
}

/* ---------- Login ---------- */
async function requestCode(){
  if(CL.busy) return;
  CL.busy = true; CL.error = ''; renderClient();
  try{
    const r = await api('request-code', { token:TOKEN });
    CL.step = 'code'; CL.to = r.to; CL.minutes = r.minutes || 10; CL.cooldown = Date.now() + 45000;
  }catch(e){
    CL.error = e.status === 404 ? t('cl_notFound') : e.code === 'no_whatsapp' ? t('cl_noWa') : e.code === 'wait' ? t('cl_wait') : e.code === 'too_many_codes' ? t('cl_tooMany') : t('cl_sendFail');
    if(e.code === 'wait' && CL.to) CL.step = 'code';
  }
  CL.busy = false; renderClient();
  if(CL.step === 'code') setTimeout(() => $('#clCode')?.focus(), 30);
}
async function verifyCode(){
  const code = ($('#clCode')?.value || '').replace(/\D/g, '');
  if(code.length !== 6 || CL.busy) return;
  CL.busy = true; CL.error = ''; renderClient();
  try{
    const r = await api('verify', { token:TOKEN, code });
    setSession(r.session); CL.busy = false; return load();
  }catch(e){
    CL.error = e.code === 'wrong_code' ? t('cl_wrong', { n:e.extra.left ?? 0 }) : e.code === 'code_expired' ? t('cl_expired') : e.code === 'too_many_attempts' ? t('cl_tooMany') : e.status === 404 ? t('cl_notFound') : t('cl_sendFail');
  }
  CL.busy = false; renderClient();
  setTimeout(() => $('#clCode')?.focus(), 30);
}
async function logout(){ try{ await api('logout', {}); }catch(e){} setSession(''); APP.client = null; CL.view = 'login'; CL.step = 'start'; renderClient(); }

/* ---------- Render ---------- */
function renderTop(){
  const el = $('#topActions'); if(!el) return;
  el.innerHTML = `<button class="tb-btn" data-action="lang">${APP.lang === 'pt' ? 'EN' : 'PT'}</button>` +
    (CL.view === 'journey' && !PREVIEW ? `<button class="tb-btn" data-action="logout" title="${t('cl_logout')}" aria-label="${t('cl_logout')}">${ic('logout')}</button>` : '');
}
function renderClient(){
  document.documentElement.lang = APP.lang === 'pt' ? 'pt-BR' : 'en';
  renderTop();
  const main = $('#main');
  if(CL.view === 'loading'){ main.innerHTML = `<div class="center-box"><div class="spin"></div><p class="muted">${t('loading')}</p></div>`; return; }
  if(CL.view === 'error'){ main.innerHTML = `<div class="card login"><span class="mono" style="color:var(--bronze)">RegeneCure</span><h2>${esc(CL.error)}</h2><p class="muted" style="font-size:13px">${t('cl_byline')}</p></div>`; return; }
  if(CL.view === 'login'){ main.innerHTML = renderLogin(); return; }
  if(CL.view === 'journey' && C()){
    main.innerHTML = (PREVIEW ? `<div class="alert info no-print" style="margin:0 0 16px">${t('cl_previewBanner')}</div>` : '') + renderJourney(C()) +
      `<p class="muted" style="font-size:12px;text-align:center;margin-top:24px">${t('cl_byline')}</p>`;
  }
}
function renderLogin(){
  const err = CL.error ? `<div class="alert err" style="margin:0 0 12px">${esc(CL.error)}</div>` : '';
  const head = `<span class="mono" style="color:var(--bronze)">RegeneCure</span><h1>${t('cl_title')}</h1>`;
  if(CL.step === 'start'){
    return `<div class="card login">${head}<p class="muted">${t('cl_intro')}</p>${err}
      <button class="btn primary" style="width:100%" data-action="request-code" ${CL.busy ? 'disabled' : ''}>${CL.busy ? `<span class="spin sm"></span>` : ic('send')}${t('cl_send')}</button>
      <p class="muted" style="font-size:12px;margin-top:16px">${t('cl_byline')}</p></div>`;
  }
  return `<form class="card login" id="codeForm">${head}<p class="muted">${t('cl_codeSent', { to:esc(CL.to), m:CL.minutes })}</p>
    <label class="f">${t('cl_code')}<input id="clCode" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••"></label>
    ${err}
    <button class="btn primary" type="submit" style="width:100%" ${CL.busy ? 'disabled' : ''}>${CL.busy ? `<span class="spin sm"></span>` : ''}${t('cl_enter')}</button>
    <p style="text-align:center;margin:14px 0 0"><a href="#" data-action="request-code">${t('cl_resend')}</a></p></form>`;
}

/* ---------- Gamification and writes ---------- */
let progressTimer = null;
function pushProgress(extra){
  if(!canWrite()) return;
  const c = C();
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    const fuConfirm = Object.fromEntries(Object.entries(c.fuConfirm || {}).map(([n, v]) => [n, v.status]));
    api('progress', { confirmed:{ s2:c.confirmed.s2, s3:c.confirmed.s3, s4:c.confirmed.s4 }, seenBadges:c.seenBadges, lastLevel:c.lastLevel, fuConfirm, ...(extra || {}) })
      .catch(() => toast(t('cl_offline'), 'warn'));
  }, 400);
}
function afterChange(){
  const c = C(); if(!c || !canWrite()) return;
  const st = computeStats(c);
  let changed = false;
  st.badges.filter(b => b.on && !c.seenBadges.includes(b.id)).forEach(b => { c.seenBadges.push(b.id); changed = true; toast(t('badgeNew', { b:t('b_' + b.id) }), '', 'award'); });
  if(st.level > c.lastLevel){ c.lastLevel = st.level; changed = true; showLevelUp(st); }
  if(changed) pushProgress();
}
function confirmStage(n, el){
  const c = C(); if(!canWrite() || c.confirmed['s' + n]) return;
  c.confirmed['s' + n] = true; xpFloat(XP.stage, el);
  if(n < 4 && stageState(c, n + 1) === 'active') ui.stage = n + 1;
  renderClient(); pushProgress(); afterChange();
}
async function toggleCheck(key, el){
  const c = C(); if(!canWrite()) return;
  const on = !c.checks[key];
  if(on) c.checks[key] = true; else delete c.checks[key];
  if(on){
    xpFloat(XP.check, el);
    const items = dueItems(c, key.split('|')[0]);
    if(items.every(x => c.checks[x.key])) setTimeout(() => toast(`${t('dayComplete')} · +${XP.fullDay} XP`, '', 'award'), 250);
  }
  renderClient(); afterChange();
  try{ await api('check', { key, on }); }
  catch(e){
    if(on) delete c.checks[key]; else c.checks[key] = true;
    renderClient();
    if(e.status === 401){ setSession(''); CL.view = 'login'; CL.step = 'start'; renderClient(); return; }
    toast(t('cl_offline'), 'warn');
  }
}
function setAttendance(n, v){
  const c = C(); if(!canWrite()) return;
  c.fuConfirm = { ...(c.fuConfirm || {}), [n]:{ status:v, at:new Date().toISOString() } };
  if(v === 'confirmed' && !c.confirmed.s4){ c.confirmed.s4 = true; xpFloat(XP.stage, null); }
  renderClient(); pushProgress(); afterChange();
  toast(v === 'confirmed' ? t('attDoneConfirmed') : t('attDoneReschedule'));
}
/* ---------- Phone notifications (Web Push) ---------- */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
function b64ToBytes(b64){ const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, ch => ch.charCodeAt(0)); }
async function swReg(){ const reg = await navigator.serviceWorker.register('/sw.js', { scope:'/' }); await navigator.serviceWorker.ready; return reg; }
function showIosHelp(){
  openModal(`${modalHead(t('iosTitle'))}<div class="modal-body"><ol class="ios-steps"><li>${t('iosStep1')}</li><li>${t('iosStep2')}</li><li>${t('iosStep3')}</li><li>${t('iosStep4')}</li></ol><p class="note">${t('iosNote')}</p></div><div class="modal-foot"><button class="btn primary" data-action="close">${t('iosOk')}</button></div>`);
}
async function enablePush(hour){
  const c = C();
  if(!pushSupported()){ if(isIOS() && !isStandalone()) showIosHelp(); else toast(t('pushUnsupported'), 'warn'); return; }
  try{
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ toast(t('pushDenied'), 'warn'); return; }
    const reg = await swReg();
    const { publicKey } = await api('push-key');
    let sub = await reg.pushManager.getSubscription();
    if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToBytes(publicKey) });
    const r = await api('push-subscribe', { subscription:sub.toJSON(), hour, tz:browserTz() });
    c.pepAlert = r.pepAlert; renderClient();
    toast(t('pepAlertSaved', { h:pad(c.pepAlert.hour) + ':00' }));
  }catch(e){ console.error(e); toast(t('pushFail'), 'warn'); }
}
async function disablePush(){
  const c = C();
  try{
    if(pushSupported()){ const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription(); if(sub) await sub.unsubscribe(); }
    const r = await api('push-unsubscribe', {});      // switches the reminder off for every device
    c.pepAlert = r.pepAlert; renderClient(); toast(t('pushOff'));
  }catch(e){ toast(t('cl_offline'), 'warn'); }
}
function togglePush(){
  if(!canWrite()) return;
  const pa = C().pepAlert || {};
  if(pa.on && pa.channel === 'push') disablePush(); else enablePush(pa.hour ?? 8);
}
function setPepHour(hour){
  const c = C(); if(!canWrite()) return;
  c.pepAlert = { ...(c.pepAlert || {}), hour };
  if(c.pepAlert.on) api('progress', { pepAlert:{ hour, tz:browserTz() } }).then(() => toast(t('pepAlertSaved', { h:pad(hour) + ':00' }))).catch(() => toast(t('cl_offline'), 'warn'));
  renderClient();
}

async function openReport(){
  try{ const r = await api('report'); window.open(r.url, '_blank', 'noopener'); }
  catch(e){ toast(t('cl_sendFail'), 'warn'); }
}

/* ---------- Events ---------- */
document.addEventListener('submit', e => { if(e.target.id === 'codeForm'){ e.preventDefault(); verifyCode(); } });
document.addEventListener('input', e => { if(e.target.id === 'clCode'){ const v = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = v; if(v.length === 6) verifyCode(); } });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if(!el) return;
  const a = el.dataset.action; const c = C();
  if(a === 'overlay'){ if(e.target === el) closeModal(); return; }
  if(a === 'gcal'){ setTimeout(() => confirmStage(4, null), 300); return; }
  e.preventDefault();
  switch(a){
    case 'lang': setLang(APP.lang === 'pt' ? 'en' : 'pt'); renderClient(); break;
    case 'logout': logout(); break;
    case 'request-code': requestCode(); break;
    case 'close': closeModal(); break;
    case 'stage': ui.stage = +el.dataset.n; renderClient(); break;
    case 'day': { const d = +el.dataset.d; ui.day = d === 0 ? todayISO() : addDays(ui.day, d); renderClient(); break; }
    case 'confirm': confirmStage(+el.dataset.n, el); break;
    case 'check': toggleCheck(el.dataset.key, el); break;
    case 'report-file': openReport(); break;
    case 'att': setAttendance(+el.dataset.n, el.dataset.v); break;
    case 'pep-toggle': togglePush(); break;
    case 'pep-ics': download('regenecure-peptideos.ics', buildPeptideICS(c), 'text/calendar'); break;
    case 'ics': { const n = +el.dataset.n; const f = followupDates(c).find(x => x.n === n); download(`regenecure-followup-${n}.ics`, buildICS(c, [f]), 'text/calendar'); confirmStage(4, null); break; }
    case 'ics-all': { const list = followupDates(c).filter(f => !c.followups[f.n]?.done); download('regenecure-followups.ics', buildICS(c, list), 'text/calendar'); confirmStage(4, null); break; }
  }
});
document.addEventListener('change', e => { if(e.target.dataset.action === 'pep-hour') setPepHour(+e.target.value); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && modalOpen()) closeModal(); });
setInterval(() => { const td = todayISO(); if(ui.lastToday && ui.lastToday !== td){ if(ui.day === ui.lastToday) ui.day = td; renderClient(); } ui.lastToday = td; }, 60000);
ui.lastToday = todayISO();

boot();
