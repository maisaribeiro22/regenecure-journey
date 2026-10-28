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

// Message time: Kapso sends a Unix epoch string in "timestamp"; older payloads used ISO "created_at".
function when(v) {
  if (v == null || v === "") return null;
  const n = /^\d+(\.\d+)?$/.test(String(v)) ? +v * (+v < 1e12 ? 1000 : 1) : Date.parse(v);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

// Collects inbound messages from Kapso v2 payloads (single or batched) and Meta-format payloads.
// For "whatsapp.message.received" every message is from the customer; elsewhere the direction
// (message.kapso.direction, or message.direction) must say inbound.
function inbound(payload, isReceivedEvent) {
  const found = [];
  const seen = new Set();
  const visit = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) return o.forEach(visit);
    const m = o.message && typeof o.message === "object" ? o.message : null;
    if (m) {
      const dir = String(m.kapso?.direction || m.direction || "").toLowerCase();
      const isIn = dir ? dir === "inbound" || dir === "incoming" : isReceivedEvent;
      if (isIn) found.push({ id: m.id, phone: m.from || m.phone_number || o.conversation?.phone_number, at: when(m.timestamp) || when(m.created_at), type: m.type || m.message_type });
    }
    if (Array.isArray(o.messages) && o.metadata?.phone_number_id) {               // Meta format: entry[].changes[].value
      for (const mm of o.messages) found.push({ id: mm.id, phone: mm.from, at: when(mm.timestamp), type: mm.type });
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
  const event = req.headers.get("x-webhook-event") || "";
  if (!validSignature(raw, req.headers.get("x-webhook-signature"), secret)) {
    console.warn("kapso webhook: invalid signature", event);
    return json({ error: "invalid_signature" }, 401);
  }
  let payload; try { payload = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  let matched = 0;
  const msgs = inbound(payload, event === "whatsapp.message.received");
  for (const m of msgs) {
    const variants = phoneVariants(m.phone);
    if (!variants.length) continue;
    const at = m.at && Date.parse(m.at) <= Date.now() + 60000 ? m.at : new Date().toISOString();
    const rows = await db(`clients?wa_digits=in.(${variants.map(enc).join(",")})&select=id,last_inbound_at`);
    for (const c of rows) {
      if (!c.last_inbound_at || Date.parse(c.last_inbound_at) < Date.parse(at)) {
        await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_inbound_at: at } });
      }
      // Only the message type is kept, never its content (clients may write about their health).
      await logMessage(c.id, "inbound", m.type || null, { ok: true, id: m.id || null });
      matched++;
    }
  }
  console.log(`kapso webhook: ${event || "?"} messages=${msgs.length} matched=${matched}`);
  return json({ ok: true, matched });
};

export const config = { path: "/api/kapso/webhook" };
