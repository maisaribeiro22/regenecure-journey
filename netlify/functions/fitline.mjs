// https://jornada.regenecure.com/f/<client token> → current FitLine link (set in Settings), click recorded.
import { db, enc, logMessage } from "../lib/server.mjs";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export default async (req, context) => {
  const token = context?.params?.token || new URL(req.url).pathname.split("/").pop();
  try {
    const settings = (await db("app_settings?id=eq.1&select=fitline_url,shop_url"))[0] || {};
    const target = settings.fitline_url || settings.shop_url || "https://regenecure.com";
    if (TOKEN_RE.test(token || "")) {
      const c = (await db(`clients?access_token=eq.${enc(token)}&select=id`))[0];
      if (c) await logMessage(c.id, "fitline_click", null, { ok: true });
    }
    return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (e) {
    console.error(e);
    return new Response(null, { status: 302, headers: { location: "https://regenecure.com" } });
  }
};

export const config = { path: "/f/:token" };
