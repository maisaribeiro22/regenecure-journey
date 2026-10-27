// Daily at 12:00 UTC (16:00 Dubai, 09:00 Brasília): WhatsApp reminder for follow-ups due tomorrow.
import { db, dbAll, sendFollowup, logMessage, env, todayUTC, waDigits, kapsoConfigured } from "../lib/server.mjs";

export default async () => {
  if (!process.env.SUPABASE_SECRET_KEY || !kapsoConfigured()) {
    console.log("reminders skipped: missing configuration");
    return;
  }
  const settings = (await db("app_settings?id=eq.1&select=auto_reminders"))[0];
  if (settings && settings.auto_reminders === false) { console.log("reminders disabled"); return; }

  const tomorrow = todayUTC(1);
  const clients = await dbAll(`clients?status=eq.published&followup_dates=cs.{${tomorrow}}&select=id,name,whatsapp,lang,access_token,data,followup_dates,reminders_sent`);
  let sent = 0;
  for (const c of clients) {
    const n = (c.followup_dates || []).indexOf(tomorrow) + 1;
    if (n < 1 || (c.reminders_sent || []).includes(n) || c.data?.followups?.[n]?.done || !waDigits(c.whatsapp)) continue;
    const r = await sendFollowup(c, n);
    await logMessage(c.id, "followup_auto", env("WA_TEMPLATE_FOLLOWUP"), r);
    if (r.ok) {
      sent++;
      await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { reminders_sent: [...(c.reminders_sent || []), n] } });
    }
  }
  console.log(`reminders: ${sent}/${clients.length} sent for ${tomorrow}`);
};

export const config = { schedule: "0 12 * * *" };
