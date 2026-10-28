'use strict';
/* =========================================================
   RegeneCure Journey — practitioner interface
   Supabase Auth (email + password) · client list · report upload and review ·
   publish and send to the client on WhatsApp.
   ========================================================= */
APP.mode = 'admin';
const SB_URL = 'https://gfdiwphqxyimckoxuqgs.supabase.co';
const SB_KEY = 'sb_publishable_OjPZtrgkLAZ_oMuoI_e4ww_h3uT2_G_';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false } });
const EXTRACT_KEY = 'regenecure.extractMode';
try{ const m = localStorage.getItem(EXTRACT_KEY); if(m === 'local' || m === 'server') APP.settings.extractMode = m; }catch(e){}

Object.assign(I18N.pt, { editClient:'Editar dados do cliente', loginUnconfirmed:'E-mail ainda não confirmado no Supabase. Em Authentication → Users, confirme o usuário ou recrie-o com Auto Confirm User.', errAuth:'Sessão expirada ou sem permissão. Entre novamente.' });
Object.assign(I18N.en, { editClient:'Edit client details', loginUnconfirmed:'Email not confirmed in Supabase. In Authentication → Users, confirm the user or recreate it with Auto Confirm User.', errAuth:'Session expired or no permission. Sign in again.' });

const A = { view:'loading', user:null, rows:[], activity:{}, search:'', loginError:'', health:null, tpl:null, busyAction:'' };

/* ---------- Server calls ---------- */
async function accessToken(){ const { data } = await sb.auth.getSession(); return data.session?.access_token || ''; }
class ApiError extends Error{ constructor(code, detail){ super(code); this.code = code; this.detail = detail; } }
async function api(action, body){
  const res = await fetch(`/api/admin/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${await accessToken()}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).catch(() => { throw new ApiError('network'); });
  let j = null; try{ j = await res.json(); }catch(e){}
  if(!res.ok) throw new ApiError(j?.error || ('http_' + res.status), j?.detail);
  return j;
}
function errText(e){
  const code = e?.code || e?.message || 'error';
  const k = 'e_' + code;
  if(I18N.pt[k]) return t(k, { d:e.detail || '' });
  return t('e_generic', { d:code + (e?.detail ? ' · ' + e.detail : '') });
}
const fmtStamp = s => s ? new Date(s).toLocaleString(locale(), { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

/* ---------- Data ---------- */
const LIST_COLS = 'id,name,whatsapp,lang,status,data,progress,journey_start,followup_dates,reminders_sent,published_at,last_sent_at,last_seen_at,created_at,updated_at';
async function loadSettings(){
  const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if(data){ APP.settings.shopUrl = data.shop_url || DEFAULT_SHOP; APP.settings.fitlineUrl = data.fitline_url || ''; APP.settings.autoReminders = data.auto_reminders !== false; APP.settings.peptideAlerts = data.peptide_alerts !== false; }
}
async function saveSettingsRow(patch){
  const { error } = await sb.from('app_settings').update({ ...patch, updated_at:new Date().toISOString() }).eq('id', 1);
  if(error) toast(t('saveErr'), 'warn');
}
async function loadList(){
  const since = addDays(todayISO(), -7), until = todayISO();
  const [list, act] = await Promise.all([
    sb.from('clients').select(LIST_COLS).order('updated_at', { ascending:false }),
    sb.rpc('admin_activity', { since, until })
  ]);
  if(list.error){ toast(t('saveErr'), 'warn'); return; }
  A.rows = list.data || [];
  A.activity = Object.fromEntries((act.data || []).map(r => [r.client_id, r]));
}
async function fetchChecks(id){
  const out = [];
  for(let from = 0; ; from += 1000){
    const { data, error } = await sb.from('dose_logs').select('dose_key').eq('client_id', id).order('dose_key').range(from, from + 999);
    if(error) throw error;
    out.push(...data.map(r => r.dose_key));
    if(data.length < 1000) return out;
  }
}
async function loadClient(id){
  const { data, error } = await sb.from('clients').select('*').eq('id', id).maybeSingle();
  if(error || !data) return null;
  return rowToClient(data, await fetchChecks(id));
}
let saveChain = Promise.resolve();
function persist(){
  const c = C(); if(!c) return Promise.resolve();
  const row = clientToRow(c);
  saveChain = saveChain.then(async () => {
    const { error } = await sb.from('clients').update(row).eq('id', c.id);
    if(error){ console.error(error); toast(t('saveErr'), 'warn'); }
  });
  return saveChain;
}
async function refreshClientMeta(){
  const c = C(); if(!c) return;
  const { data } = await sb.from('clients').select('status,access_token,published_at,last_sent_at,last_seen_at,reminders_sent').eq('id', c.id).maybeSingle();
  if(data){ c.status = data.status; c.accessToken = data.access_token; c.publishedAt = data.published_at; c.lastSentAt = data.last_sent_at; c.lastSeenAt = data.last_seen_at; c.remindersSent = data.reminders_sent || []; }
}

/* ---------- Routing ---------- */
async function route(){
  if(!A.user) return;
  const m = /^#\/c\/([0-9a-f-]{36})/i.exec(location.hash);
  if(m){
    if(C()?.id !== m[1]){
      A.view = 'loading'; renderAdmin();
      const c = await loadClient(m[1]);
      if(!c){ location.hash = '#/'; return; }
      APP.client = c; ui.stage = null; ui.day = todayISO(); ui.error = null;
    }
    A.view = 'detail';
  } else {
    APP.client = null; A.view = 'loading'; renderAdmin();
    await loadList(); A.view = 'list';
  }
  renderAdmin();
}
window.addEventListener('hashchange', route);

/* ---------- Auth ---------- */
async function boot(){
  const { data } = await sb.auth.getSession();
  if(!data.session){ A.view = 'login'; renderAdmin(); return; }
  await afterLogin(data.session.user);
}
async function afterLogin(user){
  A.user = user;
  const { data:ok, error } = await sb.rpc('claim_first_admin');
  if(error || !ok){ A.view = 'denied'; renderAdmin(); return; }
  await loadSettings();
  await route();
}
async function signIn(){
  const email = $('#lgEmail').value.trim(), password = $('#lgPass').value;
  if(!email || !password) return;
  A.lastEmail = email; A.loginError = ''; A.busyAction = 'login'; renderAdmin();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  A.busyAction = '';
  if(error){
    const msg = String(error.message || '');
    A.loginError = /not confirmed/i.test(msg) || error.code === 'email_not_confirmed' ? t('loginUnconfirmed')
      : /invalid login credentials/i.test(msg) || error.code === 'invalid_credentials' ? t('loginErr')
      : `${t('loginErr')} (${msg || error.status || 'erro'})`;
    renderAdmin(); return;
  }
  await afterLogin(data.user);
}
async function signOut(){ await sb.auth.signOut(); A.user = null; APP.client = null; A.view = 'login'; location.hash = ''; renderAdmin(); }

/* ---------- Render ---------- */
function renderTop(){
  const el = $('#topActions'); if(!el) return;
  el.innerHTML = `<button class="tb-btn" data-action="lang">${APP.lang === 'pt' ? 'EN' : 'PT'}</button>` + (A.user && A.view !== 'denied' ? `
    <button class="tb-btn" data-action="settings" aria-label="${t('settings')}">${ic('edit')}<span>${t('settings')}</span></button>
    <button class="tb-btn" data-action="logout" aria-label="${t('signOut')}">${ic('logout')}</button>` : '');
}
function renderAdmin(){
  document.documentElement.lang = APP.lang === 'pt' ? 'pt-BR' : 'en';
  renderTop();
  const main = $('#main');
  if(A.view === 'loading'){ main.innerHTML = `<div class="center-box"><div class="spin"></div><p class="muted">${t('loading')}</p></div>`; return; }
  if(A.view === 'login'){ main.innerHTML = renderLogin(); setTimeout(() => (A.lastEmail ? $('#lgPass') : $('#lgEmail'))?.focus(), 30); return; }
  if(A.view === 'denied'){ main.innerHTML = `<div class="card login"><h2>${t('notAdmin')}</h2><p class="muted">${esc(A.user?.email || '')}</p><button class="btn" data-action="logout">${ic('logout')}${t('signOut')}</button></div>`; return; }
  if(A.view === 'list'){ main.innerHTML = renderList(); return; }
  if(A.view === 'detail' && C()){ main.innerHTML = renderAdminBar(C()) + renderJourney(C()); bindDrop(); }
}
function renderLogin(){
  return `<form class="card login" id="loginForm" autocomplete="on">
    <span class="mono" style="color:var(--bronze)">RegeneCure · Client Journey</span>
    <h1>${t('loginTitle')}</h1>
    <label class="f">${t('email')}<input id="lgEmail" type="email" autocomplete="username" value="${esc(A.lastEmail || '')}" required></label>
    <label class="f">${t('password')}<input id="lgPass" type="password" autocomplete="current-password" required></label>
    ${A.loginError ? `<div class="alert err" style="margin:0 0 12px">${esc(A.loginError)}</div>` : ''}
    <button class="btn primary" type="submit" style="width:100%" ${A.busyAction === 'login' ? 'disabled' : ''}>${t('signIn')}</button>
  </form>`;
}

function listStats(row){
  const c = rowToClient(row, []);
  const td = todayISO();
  let day = null, adh = null;
  if(c.journeyStart && c.confirmed.s1){
    day = diffDays(td, c.journeyStart) + 1;
    let due = 0;
    for(let d = addDays(td, -7); d < td; d = addDays(d, 1)) if(d >= c.journeyStart) due += dueItems(c, d).length;
    const logs = A.activity[row.id]?.logs || 0;
    if(due) adh = Math.min(100, Math.round(logs / due * 100));
  }
  const nf = c.confirmed.s1 && c.journeyStart ? nextFollowup(c) : null;
  return { c, day, adh, nf };
}
function renderList(){
  const q = A.search.trim().toLowerCase();
  const rows = A.rows.filter(r => !q || (r.name || '').toLowerCase().includes(q) || (r.whatsapp || '').includes(q));
  const td = todayISO();
  const body = rows.map(r => {
    const { c, day, adh, nf } = listStats(r);
    const nfTxt = nf ? `${fmtShort(nf.date)} <span class="muted">· ${diffDays(nf.date, td) >= 0 ? t('inDays', { n:diffDays(nf.date, td) }) : t('overdue', { n:-diffDays(nf.date, td) })}</span>${attendanceChip(c, nf.n) ? '<br>' + attendanceChip(c, nf.n) : ''}` : '—';
    const adhCls = adh === null ? '' : adh >= 80 ? 'normal' : adh >= 50 ? 'tbd' : 'high';
    return `<tr class="click" data-action="open-client" data-id="${r.id}">
      <td><b>${esc(r.name)}</b><div class="muted" style="font-size:12px">${esc(r.whatsapp || '—')} · ${r.lang.toUpperCase()}</div></td>
      <td><span class="chip st-${r.status}">${t('st_' + r.status)}</span></td>
      <td>${day === null ? '—' : day > 0 ? t('dayN', { n:day }) : t('startsIn', { n:1 - day })}</td>
      <td>${adh === null ? '—' : `<span class="chip ${adhCls}">${adh}%</span>`}</td>
      <td>${nfTxt}</td>
      <td class="muted">${r.last_seen_at ? fmtStamp(r.last_seen_at) : t('never')}</td>
    </tr>`;
  }).join('');
  return `<div class="list-head">
      <div><span class="mono" style="color:var(--bronze)">RegeneCure</span><h1>${t('clients')} <span class="muted" style="font-weight:400">(${A.rows.length})</span></h1></div>
      <div class="row"><label class="searchbox">${ic('search')}<input id="search" value="${esc(A.search)}" placeholder="${t('search')}" autocomplete="off"></label>
      <button class="btn primary" data-action="new-client">${ic('plus')}${t('newClient')}</button></div>
    </div>
    ${A.rows.length ? `<div class="card"><div class="tbl-wrap" style="border:0"><table class="clients"><thead><tr><th>${t('colClient')}</th><th>${t('colStatus')}</th><th>${t('colDay')}</th><th>${t('colAdh')}</th><th>${t('colNext')}</th><th>${t('colSeen')}</th></tr></thead><tbody>${body}</tbody></table></div></div>`
      : `<div class="card welcome"><h2>${t('noClients')}</h2><div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-action="new-client">${ic('plus')}${t('createClient')}</button></div></div>`}`;
}

function renderAdminBar(c){
  const draft = c.status !== 'published';
  const blockers = [];
  if(!c.confirmed.s1) blockers.push(t('needReviewFirst'));
  if(!waDigits(c.patient.whatsapp)) blockers.push(t('needWa'));
  const can = !blockers.length;
  const busy = A.busyAction;
  const meta = [
    c.publishedAt ? t('publishedOn', { d:fmtStamp(c.publishedAt) }) : '',
    c.lastSentAt ? t('lastSentOn', { d:fmtStamp(c.lastSentAt) }) : '',
    c.status === 'published' ? (c.lastSeenAt ? t('lastSeenOn', { d:fmtStamp(c.lastSeenAt) }) : t('notSeen')) : ''
  ].filter(Boolean).join(' · ');
  return `<div class="card admin-bar no-print">
    <div class="ab-left"><a class="btn sm ghost" href="#/">${ic('left')}${t('backList')}</a><span class="chip st-${c.status}">${t('st_' + c.status)}</span><span class="muted" style="font-size:12.5px">${esc(meta)}</span></div>
    <div class="row">
      <button class="btn sm primary" data-action="send-journey" ${can && !busy ? '' : 'disabled'} title="${esc(blockers.join(' '))}">${ic('send')}${draft ? t('publishSend') : t('resend')}</button>
      <button class="btn sm" data-action="copy-link">${ic('copy')}${t('copyClientLink')}</button>
      <button class="btn sm" data-action="preview">${ic('eye')}${t('previewClient')}</button>
      <details class="menu"><summary class="btn sm" aria-label="more">•••</summary><div class="menu-pop">
        ${draft ? `<button data-action="publish-only" ${c.confirmed.s1 ? '' : 'disabled'}>${t('publishOnly')}</button>` : `<button data-action="unpublish">${t('unpublish')}</button>`}
        <button data-action="editor">${ic('edit')}${t('editClient')}</button>
        <button data-action="rotate">${ic('refresh')}${t('rotate')}</button>
        <button data-action="delete-client" class="danger">${ic('trash')}${t('deleteClient')}</button>
      </div></details>
    </div>
  </div>${blockers.length && c.report ? `<div class="alert warn no-print" style="margin:0 0 16px">${blockers.map(esc).join('<br>')}</div>` : ''}`;
}
const clientLink = c => `${location.origin}/c/${c.accessToken}`;

/* ---------- Actions ---------- */
async function sendJourney(){
  const c = C(); if(!c) return;
  A.busyAction = 'send'; renderAdmin();
  try{ await persist(); await api('send', { client_id:c.id, kind:'journey' }); toast(t('sentOk')); await refreshClientMeta(); }
  catch(e){ toast(errText(e), 'warn'); }
  A.busyAction = ''; renderAdmin();
}
async function sendFollowupReminder(n){
  const c = C(); if(!c) return;
  try{ await persist(); await api('send', { client_id:c.id, kind:'followup', n }); toast(t('sentOk')); await refreshClientMeta(); renderAdmin(); }
  catch(e){ toast(errText(e), 'warn'); }
}
async function setStatus(status){
  const c = C(); if(!c) return;
  const patch = { status };
  if(status === 'published' && !c.publishedAt) patch.published_at = new Date().toISOString();
  const { error } = await sb.from('clients').update(patch).eq('id', c.id);
  if(error){ toast(t('saveErr'), 'warn'); return; }
  await refreshClientMeta(); renderAdmin();
}
async function rotateLink(){
  const c = C(); if(!c || !confirm(t('rotateConfirm'))) return;
  try{ const r = await api('rotate-link', { client_id:c.id }); c.accessToken = r.access_token; renderAdmin(); copyText(clientLink(c), t('linkCopied')); }
  catch(e){ toast(errText(e), 'warn'); }
}
async function deleteClient(){
  const c = C(); if(!c || !confirm(t('confirmDelete'))) return;
  try{
    const { data:files } = await sb.storage.from('reports').list(c.id);
    if(files?.length) await sb.storage.from('reports').remove(files.map(f => `${c.id}/${f.name}`));
  }catch(e){}
  const { error } = await sb.from('clients').delete().eq('id', c.id);
  if(error){ toast(t('saveErr'), 'warn'); return; }
  APP.client = null; location.hash = '#/';
}
async function openReportFile(){
  const c = C(); const paths = c?.report?.storagePaths || [];
  if(!paths.length) return;
  const { data, error } = await sb.storage.from('reports').createSignedUrl(paths[paths.length - 1], 600);
  if(error || !data?.signedUrl){ toast(t('saveErr'), 'warn'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}
function copyText(txt, okMsg){
  const done = () => toast(okMsg || t('copied'));
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done)); else fallbackCopy(txt, done);
}

function openNewClient(){
  openModal(`${modalHead(t('newClientTitle'))}<div class="modal-body">
    <label class="f">${t('clientName')}<input id="ncName" autocomplete="off"></label>
    <label class="f">${t('whatsappNum')}<input id="ncWa" type="tel" placeholder="${t('waPh')}" autocomplete="off"></label>
    <label class="f">${t('clientLang')}<select id="ncLang"><option value="pt" ${APP.lang === 'pt' ? 'selected' : ''}>Português</option><option value="en" ${APP.lang === 'en' ? 'selected' : ''}>English</option></select></label>
  </div><div class="modal-foot"><button class="btn" data-action="close">${t('cancel')}</button><button class="btn primary" data-action="create-client">${t('create')}</button></div>`);
  setTimeout(() => $('#ncName')?.focus(), 30);
}
async function createNewClient(){
  const n = $('#ncName').value.trim(); if(!n){ $('#ncName').focus(); return; }
  const w = $('#ncWa').value.trim(); if(w && !waDigits(w)){ toast(t('waInvalid'), 'warn'); $('#ncWa').focus(); return; }
  const { data, error } = await sb.from('clients').insert({ name:n, whatsapp:w || null, lang:$('#ncLang').value, data:{ followUpTime:'10:00' } }).select('id').single();
  if(error){ toast(t('saveErr'), 'warn'); return; }
  closeModal(); location.hash = `#/c/${data.id}`;
}

async function openSettings(){
  const s = APP.settings;
  const opt = (m, label, desc) => `<label class="${s.extractMode === m ? 'on' : ''}"><input type="radio" name="mode" value="${m}" ${s.extractMode === m ? 'checked' : ''} data-action="set-mode"><span><b>${label}</b><small>${desc}</small></span></label>`;
  openModal(`${modalHead(t('settingsTitle'))}<div class="modal-body">
    <h3 style="margin-bottom:10px">${t('setupStatus')}</h3><div id="healthBox" class="muted" style="font-size:13px">${t('loading')}</div>
    <h3 style="margin:18px 0 10px">${t('extractionMode')}</h3>
    <div class="radio">${opt('server', t('modeServer'), t('mServerD'))}${opt('local', t('modeLocal'), t('mLocalD'))}</div>
    <h3 style="margin:18px 0 10px">${t('links')}</h3>
    <label class="f">${t('shopUrlL')}<input id="setShop" value="${esc(shopUrl())}" placeholder="${DEFAULT_SHOP}"></label>
    <label class="f">${t('fitlineUrlL')}<input id="setFitline" value="${esc(fitlineUrl())}" placeholder="https://"></label>
    <label class="checkrow"><input type="checkbox" id="setAuto" ${s.autoReminders ? 'checked' : ''}> ${t('autoReminders')}</label>
    <label class="checkrow"><input type="checkbox" id="setPep" ${s.peptideAlerts !== false ? 'checked' : ''}> ${t('peptideAlertsGlobal')}</label>
    <h3 style="margin:18px 0 6px">${t('waTemplates')}</h3><p class="note" style="margin-top:0">${t('templatesHint')}</p>
    <div class="row"><button class="btn sm" data-action="tpl-create">${ic('plus')}${t('createTemplates')}</button><button class="btn sm" data-action="tpl-status">${ic('refresh')}${t('checkTemplates')}</button></div>
    <div id="tplBox" style="margin-top:10px"></div>
    <h3 style="margin:18px 0 10px">${t('data')}</h3>
    <div class="row"><button class="btn sm" data-action="import">${ic('upload')}${t('importOld')}</button></div>
  </div><div class="modal-foot"><button class="btn primary" data-action="save-settings">${t('save')}</button></div>`);
  try{
    const h = await api('health'); A.health = h;
    const row = (ok, label) => `<div class="hrow"><span class="chip ${ok ? 'normal' : 'tbd'}">${ok ? t('ok') : t('missing')}</span> ${label}</div>`;
    const box = $('#healthBox');
    if(box) box.innerHTML = row(h.supabase_secret, 'SUPABASE_SECRET_KEY') + row(h.anthropic, 'ANTHROPIC_API_KEY') + row(h.kapso_key, 'KAPSO_API_KEY') + row(h.kapso_waba, 'KAPSO_WABA_ID') + row(h.kapso_webhook, 'KAPSO_WEBHOOK_SECRET') + `<div class="hrow muted">APP_URL: ${esc(h.app_url)} · Phone ID: ${esc(h.kapso_phone)}</div>`;
  }catch(e){ const box = $('#healthBox'); if(box) box.innerHTML = `<span class="chip high">${esc(errText(e))}</span>`; }
}
async function saveSettings(){
  const m = document.querySelector('input[name=mode]:checked'); if(m){ APP.settings.extractMode = m.value; try{ localStorage.setItem(EXTRACT_KEY, m.value); }catch(e){} }
  const shop = normUrl($('#setShop')?.value) || DEFAULT_SHOP, fl = normUrl($('#setFitline')?.value), auto = !!$('#setAuto')?.checked, pep = !!$('#setPep')?.checked;
  APP.settings.shopUrl = shop; APP.settings.fitlineUrl = fl; APP.settings.autoReminders = auto; APP.settings.peptideAlerts = pep;
  await saveSettingsRow({ shop_url:shop, fitline_url:fl || null, auto_reminders:auto, peptide_alerts:pep });
  closeModal(); renderAdmin();
}
async function templatesAction(kind){
  const box = $('#tplBox'); if(box) box.innerHTML = `<div class="spin" style="width:18px;height:18px;border-width:2px"></div>`;
  try{
    const r = kind === 'create' ? await api('templates-create', {}) : await api('templates-status');
    const list = r.results || r.templates || [];
    const chip = s => { const v = String(s || '').toUpperCase(); return `<span class="chip ${v === 'APPROVED' ? 'normal' : v === 'REJECTED' ? 'high' : 'tbd'}">${esc(v || '—')}</span>`; };
    if(box) box.innerHTML = list.length ? list.map(x => `<div class="hrow">${x.ok === false ? `<span class="chip high">ERRO</span>` : chip(x.status)} <b>${esc(x.name)}</b> · ${esc(x.language)}${x.error ? ` <span class="muted">— ${esc(x.error)}</span>` : ''}</div>`).join('') : `<span class="muted">—</span>`;
  }catch(e){ if(box) box.innerHTML = `<span class="chip high">${esc(errText(e))}</span>`; }
}
async function importBackup(file){
  try{
    const d = JSON.parse(await file.text());
    const list = Object.values(d?.clients || {});
    if(!list.length) throw new Error('empty');
    const rows = list.map(old => {
      const c = { lang:APP.lang, patient:{ name:'', dob:'', sex:'', patientId:'', whatsapp:'', ...(old.patient || {}) }, report:old.report || null, journeyStart:old.journeyStart || '',
        biomarkers:old.biomarkers || [], supplements:old.supplements || [], peptides:old.peptides || [], followUpNotes:old.followUpNotes || '',
        confirmed:{ s1:!!old.confirmed?.s1 }, followups:old.followups || {}, followUpTime:old.followUpTime || '10:00', fitline:{} };
      if(c.patient.whatsapp && !waDigits(c.patient.whatsapp)) c.patient.whatsapp = '';
      return clientToRow(c);
    });
    const { error } = await sb.from('clients').insert(rows);
    if(error) throw error;
    closeModal(); toast(t('importedN', { n:rows.length })); location.hash = '#/'; await route();
  }catch(e){ toast('JSON inválido / invalid JSON', 'warn'); }
}

/* ---------- Extraction ---------- */
function mediaTypeOf(f){
  const n = f.name.toLowerCase();
  if(f.type === 'application/pdf' || n.endsWith('.pdf')) return 'application/pdf';
  if(/\.(jpe?g)$/.test(n) || f.type === 'image/jpeg') return 'image/jpeg';
  if(n.endsWith('.png') || f.type === 'image/png') return 'image/png';
  if(n.endsWith('.webp') || f.type === 'image/webp') return 'image/webp';
  if(n.endsWith('.txt') || f.type === 'text/plain') return 'text/plain';
  return '';
}
const fileToB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
function setProgress(txt){ ui.progress = txt; const el = $('#progressText'); if(el) el.textContent = txt; }
class ExtractError extends Error{ constructor(kind, msg){ super(msg); this.kind = kind; } }

async function readStream(resp){
  const reader = resp.body.getReader(); const dec = new TextDecoder();
  let buf = '', json = '', err = null, stop = null;
  for(;;){
    const {value, done} = await reader.read(); if(done) break;
    buf += dec.decode(value, {stream:true}).replace(/\r\n/g, '\n');
    let i;
    while((i = buf.indexOf('\n\n')) >= 0){
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if(!data) continue; let ev; try{ ev = JSON.parse(data); }catch(e){ continue; }
      if(ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta'){ json += ev.delta.partial_json; setProgress(`${t('extracting')} · ${json.length} ${t('chars')}`); }
      else if(ev.type === 'message_delta') stop = ev.delta?.stop_reason;
      else if(ev.type === 'error') err = ev.error?.message || 'stream error';
    }
  }
  if(err) throw new ExtractError('generic', t('errGeneric', {s:err}));
  if(stop === 'max_tokens') throw new ExtractError('generic', t('errTrunc'));
  if(!json) throw new ExtractError('generic', t('errEmpty'));
  try{ return JSON.parse(json); }catch(e){ throw new ExtractError('generic', t('errTrunc')); }
}

async function aiExtract(file){
  const mt = mediaTypeOf(file); if(!mt) throw new ExtractError('type', t('errType'));
  setProgress(t('reading')); const b64 = await fileToB64(file);
  setProgress(t('sending'));
  let resp;
  try{ resp = await fetch('/api/extract', { method:'POST', headers:{'Content-Type':'text/plain', 'X-Media-Type':mt, 'Authorization':`Bearer ${await accessToken()}`, 'X-Today':todayISO()}, body:b64 }); }
  catch(e){ throw new ExtractError('nofn', t('errNoFunction')); }
  if(!resp.ok){
    let detail = ''; try{ detail = await resp.text(); }catch(e){}
    if(true){
      if(resp.status === 404) throw new ExtractError('nofn', t('errNoFunction'));
      if(resp.status === 401 || resp.status === 403) throw new ExtractError('auth', t('errAuth'));
      if(detail.includes('missing_supabase_secret')) throw new ExtractError('key', t('e_missing_supabase_secret'));
      if(resp.status === 413) throw new ExtractError('size', t('errSize'));
      if(resp.status === 415) throw new ExtractError('type', t('errType'));
      if(resp.status === 500 && detail.includes('missing_api_key')) throw new ExtractError('key', t('errNoKey'));
    }
    let msg = resp.status; try{ const j = JSON.parse(detail); msg = `${resp.status} · ${j.error?.message || j.detail || j.error || ''}`.slice(0, 220); }catch(e){}
    throw new ExtractError('generic', t('errGeneric', {s:msg}));
  }
  return await readStream(resp);
}

/* ---------- Local (no-AI) extraction ---------- */
let pdfjsReady = null;
function loadPdfJs(){
  if(pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => { pdfjsReady = null; rej(new Error('pdf.js')); }; document.head.appendChild(s);
  });
  return pdfjsReady;
}
async function pdfToLines(file){
  const lib = await loadPdfJs(); const doc = await lib.getDocument({data:await file.arrayBuffer()}).promise; const lines = [];
  for(let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p); const tc = await page.getTextContent(); const rows = new Map();
    tc.items.forEach(it => { if(!it.str || !it.str.trim()) return; const y = Math.round(it.transform[5] / 3) * 3; if(!rows.has(y)) rows.set(y, []); rows.get(y).push({x:it.transform[4], s:it.str}); });
    [...rows.keys()].sort((a,b) => b - a).forEach(y => lines.push(rows.get(y).sort((a,b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g,' ').trim()));
  }
  return lines;
}
const PEPTIDE_NAMES = ['BPC-157','TB-500','Thymosin Beta-4','Thymosin Alpha-1','TA-1','Ipamorelin','CJC-1295','Tesamorelin','Sermorelin','Semaglutide','Tirzepatide','Retatrutide','Cagrilintide','Liraglutide','Survodutide','Mazdutide','GHK-Cu','Epitalon','Epithalon','MOTS-c','SS-31','Elamipretide','Selank','Semax','PT-141','Bremelanotide','KPV','AOD-9604','NAD+','Kisspeptin','DSIP','LL-37','Humanin','Pinealon','Thymalin','Hexarelin','GHRP-2','GHRP-6','MK-677','Dihexa','Cerebrolysin','Oxytocin','Follistatin','IGF-1 LR3','5-Amino-1MQ','Glutathione','VIP','FOXO4-DRI','Larazotide','ARA-290','Gonadorelin','HCG'];
const PEP_RE = PEPTIDE_NAMES.map(n => ({n, re:new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[-\s]/g,'[-\\s]?') + '(?![a-z0-9])', 'i')}));
const SUPP_HINT = /(vitamin|vitamina|omega|ômega|magn[eé]si|zinc|zinco|creatin|coq10|ubiquinol|\bnac\b|n-acetil|n-acetyl|b12|b-?complex|complexo b|folat|metilfolato|iron|ferro|selen|probi[oó]tic|curcumin|berberin|resveratrol|quercetin|collagen|colágeno|ashwagandha|melatonin|glicina|glycine|taurin|l-?theanin|psyllium|fish oil|óleo de peixe|k2|d3|biotin|iodo|iodine|astaxant|spermidin|espermidina|urolithin|pqq|tmg|betaína|betaine|ala\b|alpha-lipoic|ácido alfa)/i;
const DOSE_RE = /(\d+(?:[.,]\d+)?\s*(?:mcg|µg|μg|mg|g\b|iu\b|ui\b|ml\b|units?\b|unidades|caps?\b|cápsulas?|capsules?|tabs?\b|comprimidos?|drops|gotas|scoops?|softgels?|ui)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:mcg|mg|iu|ui))?)/i;
const DATE_RE = /(\d{4}-\d{2}-\d{2})|(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/g;
function parseDates(s){
  const out = []; let m; DATE_RE.lastIndex = 0;
  while((m = DATE_RE.exec(s))){
    if(m[1]){ out.push(m[1]); continue; }
    let a = +m[2], b = +m[3], y = +m[4]; if(y < 100) y += 2000;
    let dd = a, mm = b; if(b > 12 && a <= 12){ dd = b; mm = a; }
    if(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.push(`${y}-${pad(mm)}-${pad(dd)}`);
  }
  return out;
}
function localParse(lines){
  const d = {patient:{}, report:{}, biomarkers:[], supplements:[], peptides:[], journey_start_date:null};
  const text = lines.join('\n');
  const nm = /(?:patient|paciente|client|cliente|nome|name)\s*[:\-]\s*([^\n]{3,60})/i.exec(text); if(nm) d.patient.name = nm[1].replace(/\s{2,}.*/,'').trim();
  const rd = /(?:report date|date of report|data do laudo|data de emissão|collected|coleta|collection date|data)\s*[:\-]?\s*([0-9\/.\-]{8,10})/i.exec(text); if(rd){ const ds = parseDates(rd[1]); if(ds[0]) d.report.report_date = ds[0]; }
  const sd = /(?:start date|protocol start|início do protocolo|inicio do protocolo|data de início|data de inicio|início|start)\s*[:\-]?\s*([0-9\/.\-]{8,10})/i.exec(text); if(sd){ const ds = parseDates(sd[1]); if(ds[0]) d.journey_start_date = ds[0]; }
  const lab = /(?:laborat[oó]rio|laboratory|lab)\s*[:\-]\s*([^\n]{3,60})/i.exec(text); if(lab) d.report.laboratory = lab[1].trim();
  let section = '';
  const seen = new Set();
  lines.forEach((ln, idx) => {
    const low = ln.toLowerCase();
    if(ln.length < 45){
      if(/pept[ií]d/.test(low)) { section = 'pep'; return; }
      if(/(suplement|supplement|nutrac)/.test(low)) { section = 'supp'; return; }
      if(/(resultado|result|biomar|exames|hemograma|blood|laborat|parâmetro|parameter|análises|analysis)/.test(low)) { section = 'bio'; return; }
      if(/(follow|retorno|observa|notes|recomenda|dieta|diet|exerc)/.test(low) && !DOSE_RE.test(ln)) { section = 'other'; }
    }
    const pm = PEP_RE.find(p => p.re.test(ln));
    if(pm && (DOSE_RE.test(ln) || section === 'pep')){
      const nx = lines[idx+1] || ''; const cont = nx && nx.length < 90 && !nx.includes(':') && !DOSE_RE.test(nx) && !PEP_RE.some(p => p.re.test(nx)) && !/pept|suplem|supplem|result/i.test(nx);
      const ctx = ln + (cont ? ' ' + nx : '');
      const dm = DOSE_RE.exec(ln); const dose = dm ? dm[1] : ((DOSE_RE.exec(ctx) || [])[1] || '');
      let pname = dm ? ln.slice(0, dm.index).replace(/^[\s•\-–*\d.)]+/,'').replace(/[:\-–|]+$/,'').trim() : '';
      if(!pname || !PEP_RE.some(p => p.re.test(pname)) || pname.length > 60) pname = pm.n;
      const key = pname.toLowerCase(); if(seen.has('p'+key)) return; seen.add('p'+key);
      const rest = dm ? ctx.slice(dm.index + dm[0].length).trim() : '';
      const dates = parseDates(ctx);
      const wk = /(\d+)\s*(?:weeks|week|semanas|semana|wks|sem\b)/i.exec(ctx); const dy = /(\d+)\s*(?:days|dias)(?!\s*(?:on|off|\/))/i.exec(ctx);
      const rel = /(?:weeks?|semanas?|sem)\s*(\d+)\s*(?:-|–|a|to|até)\s*(\d+)/i.exec(ctx);
      const freqM = /(daily|diário|diariamente|1x\s*ao dia|\d\s*x\s*(?:\/|por|per|a)\s*(?:semana|week|dia|day)|\d\s*(?:on|dias on)\s*[\/,]?\s*\d\s*off|every other day|dias alternados|weekly|semanal|twice (?:a )?(?:week|daily)|(?:2|3|5)x\s*(?:week|semana)|a cada \d+ dias|every \d+ days)/i.exec(ctx);
      const routeM = /(subcut\w*|subq|\bsc\b|s\.c\.|intramus\w*|\bim\b|oral|sublingual|nasal|intranasal|t[oó]pic\w*)/i.exec(ctx);
      const pep = { name:pname, dose, route:routeM ? routeM[1] : null, frequency:freqM ? freqM[1] : null, instructions:rest && rest.length < 160 ? rest : null };
      if(dates[0]) pep.start_date = dates[0]; if(dates[1]) pep.end_date = dates[1];
      if(rel){ pep.start_offset_days = (+rel[1]-1)*7; pep.cycle_length_days = (+rel[2] - +rel[1] + 1)*7; }
      else if(wk) pep.cycle_length_days = +wk[1]*7; else if(dy) pep.cycle_length_days = +dy[1];
      d.peptides.push(pep); return;
    }
    if(!pm && DOSE_RE.test(ln) && (section === 'supp' || SUPP_HINT.test(ln)) && section !== 'bio'){
      const dm = DOSE_RE.exec(ln); let name = ln.slice(0, dm.index).replace(/^[\s•\-–*\d.)]+/,'').replace(/[:\-–|]+$/,'').trim();
      if(!name || name.length < 2) name = ln.replace(dm[0],'').replace(/^[\s•\-–*\d.)]+/,'').split(/[,;–\-]/)[0].trim();
      if(!name || name.length > 60 || seen.has('s'+name.toLowerCase())) return; seen.add('s'+name.toLowerCase());
      const rest = ln.slice(dm.index + dm[0].length).trim().replace(/^[\s,;–\-|]+/,'');
      const dur = /(\d+)\s*(?:days|dias)/i.exec(rest) || null; const wk = /(\d+)\s*(?:weeks|semanas)/i.exec(rest);
      d.supplements.push({ name, dose:dm[1], frequency:rest || null, instructions:null, duration_days: wk ? +wk[1]*7 : dur ? +dur[1] : null });
      return;
    }
    const bm = /^([A-Za-zÀ-ÿ0-9 ()\/.,%+\-]{2,48}?)\s*[:\s]\s*([<>]?\s*\d+(?:[.,]\d+)?)\s*([A-Za-zµμ%\/·^0-9.]*(?:\/[A-Za-zµμ]+)?)?\s+(?:\(?\s*(?:ref\.?|reference|referência|vr|valor de referência)?[:\s]*)?((?:[<>≤≥]\s*\d+(?:[.,]\d+)?)|(?:\d+(?:[.,]\d+)?\s*(?:-|–|a|to)\s*\d+(?:[.,]\d+)?))/i.exec(ln);
    if(bm && (section === 'bio' || section === '') && (section === 'bio' || !SUPP_HINT.test(bm[1])) && !/(date|data|page|página|tel|phone|cpf|id\b)/i.test(bm[1])){
      const name = bm[1].trim(); if(seen.has('b'+name.toLowerCase())) return; seen.add('b'+name.toLowerCase());
      const val = parseFloat(bm[2].replace(/[<>\s]/g,'').replace(',','.')); const ref = bm[4].replace(/\s+/g,' ');
      let status = 'unknown'; const rr = /(\d+(?:[.,]\d+)?)\s*(?:-|–|a|to)\s*(\d+(?:[.,]\d+)?)/.exec(ref);
      if(rr){ const lo = parseFloat(rr[1].replace(',','.')), hi = parseFloat(rr[2].replace(',','.')); status = val < lo ? 'low' : val > hi ? 'high' : 'normal'; }
      else { const one = /([<>≤≥])\s*(\d+(?:[.,]\d+)?)/.exec(ref); if(one){ const lim = parseFloat(one[2].replace(',','.')); status = /[<≤]/.test(one[1]) ? (val > lim ? 'high' : 'normal') : (val < lim ? 'low' : 'normal'); } }
      d.biomarkers.push({ name, value:bm[2].replace(/\s/g,''), unit:bm[3]||'', reference_range:ref, status });
    }
  });
  return d;
}
async function localExtract(file){
  const mt = mediaTypeOf(file);
  if(mt !== 'application/pdf' && mt !== 'text/plain') throw new ExtractError('type', t('errLocalImg'));
  setProgress(t('reading'));
  const lines = mt === 'text/plain' ? (await file.text()).split(/\r?\n/).map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean) : await pdfToLines(file);
  setProgress(t('parsing'));
  const d = localParse(lines);
  if(!d.biomarkers.length && !d.supplements.length && !d.peptides.length) throw new ExtractError('generic', t('errEmpty'));
  return d;
}

/* ---------- Upload flow ---------- */
let pickMode = 'replace', lastFile = null;
async function handleFile(file, mode, forceLocal){
  const c = C(); if(!c || !file) return;
  ui.error = null; ui.errorKind = null;
  if(file.size > MAX_FILE){ ui.error = t('errSize'); ui.errorKind = 'size'; renderAdmin(); return; }
  if(!mediaTypeOf(file)){ ui.error = t('errType'); ui.errorKind = 'type'; renderAdmin(); return; }
  lastFile = {file, mode};
  ui.busy = true; ui.progress = t('reading'); ui.stage = 1; renderAdmin();
  try{
    const data = (forceLocal || APP.settings.extractMode === 'local') ? await localExtract(file) : await aiExtract(file);
    const prevPaths = mode === 'append' ? (c.report?.storagePaths || []) : [];
    mergeExtraction(c, data, mode, file.name);
    setProgress(t('sending'));
    const path = await uploadReport(c, file);
    c.report.storagePaths = [...prevPaths, ...(path ? [path] : [])];
    ui.busy = false; await persist(); renderAdmin(); openEditor();
  }catch(e){
    ui.busy = false; ui.error = e.message || String(e); ui.errorKind = e.kind || 'generic'; renderAdmin();
  }
}
function bindDrop(){
  const dz = $('#drop'); if(!dz) return;
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if(f) handleFile(f, C().report ? 'replace' : 'replace'); });
}
async function uploadReport(c, file){
  const safe = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9._-]+/g,'_').slice(-80);
  const path = `${c.id}/${Date.now()}-${safe}`;
  const { error } = await sb.storage.from('reports').upload(path, file, { contentType:mediaTypeOf(file) || file.type, upsert:false });
  if(error){ console.error(error); toast(t('saveErr'), 'warn'); return null; }
  return path;
}

/* ---------- FitLine ---------- */
async function openFitline(){
  const c = C(); const url = fitlineUrl();
  const wa = c ? waDigits(c.patient.whatsapp) : '';
  openModal(`${modalHead(t('fitlineTitle'))}<div class="modal-body">
    <p class="muted" style="margin-top:0">${url ? t('fitlineHint') : t('fitlineEmpty')}</p>
    <label class="f">${t('fitlineUrlL')}<input id="flUrl" value="${esc(url)}" placeholder="https://" autocomplete="off"></label>
    ${c ? `<p class="note" style="margin-top:-4px">${wa ? t('flTo', { n:esc(c.patient.whatsapp) }) : t('needWa')}</p>` : ''}
    ${c && wa ? `<div id="flWin" class="flwin"></div>` : ''}
    <div class="row">
      ${c ? `<button class="btn sm primary" data-action="fl-send" ${wa ? '' : 'disabled'}>${ic('send')}${t('flSendWa')}</button>` : ''}
      <button class="btn sm" data-action="fl-copy">${ic('copy')}${t('copyLink')}</button>
      <button class="btn sm" data-action="fl-open">${ic('link')}${t('openLink')}</button>
    </div>
    ${c ? `<label class="checkrow"><input type="checkbox" id="flVisible" ${c.fitline?.enabled ? 'checked' : ''}> ${t('fitlineVisible')}</label>` : ''}
    <div class="note" id="flSent">${c ? t('loading') : ''}</div>
  </div><div class="modal-foot"><button class="btn" data-action="close">${t('close')}</button></div>`);
  if(!url) setTimeout(() => $('#flUrl')?.focus(), 30);
  if(c){ loadFitlineHistory(); loadWindowState(); }
}
// 24 h WhatsApp service window: known only when the Kapso webhook is configured.
async function loadWindowState(){
  const c = C(); if(!c) return;
  try{
    if(!A.health) A.health = await api('health');
    const box = $('#flWin'); if(!box) return;
    if(!A.health.kapso_webhook){ box.innerHTML = `<span class="chip unknown">${t('winUnknown')}</span>`; return; }
    const { data } = await sb.from('clients').select('last_inbound_at').eq('id', c.id).maybeSingle();
    const last = data?.last_inbound_at ? Date.parse(data.last_inbound_at) : 0;
    const until = last + 24 * 3600 * 1000;
    const el = $('#flWin'); if(!el) return;
    el.innerHTML = until > Date.now()
      ? `<span class="chip normal">${t('winOpen', { d:fmtStamp(new Date(until).toISOString()) })}</span>`
      : `<span class="chip tbd">${t('winClosed')}</span>${last ? ` <span class="muted">${t('winLast', { d:fmtStamp(data.last_inbound_at) })}</span>` : ''}`;
  }catch(e){ const el = $('#flWin'); if(el) el.innerHTML = ''; }
}
async function loadFitlineHistory(){
  const c = C(); const box = $('#flSent'); if(!c || !box) return;
  const { data } = await sb.from('message_log').select('kind,ok,created_at,template').eq('client_id', c.id).in('kind', ['fitline', 'fitline_click']).order('created_at', { ascending:false }).limit(50);
  const rows = data || [];
  const sent = rows.find(r => r.kind === 'fitline' && r.ok), click = rows.find(r => r.kind === 'fitline_click');
  const clicks = rows.filter(r => r.kind === 'fitline_click').length;
  const el = $('#flSent'); if(!el) return;
  el.innerHTML = [
    sent ? t('flLastSent', { d:fmtStamp(sent.created_at) }) : t('notSent'),
    click ? t('flLastClick', { d:fmtStamp(click.created_at), n:clicks }) : (sent ? t('flNoClick') : '')
  ].filter(Boolean).join('<br>');
}
async function sendFitlineWa(btn){
  const c = C(); if(!c) return;
  const url = normUrl($('#flUrl')?.value);
  if(!url){ toast(t('invalidUrl'), 'warn'); $('#flUrl')?.focus(); return; }
  if(url !== APP.settings.fitlineUrl){ APP.settings.fitlineUrl = url; $('#flUrl').value = url; await saveSettingsRow({ fitline_url:url }); }
  if(btn) btn.disabled = true;
  try{
    await api('send', { client_id:c.id, kind:'fitline' });
    toast(t('sentOk'));
    c.fitline = { ...(c.fitline || {}), enabled:true, sentAt:new Date().toISOString() }; persist();
    const cb = $('#flVisible'); if(cb) cb.checked = true;
    loadFitlineHistory(); loadWindowState();
  }catch(e){ toast(errText(e), 'warn'); }
  if(btn) btn.disabled = false;
}
function fitlineAction(kind){
  const url = normUrl($('#flUrl')?.value);
  if(!url){ toast(t('invalidUrl'), 'warn'); $('#flUrl')?.focus(); return; }
  if(url !== APP.settings.fitlineUrl){ APP.settings.fitlineUrl = url; $('#flUrl').value = url; saveSettingsRow({ fitline_url:url }); }
  if(kind === 'open'){ window.open(url, '_blank', 'noopener'); return; }
  const c = C();
  const link = c ? `${location.origin}/f/${c.accessToken}` : url;
  const msg = c ? t('fitlineMsg', { name:(c.patient.name || '').split(' ')[0], url:link }) : url;
  const done = () => toast(t('copied'));
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(msg).then(done, () => fallbackCopy(msg, done)); else fallbackCopy(msg, done);
}
function fallbackCopy(txt, cb){ const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); cb(); }catch(e){} ta.remove(); }
/* ---------- Editor ---------- */
function openEditor(){
  const c = C(); if(!c) return;
  editorDraft = JSON.parse(JSON.stringify({lang:c.lang, patient:c.patient, report:c.report || {date:'',lab:'',practitioner:'',summary:'',files:[]}, journeyStart:c.journeyStart || todayISO(), supplements:c.supplements, peptides:c.peptides, biomarkers:c.biomarkers, followUpNotes:c.followUpNotes}));
  openModal(`${modalHead(t('editorTitle'))}<div class="modal-body" id="edBody"></div><div class="modal-foot"><button class="btn" data-action="close">${t('cancel')}</button><button class="btn primary" data-action="ed-save">${ic('check')}${t('save')}</button></div>`, true);
  renderEditor();
}
const inp = (path, val, type='text', ph='') => `<input type="${type}" data-ed="${path}" value="${esc(val ?? '')}" placeholder="${esc(ph)}">`;
function chipsFor(path, selected, opts, labelFn){ return `<div class="chips">${opts.map(o => `<button type="button" class="tchip ${selected.includes(o)?'on':''}" data-action="ed-chip" data-path="${path}" data-v="${o}">${labelFn(o)}</button>`).join('')}</div>`; }
function renderEditor(){
  const d = editorDraft, body = $('#edBody'); if(!body) return; const sc = $('.overlay')?.scrollTop;
  const suppCards = d.supplements.map((s, i) => `<div class="ed-card"><div class="top"><b>${esc(s.name || t('supp')+' '+(i+1))}</b><button class="btn sm danger" data-action="ed-del" data-list="supplements" data-i="${i}">${ic('trash')}${t('remove')}</button></div>
    <div class="fgrid"><label class="f">${t('name')}${inp(`supplements.${i}.name`, s.name)}</label><label class="f">${t('dose')}${inp(`supplements.${i}.dose`, s.dose)}</label><label class="f">${t('form')}${inp(`supplements.${i}.form`, s.form)}</label><label class="f">${t('frequency')}${inp(`supplements.${i}.frequency`, s.frequency)}</label>
    <label class="f">${t('startDate')}${inp(`supplements.${i}.start`, s.start, 'date')}<span style="font-size:11px">${t('startHint')}</span></label><label class="f">${t('durationDays')}${inp(`supplements.${i}.durationDays`, s.durationDays, 'number')}</label><label class="f">${t('everyNLabel')}${inp(`supplements.${i}.everyN`, s.everyN||0, 'number')}</label></div>
    <span class="mono muted">${t('slots')}</span>${chipsFor(`supplements.${i}.slots`, s.slots, SLOTS, o => t('slot_'+o))}
    <span class="mono muted">${t('weekdays')}</span>${chipsFor(`supplements.${i}.days`, s.days.map(String), WEEK_ORDER.map(String), o => t('dowLong')[+o])}
    <label class="f">${t('instructions')}${inp(`supplements.${i}.instructions`, s.instructions)}</label></div>`).join('');
  const pepCards = d.peptides.map((p, i) => `<div class="ed-card"><div class="top"><b>${esc(p.name || t('pep')+' '+(i+1))}</b><button class="btn sm danger" data-action="ed-del" data-list="peptides" data-i="${i}">${ic('trash')}${t('remove')}</button></div>
    <div class="fgrid"><label class="f">${t('name')}${inp(`peptides.${i}.name`, p.name)}</label><label class="f">${t('dose')}${inp(`peptides.${i}.dose`, p.dose)}</label>
    <label class="f">${t('route')}<select data-ed="peptides.${i}.route">${ROUTES.map(r => `<option value="${r}" ${p.route===r?'selected':''}>${t('r_'+r)}</option>`).join('')}</select></label><label class="f">${t('frequency')}${inp(`peptides.${i}.frequency`, p.frequency)}</label>
    <label class="f">${t('startDate')}${inp(`peptides.${i}.start`, p.start, 'date')}<span style="font-size:11px">${t('startHint')}</span></label><label class="f">${t('endDate')}${inp(`peptides.${i}.end`, p.end, 'date')}</label><label class="f">${t('cycleDays')}${inp(`peptides.${i}.cycleDays`, p.cycleDays, 'number')}</label><label class="f">${t('everyNLabel')}${inp(`peptides.${i}.everyN`, p.everyN||0, 'number')}</label></div>
    <span class="mono muted">${t('slots')}</span>${chipsFor(`peptides.${i}.slots`, p.slots, SLOTS, o => t('slot_'+o))}
    <span class="mono muted">${t('weekdays')}</span>${chipsFor(`peptides.${i}.days`, p.days.map(String), WEEK_ORDER.map(String), o => t('dowLong')[+o])}
    <div class="fgrid"><label class="f">${t('reconstitution')}${inp(`peptides.${i}.reconstitution`, p.reconstitution)}</label><label class="f">${t('instructions')}${inp(`peptides.${i}.instructions`, p.instructions)}</label></div></div>`).join('');
  const bioRows = d.biomarkers.map((b, i) => `<tr><td>${inp(`biomarkers.${i}.name`, b.name)}</td><td>${inp(`biomarkers.${i}.value`, b.value)}</td><td>${inp(`biomarkers.${i}.unit`, b.unit)}</td><td>${inp(`biomarkers.${i}.ref`, b.ref)}</td><td><select data-ed="biomarkers.${i}.status">${['low','normal','high','unknown'].map(s => `<option value="${s}" ${b.status===s?'selected':''}>${s==='unknown'?'?':t('s_'+s)}</option>`).join('')}</select></td><td><button class="icon-btn" data-action="ed-del" data-list="biomarkers" data-i="${i}">${ic('trash')}</button></td></tr>`).join('');
  body.innerHTML = `<p class="muted" style="margin-top:0">${t('editorSub')}</p>
    <div class="fgrid"><label class="f">${t('patient')}${inp('patient.name', d.patient.name)}</label><label class="f">${t('dob')}${inp('patient.dob', d.patient.dob, 'date')}</label><label class="f">${t('sex')}${inp('patient.sex', d.patient.sex)}</label><label class="f">${t('pid')}${inp('patient.patientId', d.patient.patientId)}</label><label class="f">${t('whatsappNum')}${inp('patient.whatsapp', d.patient.whatsapp, 'tel', t('waPh'))}</label><label class="f">${t('clientLang')}<select data-ed="lang"><option value="pt" ${d.lang!=='en'?'selected':''}>Português</option><option value="en" ${d.lang==='en'?'selected':''}>English</option></select></label></div>
    <div class="fgrid"><label class="f"><b style="color:var(--navy)">${t('journeyStart')}</b>${inp('journeyStart', d.journeyStart, 'date')}</label><label class="f">${t('reportDate')}${inp('report.date', d.report.date, 'date')}</label><label class="f">${t('lab')}${inp('report.lab', d.report.lab)}</label><label class="f">${t('practitioner')}${inp('report.practitioner', d.report.practitioner)}</label></div>
    <label class="f">${t('summary')}<textarea data-ed="report.summary">${esc(d.report.summary)}</textarea></label>
    <div class="ed-sec"><div class="row"><h3>${t('supplements')} (${d.supplements.length})</h3><button class="btn sm" data-action="ed-add" data-list="supplements">${ic('plus')}${t('add')}</button></div>${suppCards}</div>
    <div class="ed-sec"><div class="row"><h3>${t('peptides')} (${d.peptides.length})</h3><button class="btn sm" data-action="ed-add" data-list="peptides">${ic('plus')}${t('add')}</button></div>${pepCards}</div>
    <div class="ed-sec"><div class="row"><h3>${t('biomarkers')} (${d.biomarkers.length})</h3><button class="btn sm" data-action="ed-add" data-list="biomarkers">${ic('plus')}${t('add')}</button></div>
    ${d.biomarkers.length ? `<div class="tbl-wrap"><table class="ed-tbl"><thead><tr><th>${t('marker')}</th><th>${t('value')}</th><th>${t('unit')}</th><th>${t('refRange')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>${bioRows}</tbody></table></div>` : ''}</div>
    <div class="ed-sec"><label class="f">${t('fuNotes')}<textarea data-ed="followUpNotes">${esc(d.followUpNotes)}</textarea></label></div>`;
  body.querySelectorAll('.ed-tbl input, .ed-tbl select').forEach(el => { el.style.cssText = 'width:100%;min-width:80px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:13px'; });
  if(sc !== undefined && $('.overlay')) $('.overlay').scrollTop = sc;
}
function setPath(obj, path, val){ const ks = path.split('.'); let o = obj; for(let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length-1]] = val; }
function getPath(obj, path){ return path.split('.').reduce((o, k) => o?.[k], obj); }
function editorSave(){
  const c = C(), d = editorDraft; if(!c || !d) return;
  if(d.patient.whatsapp && !waDigits(d.patient.whatsapp)){ toast(t('waInvalid'),'warn'); document.querySelector('[data-ed="patient.whatsapp"]')?.focus(); return; }
  const hasContent = !!c.report || d.supplements.some(x => x.name.trim()) || d.peptides.some(x => x.name.trim()) || d.biomarkers.some(x => x.name.trim());
  c.lang = d.lang === 'en' ? 'en' : 'pt'; c.patient = d.patient; c.report = c.report || hasContent ? d.report : null; c.journeyStart = validISO(d.journeyStart) || todayISO(); c.followUpNotes = d.followUpNotes || '';
  const fixInt = v => posInt(v); const fixN = v => { const n = parseInt(v,10); return n > 1 ? n : 0; };
  c.supplements = d.supplements.filter(s => s.name.trim()).map(s => ({...s, start:validISO(s.start), durationDays:fixInt(s.durationDays), everyN:fixN(s.everyN), days:s.days.map(Number).sort(), slots:s.slots.length ? s.slots : ['breakfast']}));
  c.peptides = d.peptides.filter(p => p.name.trim()).map(p => { const o = {...p, start:validISO(p.start), end:validISO(p.end), cycleDays:fixInt(p.cycleDays), everyN:fixN(p.everyN), days:p.days.map(Number).sort(), slots:p.slots.length ? p.slots : ['wake']}; if(o.end && !o.cycleDays) o.cycleDays = diffDays(o.end, effStart(c,o)) + 1; return o; });
  c.biomarkers = d.biomarkers.filter(b => b.name.trim());
  const wasConfirmed = c.confirmed.s1; c.confirmed.s1 = wasConfirmed || hasContent;
  closeModal();
  if(!wasConfirmed && c.confirmed.s1) ui.stage = 2;
  persist(); renderAdmin();
}

/* ---------- Events ---------- */
document.addEventListener('submit', e => { if(e.target.id === 'loginForm'){ e.preventDefault(); signIn(); } });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if(!el) return;
  const a = el.dataset.action; const c = C();
  if(a === 'overlay'){ if(e.target === el && !editorDraft) closeModal(); return; }
  if(['set-mode', 'fu-time', 'gcal'].includes(a)) return;
  e.preventDefault();
  el.closest('details.menu')?.removeAttribute('open');
  switch(a){
    case 'lang': setLang(APP.lang === 'pt' ? 'en' : 'pt'); renderAdmin(); break;
    case 'logout': signOut(); break;
    case 'settings': openSettings(); break;
    case 'save-settings': saveSettings(); break;
    case 'close': closeModal(); break;
    case 'new-client': openNewClient(); break;
    case 'create-client': createNewClient(); break;
    case 'open-client': location.hash = `#/c/${el.dataset.id}`; break;
    case 'stage': ui.stage = +el.dataset.n; renderAdmin(); break;
    case 'day': { const d = +el.dataset.d; ui.day = d === 0 ? todayISO() : addDays(ui.day, d); renderAdmin(); break; }
    case 'pick': pickMode = el.dataset.mode || 'replace'; $('#fileIn').value = ''; $('#fileIn').click(); break;
    case 'retry-local': if(lastFile) handleFile(lastFile.file, lastFile.mode, true); break;
    case 'report-file': openReportFile(); break;
    case 'editor': openEditor(); break;
    case 'ed-add': { const l = el.dataset.list; const js = editorDraft.journeyStart;
      if(l === 'supplements') editorDraft.supplements.push(normSupp({ name:'' }, js));
      else if(l === 'peptides') editorDraft.peptides.push(normPep({ name:'' }, js));
      else editorDraft.biomarkers.push(normBio({ name:'' }));
      renderEditor(); break; }
    case 'ed-del': editorDraft[el.dataset.list].splice(+el.dataset.i, 1); renderEditor(); break;
    case 'ed-chip': { const arr = getPath(editorDraft, el.dataset.path); const isDays = el.dataset.path.endsWith('.days'); const v = isDays ? +el.dataset.v : el.dataset.v; const i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); renderEditor(); break; }
    case 'ed-save': editorSave(); break;
    case 'ics': { const n = +el.dataset.n; const f = followupDates(c).find(x => x.n === n); download(`regenecure-followup-${n}-${slug(c.patient.name)}.ics`, buildICS(c, [f]), 'text/calendar'); break; }
    case 'ics-all': { const list = followupDates(c).filter(f => !c.followups[f.n]?.done); download(`regenecure-followups-${slug(c.patient.name)}.ics`, buildICS(c, list), 'text/calendar'); break; }
    case 'fu-done': { c.followups[+el.dataset.n] = { done:true, doneAt:new Date().toISOString() }; persist(); renderAdmin(); break; }
    case 'fu-undo': { delete c.followups[+el.dataset.n]; persist(); renderAdmin(); break; }
    case 'send-fu': sendFollowupReminder(+el.dataset.n); break;
    case 'send-journey': sendJourney(); break;
    case 'publish-only': setStatus('published').then(() => copyText(clientLink(C()), t('linkCopied'))); break;
    case 'unpublish': setStatus('draft'); break;
    case 'copy-link': copyText(clientLink(c), t('linkCopied')); break;
    case 'preview': window.open(`/c/${c.accessToken}?preview=1`, '_blank', 'noopener'); break;
    case 'rotate': rotateLink(); break;
    case 'delete-client': deleteClient(); break;
    case 'fitline': openFitline(); break;
    case 'fl-send': sendFitlineWa(el); break;
    case 'fl-copy': fitlineAction('copy'); break;
    case 'fl-open': fitlineAction('open'); break;
    case 'tpl-create': templatesAction('create'); break;
    case 'tpl-status': templatesAction('status'); break;
    case 'import': $('#importIn').value = ''; $('#importIn').click(); break;
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if(el.dataset.ed && editorDraft){ setPath(editorDraft, el.dataset.ed, el.value); return; }
  if(el.id === 'search'){ A.search = el.value; const pos = el.selectionStart; renderAdmin(); const s = $('#search'); if(s){ s.focus(); s.setSelectionRange(pos, pos); } }
});
document.addEventListener('change', e => {
  const el = e.target;
  if(el.id === 'fileIn'){ const f = el.files[0]; if(f) handleFile(f, pickMode); }
  else if(el.id === 'importIn'){ const f = el.files[0]; if(f) importBackup(f); }
  else if(el.dataset.action === 'set-mode'){ document.querySelectorAll('.radio label').forEach(l => l.classList.toggle('on', l.contains(document.querySelector('input[name=mode]:checked')))); }
  else if(el.dataset.action === 'fu-time'){ const c = C(); c.followUpTime = el.value || '10:00'; persist(); renderAdmin(); }
  else if(el.id === 'flVisible'){ const c = C(); c.fitline = { ...(c.fitline || {}), enabled:el.checked }; persist(); }
  else if(el.dataset.ed && editorDraft){ setPath(editorDraft, el.dataset.ed, el.value); }
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && modalOpen()) closeModal();
  if(e.key === 'Enter' && e.target.id === 'ncName') document.querySelector('[data-action=create-client]')?.click();
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { if(!e.target.closest('#drop')) e.preventDefault(); });
setInterval(() => { const td = todayISO(); if(ui.lastToday && ui.lastToday !== td){ if(ui.day === ui.lastToday) ui.day = td; renderAdmin(); } ui.lastToday = td; }, 60000);
ui.lastToday = todayISO();

boot();
