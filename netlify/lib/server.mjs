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
  WA_TEMPLATE_JOURNEY: "jornada_pronta",
  WA_TEMPLATE_FOLLOWUP: "lembrete_followup",
  WA_TEMPLATE_OTP: "codigo_acesso",
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
  return sendTemplate({
    to: c.whatsapp, name: env("WA_TEMPLATE_JOURNEY"), lang: c.lang,
    components: [
      { type: "body", parameters: [{ type: "text", parameter_name: "name", text: firstName(c.name) }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.access_token }] },
    ],
  });
}
export async function sendFollowup(c, n) {
  const date = (c.followup_dates || [])[n - 1];
  if (!date) return { ok: false, error: "no_date" };
  return sendTemplate({
    to: c.whatsapp, name: env("WA_TEMPLATE_FOLLOWUP"), lang: c.lang,
    components: [
      { type: "body", parameters: [
        { type: "text", parameter_name: "name", text: firstName(c.name) },
        { type: "text", parameter_name: "date", text: formatFollowup(date, c.data?.followUpTime || "", c.lang) },
      ] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.access_token }] },
    ],
  });
}

/* ---------------- Templates (shared by sending and creation) ---------------- */
export function templateDefinitions() {
  const url = `${appUrl()}/c/{{1}}`;
  const sampleUrl = `${appUrl()}/c/AbCdEf123456`;
  const tx = {
    pt: {
      journey: "Olá, {{name}}. Seu protocolo RegeneCure foi publicado no seu painel pessoal, com suplementos, peptídeos e datas de follow-up. Acesse pelo botão abaixo.",
      followup: "Olá, {{name}}. Lembrete: seu follow-up RegeneCure está agendado para {{date}}. Os detalhes do protocolo estão no seu painel.",
      btn: "Abrir meu painel", copy: "Copiar código", date: "13 de novembro, 10:00",
    },
    en: {
      journey: "Hello {{name}}. Your RegeneCure protocol has been published to your personal dashboard, including supplements, peptides and follow-up dates. Open it with the button below.",
      followup: "Hello {{name}}. Reminder: your RegeneCure follow-up is scheduled for {{date}}. Your protocol details are in your dashboard.",
      btn: "Open my dashboard", copy: "Copy code", date: "13 November, 10:00",
    },
  };
  const out = [];
  for (const lang of ["pt", "en"]) {
    const s = tx[lang];
    const button = { type: "BUTTONS", buttons: [{ type: "URL", text: s.btn, url, example: [sampleUrl] }] };
    out.push({
      lang, name: env("WA_TEMPLATE_JOURNEY"), category: "UTILITY", language: waLang(lang), parameter_format: "NAMED",
      components: [{ type: "BODY", text: s.journey, example: { body_text_named_params: [{ param_name: "name", example: "Ana" }] } }, button],
    });
    out.push({
      lang, name: env("WA_TEMPLATE_FOLLOWUP"), category: "UTILITY", language: waLang(lang), parameter_format: "NAMED",
      components: [{ type: "BODY", text: s.followup, example: { body_text_named_params: [{ param_name: "name", example: "Ana" }, { param_name: "date", example: s.date }] } }, button],
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
  // In parallel: Netlify synchronous functions stop after 10 s.
  return Promise.all(templateDefinitions().map(async (def) => {
    const { lang, ...payload } = def;
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
  const wanted = new Set([env("WA_TEMPLATE_JOURNEY"), env("WA_TEMPLATE_FOLLOWUP"), env("WA_TEMPLATE_OTP")]);
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
