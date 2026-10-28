// Shared server helpers for the Netlify Functions (Node runtime).
// Public identifiers have defaults; secrets come only from environment variables.
import crypto from "node:crypto";

const DEFAULTS = {
  SUPABASE_URL: "https://gfdiwphqxyimckoxuqgs.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_OjPZtrgkLAZ_oMuoI_e4ww_h3uT2_G_",
  KAPSO_PHONE_NUMBER_ID: "1418705654659738",
  KAPSO_API_BASE: "https://api.kapso.ai/meta/whatsapp/v24.0",
  APP_URL: "https://jornada.regenecure.com",
  WA_LANG_PT: "pt_BR",
  WA_LANG_EN: "en_US",
  WA_TEMPLATE_JOURNEY: "jornada_publicada",
  WA_TEMPLATE_JOURNEY_OLD: "jornada_pronta",
  WA_TEMPLATE_FOLLOWUP: "lembrete_followup",
  WA_TEMPLATE_OTP: "codigo_acesso",
  WA_TEMPLATE_FU_CONFIRM: "followup_confirmacao",
  WA_TEMPLATE_PEPTIDE: "lembrete_peptideo",
  WA_TEMPLATE_FITLINE: "link_fitline",
  FOLLOWUP_REMINDER_HOUR: "10",
  VAPID_SUBJECT: "mailto:support@regenecure.com",
};

export const env = (k) => {
  const v = process.env[k];
  return v !== undefined && v !== "" ? v : DEFAULTS[k];
};
export const appUrl = () => env("APP_URL").replace(/\/+$/, "");

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
export class HttpError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
export function handle(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
      console.error(e);
      return json({ error: "server_error" }, 500);
    }
  };
}
export async function readJson(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "invalid_json"); }
}

/* ---------------- Crypto ---------------- */
export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const pepper = () => process.env.SESSION_PEPPER || process.env.SUPABASE_SECRET_KEY || "";
export const hashSecret = (value, scope) => sha256(`${scope}:${value}:${pepper()}`);

/* ---------------- Supabase (secret key, server only) ---------------- */
function secretKey() {
  const k = process.env.SUPABASE_SECRET_KEY;
  if (!k) throw new HttpError(500, "missing_supabase_secret");
  return k;
}
export async function db(path, { method = "GET", body, prefer, headers = {} } = {}) {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: secretKey(),
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("db error", method, path.split("?")[0], res.status, text.slice(0, 300));
    throw new HttpError(502, "db_error");
  }
  return text ? JSON.parse(text) : null;
}
export const enc = encodeURIComponent;

export async function dbAll(pathWithQuery, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = pathWithQuery.includes("?") ? "&" : "?";
    const rows = await db(`${pathWithQuery}${sep}limit=${pageSize}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

export async function signedReportUrl(path, expiresIn = 600) {
  const res = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/sign/reports/${path.split("/").map(enc).join("/")}`, {
    method: "POST",
    headers: { apikey: secretKey(), "content-type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new HttpError(502, "storage_error");
  const j = await res.json();
  const rel = j.signedURL || j.signedUrl;
  return rel.startsWith("http") ? rel : `${env("SUPABASE_URL")}/storage/v1${rel}`;
}

/* ---------------- Admin verification ---------------- */
export async function requireAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) throw new HttpError(401, "unauthorized");
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_PUBLISHABLE_KEY"), authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new HttpError(401, "unauthorized");
  const user = await res.json();
  if (!user?.id) throw new HttpError(401, "unauthorized");
  const rows = await db(`admins?user_id=eq.${enc(user.id)}&select=user_id`);
  if (!rows.length) throw new HttpError(403, "forbidden");
  return user;
}

/* ---------------- WhatsApp via Kapso ---------------- */
export function waDigits(n) {
  let d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  d = d.replace(/\+/g, "");
  return d.length >= 8 && d.length <= 15 ? d : "";
}
// WhatsApp ids for older Brazilian mobiles may omit the 9 after the area code; match both forms.
export function phoneVariants(n) {
  const d = waDigits(n);
  if (!d) return [];
  const out = new Set([d]);
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") out.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith("55") && d.length === 12) out.add(d.slice(0, 4) + "9" + d.slice(4));
  return [...out];
}
export const maskPhone = (n) => { const d = waDigits(n); return d ? `+${d.slice(0, 2)} ••• ••${d.slice(-4)}` : ""; };
export const waLang = (lang) => (lang === "en" ? env("WA_LANG_EN") : env("WA_LANG_PT"));
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

export function kapsoConfigured() {
  return !!process.env.KAPSO_API_KEY && !!env("KAPSO_PHONE_NUMBER_ID");
}

async function kapsoPost(path, payload, timeoutMs = 8000) {
  const key = process.env.KAPSO_API_KEY;
  if (!key) throw new HttpError(500, "missing_kapso_key");
  const res = await fetch(`${env("KAPSO_API_BASE")}/${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body: j, raw: text };
}
const errMsg = (r) => (r.body?.error?.message || r.body?.error || r.raw || `HTTP ${r.status}`).toString().slice(0, 300);

export async function sendTemplate({ to, name, lang, components }) {
  const digits = waDigits(to);
  if (!digits) return { ok: false, error: "invalid_phone" };
  const payload = (comps) => ({
    messaging_product: "whatsapp",
    to: digits,
    type: "template",
    template: { name, language: { code: waLang(lang) }, components: comps },
  });
  const r = await kapsoPost(`${env("KAPSO_PHONE_NUMBER_ID")}/messages`, payload(components));
  if (r.ok) return { ok: true, id: r.body?.messages?.[0]?.id || null };
  return { ok: false, status: r.status, error: errMsg(r) };
}

export async function sendText({ to, body }) {
  const digits = waDigits(to);
  if (!digits) return { ok: false, error: "invalid_phone" };
  const r = await kapsoPost(`${env("KAPSO_PHONE_NUMBER_ID")}/messages`, {
    messaging_product: "whatsapp", to: digits, type: "text", text: { body, preview_url: true },
  });
  if (r.ok) return { ok: true, id: r.body?.messages?.[0]?.id || null };
  return { ok: false, status: r.status, error: errMsg(r) };
}

export async function sendOtp({ to, lang, code }) {
  const body = { type: "body", parameters: [{ type: "text", text: code }] };
  // Meta documents sub_type "url" for copy-code buttons; Kapso documents "otp". Try both.
  let r = await sendTemplate({ to, name: env("WA_TEMPLATE_OTP"), lang, components: [body, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] }] });
  if (!r.ok && r.status && r.status < 500 && r.error !== "invalid_phone") {
    const r2 = await sendTemplate({ to, name: env("WA_TEMPLATE_OTP"), lang, components: [body, { type: "button", sub_type: "otp", index: "0", parameters: [{ type: "text", text: code }] }] });
    if (r2.ok) return r2;
  }
  return r;
}

export async function logMessage(client_id, kind, template, r) {
  try {
    await db("message_log", { method: "POST", body: { client_id, kind, template, wa_message_id: r.id || null, ok: !!r.ok, error: r.ok ? null : String(r.error || "").slice(0, 300) }, prefer: "return=minimal" });
  } catch (e) { console.error("log failed", e); }
}

/* ---------------- Journey messages ---------------- */
export async function sendJourney(c) {
  const body = { type: "body", parameters: [{ type: "text", parameter_name: "name", text: firstName(c.name) }] };
  const url = { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.access_token }] };
  // Current template: dashboard button + quick reply "Recebi" (the reply opens the 24 h window).
  const r = await sendTemplate({ to: c.whatsapp, name: env("WA_TEMPLATE_JOURNEY"), lang: c.lang, components: [
    body, url, { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "RECEBI" }] },
  ] });
  if (r.ok || r.error === "invalid_phone") return { ...r, template: env("WA_TEMPLATE_JOURNEY") };
  // Fallback while the new template is not approved.
  const r2 = await sendTemplate({ to: c.whatsapp, name: env("WA_TEMPLATE_JOURNEY_OLD"), lang: c.lang, components: [body, url] });
  return { ...r2, template: env("WA_TEMPLATE_JOURNEY_OLD") };
}
export async function sendFollowup(c, n) {
  const date = (c.followup_dates || [])[n - 1];
  if (!date) return { ok: false, error: "no_date" };
  const body = (name) => [
    { type: "text", parameter_name: "name", text: firstName(c.name) },
    { type: "text", parameter_name: "date", text: formatFollowup(date, c.data?.followUpTime || "", c.lang) },
  ];
  // Preferred: template with "confirm attendance" button that opens the follow-up stage.
  const r = await sendTemplate({
    to: c.whatsapp, name: env("WA_TEMPLATE_FU_CONFIRM"), lang: c.lang,
    components: [
      { type: "body", parameters: body() },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: `${c.access_token}.fu` }] },
    ],
  });
  if (r.ok || r.error === "invalid_phone") return { ...r, template: env("WA_TEMPLATE_FU_CONFIRM") };
  // Fallback while the new template is not yet approved.
  const r2 = await sendTemplate({
    to: c.whatsapp, name: env("WA_TEMPLATE_FOLLOWUP"), lang: c.lang,
    components: [
      { type: "body", parameters: body() },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.access_token }] },
    ],
  });
  return { ...r2, template: env("WA_TEMPLATE_FOLLOWUP") };
}

const SLOT_LABEL = {
  pt: { wake: "ao acordar", breakfast: "café da manhã", lunch: "almoço", afternoon: "tarde", dinner: "jantar", bedtime: "antes de dormir" },
  en: { wake: "on waking", breakfast: "breakfast", lunch: "lunch", afternoon: "afternoon", dinner: "dinner", bedtime: "bedtime" },
};
export function peptideDosesText(list, lang) {
  const L = SLOT_LABEL[lang === "en" ? "en" : "pt"];
  const txt = list.map((p) => `${p.name} ${p.dose || ""}`.trim() + ((p.slots || []).length ? ` (${p.slots.map((x) => L[x] || x).join(", ")})` : "")).join("; ");
  return txt.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, " ").slice(0, 900);
}
export function peptideNotification(c, list) {
  const en = c.lang === "en";
  return {
    title: en ? "RegeneCure · Today's peptides" : "RegeneCure · Peptídeos de hoje",
    body: peptideDosesText(list, c.lang),
    url: `/c/${c.access_token}.today`,
    tag: "peptides",
  };
}

/* ---------------- Protocol schedule (server copy of the browser engine) ---------------- */
const DAY = 86400000;
const parseDay = (d) => { const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, dd); };
export const addDaysISO = (d, n) => new Date(parseDay(d) + n * DAY).toISOString().slice(0, 10);
const diffDaysISO = (a, b) => Math.round((parseDay(a) - parseDay(b)) / DAY);
function pepEnd(js, p) {
  if (p.end) return p.end;
  if (p.cycleDays) return addDaysISO(p.start || js, p.cycleDays - 1);
  return "";
}
export function peptidesOn(data, date) {
  const js = data?.journeyStart;
  if (!js || !data?.s1Confirmed) return [];
  return (data.peptides || []).filter((p) => {
    const st = p.start || js;
    if (date < st) return false;
    const en = pepEnd(js, p);
    if (en && date > en) return false;
    if (p.everyN > 1) return diffDaysISO(date, st) % p.everyN === 0;
    const days = p.days && p.days.length ? p.days : [0, 1, 2, 3, 4, 5, 6];
    return days.includes(new Date(parseDay(date)).getUTCDay());
  });
}
export function validTz(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 60) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}
export const defaultTz = (lang) => (lang === "en" ? "Asia/Dubai" : "America/Sao_Paulo");
export function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) % 24 };
}

// FitLine link: free-form text inside the 24 h customer-service window, otherwise the marketing template.
// The link goes through /f/<token>, which redirects to the current FitLine URL and records the click.
export const WINDOW_MS = 24 * 3600 * 1000;
// true / false when the Kapso webhook is configured; null when the platform cannot know.
export function windowOpen(c) {
  if (!process.env.KAPSO_WEBHOOK_SECRET) return null;
  return !!c.last_inbound_at && Date.now() - Date.parse(c.last_inbound_at) < WINDOW_MS;
}
export async function sendFitline(c) {
  const link = `${appUrl()}/f/${c.access_token}`;
  const name = firstName(c.name);
  const text = c.lang === "en"
    ? `Hello ${name}. Here is the FitLine access recommended in your RegeneCure protocol: ${link}`
    : `Olá, ${name}. Segue o acesso FitLine indicado no seu protocolo RegeneCure: ${link}`;
  // Outside the known window, free text would be rejected: go straight to the template.
  const r = windowOpen(c) === false ? { ok: false, error: "window_closed" } : await sendText({ to: c.whatsapp, body: text });
  if (r.ok || r.error === "invalid_phone") return { ...r, via: "text" };
  const r2 = await sendTemplate({
    to: c.whatsapp, name: env("WA_TEMPLATE_FITLINE"), lang: c.lang,
    components: [
      { type: "body", parameters: [{ type: "text", parameter_name: "name", text: name }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.access_token }] },
    ],
  });
  return { ...r2, via: "template", textError: r.error };
}

/* ---------------- Templates (shared by sending and creation) ---------------- */
export function templateDefinitions() {
  const url = `${appUrl()}/c/{{1}}`;
  const sampleUrl = `${appUrl()}/c/AbCdEf123456`;
  const tx = {
    pt: {
      journey: "Olá, {{name}}. Seu protocolo RegeneCure foi publicado no seu painel pessoal, com suplementos, peptídeos e datas de follow-up. Acesse pelo botão abaixo.",
      followup: "Olá, {{name}}. Lembrete: seu follow-up RegeneCure está agendado para {{date}}. Os detalhes do protocolo estão no seu painel.",
      fuConfirm: "Olá, {{name}}. Seu follow-up RegeneCure está agendado para {{date}}. Confirme sua presença ou solicite outro horário pelo botão abaixo.",
      fitline: "Olá, {{name}}. Conforme o seu protocolo RegeneCure, segue o acesso aos produtos FitLine indicados para você.", btnFitline: "Acessar FitLine",
      peptide: "Olá, {{name}}. Lembrete do seu protocolo para hoje: {{doses}}. Depois de cada aplicação, registre no seu painel pelo botão abaixo.",
      btnRecebi: "Recebi",
      btn: "Abrir meu painel", btnConfirm: "Confirmar presença", btnLog: "Registrar no painel", copy: "Copiar código", date: "13 de novembro, 10:00", doses: "BPC-157 250 mcg (ao acordar)",
    },
    en: {
      journey: "Hello {{name}}. Your RegeneCure protocol has been published to your personal dashboard, including supplements, peptides and follow-up dates. Open it with the button below.",
      followup: "Hello {{name}}. Reminder: your RegeneCure follow-up is scheduled for {{date}}. Your protocol details are in your dashboard.",
      fuConfirm: "Hello {{name}}. Your RegeneCure follow-up is scheduled for {{date}}. Confirm your attendance or request another time with the button below.",
      fitline: "Hello {{name}}. As part of your RegeneCure protocol, here is access to the FitLine products recommended for you.", btnFitline: "Open FitLine",
      peptide: "Hello {{name}}. Your protocol reminder for today: {{doses}}. After each dose, log it in your dashboard with the button below.",
      btnRecebi: "Received",
      btn: "Open my dashboard", btnConfirm: "Confirm attendance", btnLog: "Log in my dashboard", copy: "Copy code", date: "13 November, 10:00", doses: "BPC-157 250 mcg (on waking)",
    },
  };
  const out = [];
  for (const lang of ["pt", "en"]) {
    const s = tx[lang];
    const button = { type: "BUTTONS", buttons: [{ type: "URL", text: s.btn, url, example: [sampleUrl] }] };
    out.push({
      lang, name: env("WA_TEMPLATE_JOURNEY"), category: "UTILITY", language: waLang(lang), parameter_format: "NAMED",
      components: [{ type: "BODY", text: s.journey, example: { body_text_named_params: [{ param_name: "name", example: "Ana" }] } },
        { type: "BUTTONS", buttons: [{ type: "URL", text: s.btn, url, example: [sampleUrl] }, { type: "QUICK_REPLY", text: s.btnRecebi }] }],
    });
    out.push({
      lang, name: env("WA_TEMPLATE_FOLLOWUP"), category: "UTILITY", language: waLang(lang), parameter_format: "NAMED",
      components: [{ type: "BODY", text: s.followup, example: { body_text_named_params: [{ param_name: "name", example: "Ana" }, { param_name: "date", example: s.date }] } }, button],
    });
    const btnWith = (text) => ({ type: "BUTTONS", buttons: [{ type: "URL", text, url, example: [sampleUrl] }] });
    out.push({
      lang, name: env("WA_TEMPLATE_FU_CONFIRM"), category: "UTILITY", language: waLang(lang), parameter_format: "NAMED",
      components: [{ type: "BODY", text: s.fuConfirm, example: { body_text_named_params: [{ param_name: "name", example: "Ana" }, { param_name: "date", example: s.date }] } }, btnWith(s.btnConfirm)],
    });
    out.push({
      lang, name: env("WA_TEMPLATE_FITLINE"), category: "MARKETING", language: waLang(lang), parameter_format: "NAMED",
      components: [{ type: "BODY", text: s.fitline, example: { body_text_named_params: [{ param_name: "name", example: "Ana" }] } },
        { type: "BUTTONS", buttons: [{ type: "URL", text: s.btnFitline, url: `${appUrl()}/f/{{1}}`, example: [`${appUrl()}/f/AbCdEf123456`] }] }],
    });
    out.push({
      lang, name: env("WA_TEMPLATE_OTP"), category: "AUTHENTICATION", language: waLang(lang),
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: s.copy }] },
      ],
    });
  }
  return out;
}

export async function createTemplates() {
  const waba = process.env.KAPSO_WABA_ID;
  if (!waba) throw new HttpError(400, "missing_waba_id");
  let existing = [];
  try { existing = await listTemplates(); } catch { existing = []; }
  const has = new Map(existing.map((x) => [`${x.name}|${x.language}`, x.status]));
  // In parallel: Netlify synchronous functions stop after 10 s.
  return Promise.all(templateDefinitions().map(async (def) => {
    const { lang, ...payload } = def;
    if (has.has(`${def.name}|${def.language}`)) return { name: def.name, language: def.language, ok: true, status: has.get(`${def.name}|${def.language}`), existing: true, error: null };
    try {
      const r = await kapsoPost(`${waba}/message_templates`, payload, 8000);
      return { name: def.name, language: def.language, ok: r.ok, status: r.body?.status || null, error: r.ok ? null : errMsg(r) };
    } catch (e) {
      return { name: def.name, language: def.language, ok: false, status: null, error: e?.name === "TimeoutError" ? "timeout" : String(e?.message || e).slice(0, 200) };
    }
  }));
}

export async function listTemplates() {
  const waba = process.env.KAPSO_WABA_ID;
  const key = process.env.KAPSO_API_KEY;
  if (!waba || !key) throw new HttpError(400, "missing_waba_id");
  let res;
  try { res = await fetch(`${env("KAPSO_API_BASE")}/${waba}/message_templates?fields=name,status,language,category&limit=200`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(8000) }); }
  catch (e) { throw new HttpError(504, "kapso_timeout"); }
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, "kapso_error", { detail: text.slice(0, 300) });
  const j = JSON.parse(text);
  const wanted = new Set([env("WA_TEMPLATE_JOURNEY"), env("WA_TEMPLATE_JOURNEY_OLD"), env("WA_TEMPLATE_FOLLOWUP"), env("WA_TEMPLATE_OTP"), env("WA_TEMPLATE_FU_CONFIRM"), env("WA_TEMPLATE_FITLINE")]);
  return (j.data || []).filter((t) => wanted.has(t.name)).map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category }));
}

/* ---------------- Dates for messages ---------------- */
export function formatFollowup(dateISO, time, lang) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const day = dt.toLocaleDateString(lang === "en" ? "en-GB" : "pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return time ? `${day}, ${time}` : day;
}
export const todayUTC = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
