// Runs every hour. For each published client, in the client's own time zone:
//  · follow-up reminder at FOLLOWUP_REMINDER_HOUR (default 10:00) on the day before the appointment;
//  · daily peptide reminder at the hour the client chose, on days with a scheduled peptide dose.
import {
  db, dbAll, env, waDigits, kapsoConfigured, logMessage, sendFollowup, sendPeptideReminder,
  peptidesOn, localNow, validTz, defaultTz, addDaysISO,
} from "../lib/server.mjs";

export async function runReminders(now = new Date()) {
  if (!process.env.SUPABASE_SECRET_KEY || !kapsoConfigured()) return { skipped: "missing configuration" };
  const settings = (await db("app_settings?id=eq.1&select=auto_reminders,peptide_alerts"))[0] || {};
  const fuOn = settings.auto_reminders !== false;
  const pepOn = settings.peptide_alerts !== false;
  const fuHour = parseInt(env("FOLLOWUP_REMINDER_HOUR"), 10);
  const clients = await dbAll("clients?status=eq.published&whatsapp=not.is.null&select=id,name,whatsapp,lang,access_token,data,progress,followup_dates,reminders_sent,tz,last_pep_alert");
  const out = { followups: 0, peptides: 0, clients: clients.length };

  for (const c of clients) {
    if (!waDigits(c.whatsapp)) continue;
    const pa = c.progress?.pepAlert || {};
    const tz = [c.tz, pa.tz].find(validTz) || defaultTz(c.lang);
    const { date, hour } = localNow(tz, now);

    if (fuOn && hour === fuHour) {
      const tomorrow = addDaysISO(date, 1);
      const n = (c.followup_dates || []).indexOf(tomorrow) + 1;
      if (n > 0 && !(c.reminders_sent || []).includes(n) && !c.data?.followups?.[n]?.done) {
        const r = await sendFollowup(c, n);
        await logMessage(c.id, "followup_auto", r.template, r);
        if (r.ok) {
          out.followups++;
          await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { reminders_sent: [...(c.reminders_sent || []), n] } });
        }
      }
    }

    if (pepOn && pa.on === true && hour === pa.hour && c.last_pep_alert !== date) {
      const list = peptidesOn(c.data, date);
      if (list.length) {
        const r = await sendPeptideReminder(c, list);
        await logMessage(c.id, "peptide_daily", env("WA_TEMPLATE_PEPTIDE"), r);
        if (r.ok) out.peptides++;
      }
      // Mark the day as handled even on rest days, so the job does not retry every hour.
      await db(`clients?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_pep_alert: date } });
    }
  }
  return out;
}

export default async () => {
  const out = await runReminders();
  console.log("reminders", JSON.stringify(out));
};

export const config = { schedule: "0 * * * *" };
