// Practitioner-only API: sending WhatsApp templates, link rotation, setup checks.
import {
  handle, json, readJson, HttpError, db, enc, requireAdmin, logMessage, sendJourney, sendFollowup,
  waDigits, env, appUrl, createTemplates, listTemplates, kapsoConfigured, randomToken,
} from "../lib/server.mjs";

const COLS = "id,name,whatsapp,lang,status,access_token,data,followup_dates,reminders_sent,published_at";

async function loadClient(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new HttpError(400, "invalid_client");
  const rows = await db(`clients?id=eq.${enc(id)}&select=${COLS}`);
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

const ACTIONS = {
  // POST {client_id, kind: 'journey'|'followup', n?}
  async send(req) {
    const { client_id, kind, n } = await readJson(req);
    const c = await loadClient(client_id);
    if (!waDigits(c.whatsapp)) throw new HttpError(409, "no_whatsapp");
    if (!kapsoConfigured()) throw new HttpError(503, "whatsapp_not_configured");
    if (kind === "journey") {
      if (!c.data?.s1Confirmed) throw new HttpError(409, "not_reviewed");
      const r = await sendJourney(c);
      await logMessage(c.id, "journey", env("WA_TEMPLATE_JOURNEY"), r);
      if (!r.ok) throw new HttpError(502, "send_failed", { detail: r.error });
      const now = new Date().toISOString();
      await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "published", published_at: c.published_at || now, last_sent_at: now } });
      return json({ ok: true, id: r.id, sent_at: now });
    }
    if (kind === "followup") {
      const num = parseInt(n, 10);
      if (!(num >= 1)) throw new HttpError(400, "invalid_n");
      if (c.status !== "published") throw new HttpError(409, "not_published");
      const r = await sendFollowup(c, num);
      await logMessage(c.id, "followup", r.template || env("WA_TEMPLATE_FOLLOWUP"), r);
      if (!r.ok) throw new HttpError(502, "send_failed", { detail: r.error });
      const sent = [...new Set([...(c.reminders_sent || []), num])];
      await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { reminders_sent: sent } });
      return json({ ok: true, id: r.id });
    }
    throw new HttpError(400, "invalid_kind");
  },

  // POST {client_id} → new link; old link and all client sessions stop working
  async "rotate-link"(req) {
    const { client_id } = await readJson(req);
    const c = await loadClient(client_id);
    const token = randomToken(18);
    await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { access_token: token } });
    await db(`client_sessions?client_id=eq.${c.id}`, { method: "DELETE", prefer: "return=minimal" });
    return json({ ok: true, access_token: token });
  },

  // GET → which pieces of the setup are in place (no secret values are returned)
  async health() {
    return json({
      ok: true,
      app_url: appUrl(),
      supabase_secret: !!process.env.SUPABASE_SECRET_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      kapso_key: !!process.env.KAPSO_API_KEY,
      kapso_phone: env("KAPSO_PHONE_NUMBER_ID"),
      kapso_waba: !!process.env.KAPSO_WABA_ID,
      templates: { journey: env("WA_TEMPLATE_JOURNEY"), followup: env("WA_TEMPLATE_FOLLOWUP"), otp: env("WA_TEMPLATE_OTP"), pt: env("WA_LANG_PT"), en: env("WA_LANG_EN") },
    });
  },

  async "templates-create"() { return json({ ok: true, results: await createTemplates() }); },
  async "templates-status"() { return json({ ok: true, templates: await listTemplates() }); },
};

const METHODS = { send: "POST", "rotate-link": "POST", health: "GET", "templates-create": "POST", "templates-status": "GET" };

export default handle(async (req, context) => {
  const action = context?.params?.action || new URL(req.url).pathname.split("/").pop();
  const fn = ACTIONS[action];
  if (!fn) return json({ error: "not_found" }, 404);
  if (req.method !== METHODS[action]) return json({ error: "method_not_allowed" }, 405);
  await requireAdmin(req);
  return fn(req);
});

export const config = { path: "/api/admin/:action" };
