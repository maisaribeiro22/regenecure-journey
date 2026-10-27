// Client-facing API: login by link + WhatsApp code, journey data, dose check-ins.
// Clients never receive database credentials; every call is checked here.
import {
  handle, json, readJson, HttpError, db, dbAll, enc, hashSecret, randomToken, randomCode, safeEqual,
  sendOtp, logMessage, maskPhone, waDigits, requireAdmin, signedReportUrl, todayUTC, kapsoConfigured, validTz,
} from "../lib/server.mjs";

const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const KEY_RE = /^(\d{4}-\d{2}-\d{2})\|[sp]:[A-Za-z0-9_-]{1,40}\|(wake|breakfast|lunch|afternoon|dinner|bedtime)$/;
const BADGES = ["baseline", "protocol", "calendar", "streak7", "streak21", "adh90", "cycle", "fu1"];
const CLIENT_COLS = "id,name,whatsapp,lang,status,access_token,data,progress,journey_start,followup_dates,published_at,tz";

async function clientByToken(token, { publishedOnly = true } = {}) {
  if (!TOKEN_RE.test(token || "")) throw new HttpError(404, "not_found");
  const rows = await db(`clients?access_token=eq.${enc(token)}&select=${CLIENT_COLS}`);
  const c = rows[0];
  if (!c || (publishedOnly && c.status !== "published")) throw new HttpError(404, "not_found");
  return c;
}

async function sessionClient(req) {
  const tok = req.headers.get("x-session") || "";
  if (!tok || tok.length > 100) throw new HttpError(401, "no_session");
  const nowIso = new Date().toISOString();
  const rows = await db(`client_sessions?token_hash=eq.${enc(hashSecret(tok, "session"))}&expires_at=gt.${enc(nowIso)}&select=client_id,clients(${CLIENT_COLS})`);
  const c = rows[0]?.clients;
  if (!c || c.status !== "published") throw new HttpError(401, "no_session");
  return c;
}

const ACTIONS = {
  // POST {token} → sends a 6-digit code to the client's WhatsApp
  async "request-code"(req) {
    const { token } = await readJson(req);
    const c = await clientByToken(token);
    if (!waDigits(c.whatsapp)) throw new HttpError(409, "no_whatsapp");
    if (!kapsoConfigured()) throw new HttpError(503, "whatsapp_not_configured");
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const recent = await db(`otp_codes?client_id=eq.${c.id}&created_at=gt.${enc(since)}&select=created_at&order=created_at.desc`);
    if (recent.length >= 4) throw new HttpError(429, "too_many_codes", { retry_after: 900 });
    if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 45000) throw new HttpError(429, "wait", { retry_after: 45 });
    const code = randomCode();
    await db("otp_codes", { method: "POST", prefer: "return=minimal", body: {
      client_id: c.id, code_hash: hashSecret(`${c.id}:${code}`, "otp"), expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString(),
    } });
    const r = await sendOtp({ to: c.whatsapp, lang: c.lang, code });
    await logMessage(c.id, "otp", "otp", r);
    if (!r.ok) throw new HttpError(502, "send_failed");
    return json({ ok: true, to: maskPhone(c.whatsapp), minutes: CODE_MINUTES });
  },

  // POST {token, code} → {session}
  async verify(req) {
    const { token, code } = await readJson(req);
    const c = await clientByToken(token);
    if (!/^\d{6}$/.test(String(code || ""))) throw new HttpError(400, "invalid_code");
    const nowIso = new Date().toISOString();
    const rows = await db(`otp_codes?client_id=eq.${c.id}&used=is.false&expires_at=gt.${enc(nowIso)}&select=id,code_hash,attempts&order=created_at.desc&limit=1`);
    const otp = rows[0];
    if (!otp) throw new HttpError(401, "code_expired");
    if (otp.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "too_many_attempts");
    if (!safeEqual(otp.code_hash, hashSecret(`${c.id}:${code}`, "otp"))) {
      await db(`otp_codes?id=eq.${otp.id}`, { method: "PATCH", prefer: "return=minimal", body: { attempts: otp.attempts + 1 } });
      throw new HttpError(401, "wrong_code", { left: Math.max(0, MAX_ATTEMPTS - otp.attempts - 1) });
    }
    await db(`otp_codes?id=eq.${otp.id}`, { method: "PATCH", prefer: "return=minimal", body: { used: true } });
    const session = randomToken(32);
    await db("client_sessions", { method: "POST", prefer: "return=minimal", body: {
      token_hash: hashSecret(session, "session"), client_id: c.id,
      expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
      user_agent: (req.headers.get("user-agent") || "").slice(0, 200),
    } });
    return json({ ok: true, session, days: SESSION_DAYS });
  },

  // GET → journey for the session's client. Admin preview: Authorization + ?token=
  async journey(req) {
    const url = new URL(req.url);
    let c, preview = false;
    if (req.headers.get("authorization")) {
      await requireAdmin(req);
      c = await clientByToken(url.searchParams.get("token"), { publishedOnly: false });
      preview = true;
    } else {
      c = await sessionClient(req);
      const pathToken = url.searchParams.get("token");
      if (pathToken && pathToken !== c.access_token) throw new HttpError(401, "no_session");
      const tz = req.headers.get("x-tz");
      const patch = { last_seen_at: new Date().toISOString() };
      if (validTz(tz) && tz !== c.tz) patch.tz = tz;
      await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: patch });
    }
    const [logs, settings] = await Promise.all([
      dbAll(`dose_logs?client_id=eq.${c.id}&select=dose_key&order=dose_key`),
      db("app_settings?id=eq.1&select=shop_url,fitline_url"),
    ]);
    const { access_token, whatsapp, tz: _tz, ...safe } = c;
    return json({ ok: true, preview, client: safe, checks: logs.map((l) => l.dose_key), settings: settings[0] || {} });
  },

  // POST {key, on}
  async check(req) {
    const c = await sessionClient(req);
    const { key, on } = await readJson(req);
    const m = KEY_RE.exec(String(key || ""));
    if (!m) throw new HttpError(400, "invalid_key");
    if (m[1] > todayUTC(1)) throw new HttpError(400, "future_day");
    if (on) await db("dose_logs?on_conflict=client_id,dose_key", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { client_id: c.id, dose_key: key } });
    else await db(`dose_logs?client_id=eq.${c.id}&dose_key=eq.${enc(key)}`, { method: "DELETE", prefer: "return=minimal" });
    return json({ ok: true });
  },

  // POST {confirmed:{s2,s3,s4}, seenBadges:[], lastLevel}
  async progress(req) {
    const c = await sessionClient(req);
    const body = await readJson(req);
    const cur = c.progress || {};
    const next = { ...cur, confirmed: { ...(cur.confirmed || {}) } };
    for (const k of ["s2", "s3", "s4"]) if (body?.confirmed?.[k] === true) next.confirmed[k] = true;
    if (Array.isArray(body?.seenBadges)) next.seenBadges = [...new Set([...(cur.seenBadges || []), ...body.seenBadges.filter((b) => BADGES.includes(b))])];
    if (Number.isInteger(body?.lastLevel) && body.lastLevel >= 0 && body.lastLevel <= 5) next.lastLevel = Math.max(cur.lastLevel || 0, body.lastLevel);
    // Follow-up attendance: { "<n>": "confirmed" | "reschedule" }
    if (body?.fuConfirm && typeof body.fuConfirm === "object") {
      const fc = { ...(cur.fuConfirm || {}) };
      for (const [k, v] of Object.entries(body.fuConfirm)) {
        const n = parseInt(k, 10);
        if (n >= 1 && n <= 60 && (v === "confirmed" || v === "reschedule") && fc[n]?.status !== v) fc[n] = { status: v, at: new Date().toISOString() };
      }
      next.fuConfirm = fc;
    }
    // Daily peptide reminder: { on, hour (5–22), tz }
    if (body?.pepAlert && typeof body.pepAlert === "object") {
      const h = parseInt(body.pepAlert.hour, 10);
      next.pepAlert = {
        on: body.pepAlert.on === true,
        hour: h >= 5 && h <= 22 ? h : (cur.pepAlert?.hour ?? 8),
        tz: validTz(body.pepAlert.tz) ? body.pepAlert.tz : (cur.pepAlert?.tz || null),
      };
    }
    await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { progress: next } });
    return json({ ok: true, progress: next });
  },

  // GET → short-lived link to the latest uploaded report file
  async report(req) {
    const c = await sessionClient(req);
    const paths = c.data?.report?.storagePaths || [];
    const path = paths[paths.length - 1];
    if (!path || !path.startsWith(`${c.id}/`)) throw new HttpError(404, "no_file");
    return json({ ok: true, url: await signedReportUrl(path) });
  },

  async logout(req) {
    const tok = req.headers.get("x-session") || "";
    if (tok) await db(`client_sessions?token_hash=eq.${enc(hashSecret(tok, "session"))}`, { method: "DELETE", prefer: "return=minimal" });
    return json({ ok: true });
  },
};

const METHODS = { "request-code": "POST", verify: "POST", journey: "GET", check: "POST", progress: "POST", report: "GET", logout: "POST" };

export default handle(async (req, context) => {
  const action = context?.params?.action || new URL(req.url).pathname.split("/").pop();
  const fn = ACTIONS[action];
  if (!fn) return json({ error: "not_found" }, 404);
  if (req.method !== METHODS[action]) return json({ error: "method_not_allowed" }, 405);
  return fn(req);
});

export const config = { path: "/api/client/:action" };
