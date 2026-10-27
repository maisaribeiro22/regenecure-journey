// Web Push (phone notifications) — VAPID keys are generated once and kept in a server-only table.
import webpush from "web-push";
import { db, enc, env } from "./server.mjs";

let cached = null;
export async function getVapid() {
  if (cached) return cached;
  let rows = await db("server_keys?name=eq.vapid&select=value");
  if (!rows.length) {
    const keys = webpush.generateVAPIDKeys();
    await db("server_keys?on_conflict=name", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { name: "vapid", value: keys } });
    rows = await db("server_keys?name=eq.vapid&select=value");
  }
  cached = rows[0].value;
  return cached;
}

export function validSubscription(s) {
  return s && typeof s.endpoint === "string" && /^https?:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && typeof s.keys?.p256dh === "string" && s.keys.p256dh.length < 200 && typeof s.keys?.auth === "string" && s.keys.auth.length < 100;
}

export async function countDevices(clientId) {
  return (await db(`push_subscriptions?client_id=eq.${clientId}&select=endpoint`)).length;
}

// Sends one notification to every device of a client. Expired subscriptions are removed.
export async function pushToClient(clientId, payload) {
  const subs = await db(`push_subscriptions?client_id=eq.${clientId}&select=endpoint,p256dh,auth`);
  if (!subs.length) return { sent: 0, devices: 0 };
  const vapid = await getVapid();
  const options = {
    TTL: 6 * 3600, urgency: "high",
    vapidDetails: { subject: env("VAPID_SUBJECT") || "mailto:support@regenecure.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  };
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), options);
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db(`push_subscriptions?endpoint=eq.${enc(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" });
      } else console.error("push failed", e?.statusCode, String(e?.body || e?.message || e).slice(0, 200));
    }
  }
  return { sent, devices: subs.length };
}
