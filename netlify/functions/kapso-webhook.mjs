// Kapso webhook (event "Message received"): records when each client last wrote to the
// WhatsApp Business number, so the platform knows whether the 24 h service window is open.
import crypto from "node:crypto";
import { db, enc, json, logMessage, phoneVariants } from "../lib/server.mjs";

function validSignature(raw, header, secret) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(String(header).trim()), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Collects inbound messages from Kapso v2 payloads (single or batched) and Meta-format payloads.
function inbound(payload) {
  const found = [];
  const seen = new Set();
  const visit = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) return o.forEach(visit);
    const m = o.message && typeof o.message === "object" ? o.message : null;
    if (m && (m.direction === "inbound" || m.direction === "incoming")) {
      found.push({ id: m.id, phone: m.phone_number || o.conversation?.phone_number || m.from, at: m.created_at || m.timestamp, type: m.message_type || m.type });
    }
    if (Array.isArray(o.messages) && o.metadata?.phone_number_id) {               // Meta format: entry[].changes[].value
      for (const mm of o.messages) found.push({ id: mm.id, phone: mm.from, at: mm.timestamp ? new Date(+mm.timestamp * 1000).toISOString() : null, type: mm.type });
    }
    Object.values(o).forEach(visit);
  };
  visit(payload);
  const ids = new Set();
  return found.filter((x) => x.phone && (!x.id || (!ids.has(x.id) && ids.add(x.id))));
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook_not_configured" }, 503);
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-webhook-signature"), secret)) return json({ error: "invalid_signature" }, 401);
  let payload; try { payload = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  let matched = 0;
  for (const m of inbound(payload)) {
    const variants = phoneVariants(m.phone);
    if (!variants.length) continue;
    const at = m.at && !isNaN(Date.parse(m.at)) ? new Date(m.at).toISOString() : new Date().toISOString();
    const rows = await db(`clients?wa_digits=in.(${variants.map(enc).join(",")})&select=id,last_inbound_at`);
    for (const c of rows) {
      if (!c.last_inbound_at || c.last_inbound_at < at) {
        await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_inbound_at: at } });
      }
      // Only the message type is kept, never its content (clients may write about their health).
      await logMessage(c.id, "inbound", m.type || null, { ok: true, id: m.id || null });
      matched++;
    }
  }
  return json({ ok: true, matched });
};

export const config = { path: "/api/kapso/webhook" };
