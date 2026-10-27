// RegeneCure Journey — document extraction proxy (Netlify Edge Function)
// Admin-only. Receives the uploaded report as base64 text, sends it to the Claude API with a
// forced tool call, and streams the Server-Sent Events back to the browser.
// Edge Functions only count CPU time (50 ms), not time spent waiting on the API,
// and must send response headers within 40 s — streaming satisfies both.

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "text/plain"];
const MAX_B64 = 14_000_000; // about 10 MB of original file

const SYSTEM = `You extract structured data from clinical documents for a regenerative-medicine client journey app.
The document may be a laboratory blood work report, a practitioner protocol, or both combined.
Rules:
- Record only what the document states. Never invent supplements, peptides, doses, dates or results.
- Use null (or an empty array) when a field is absent.
- Dates must be ISO YYYY-MM-DD. Day/month order: assume DD/MM unless the document is clearly US-formatted.
- If a peptide cycle is described relative to the protocol start (e.g. "weeks 3-10", "starting day 15"), fill start_offset_days (0 = first day of protocol) and cycle_length_days instead of guessing calendar dates.
- If a cycle is given as a duration ("8 weeks", "30 days"), convert to cycle_length_days.
- timing uses only these slots: wake (upon waking / fasting), breakfast, lunch, afternoon (incl. pre-workout), dinner (evening), bedtime.
- days_of_week uses mon,tue,wed,thu,fri,sat,sun. "5 on / 2 off" = mon-fri. Leave empty for daily dosing.
- Keep dose strings exactly as written, including units (mcg, mg, IU, mL, units on insulin syringe).
- Biomarker status: compare the value with the reference range in the document; use unknown if no range is given.
- Keep the original language of names and instructions.`;

const SLOTS = ["wake", "breakfast", "lunch", "afternoon", "dinner", "bedtime"];
const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const str = { type: ["string", "null"] };
const int = { type: ["integer", "null"] };

const TOOL = {
  name: "record_journey",
  description: "Record the client, report, biomarker, supplement and peptide data found in the document.",
  input_schema: {
    type: "object",
    properties: {
      patient: {
        type: "object",
        properties: { name: str, date_of_birth: str, sex: str, patient_id: str, phone: { type: ["string", "null"], description: "Client phone/WhatsApp with country code, if stated" } },
      },
      report: {
        type: "object",
        properties: {
          report_date: str,
          laboratory: str,
          practitioner: str,
          summary: { type: ["string", "null"], description: "2-3 sentence clinical summary of the findings and protocol goals" },
        },
      },
      journey_start_date: { type: ["string", "null"], description: "Protocol start date if stated" },
      biomarkers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: str,
            unit: str,
            reference_range: str,
            status: { type: "string", enum: ["low", "normal", "high", "unknown"] },
          },
          required: ["name"],
        },
      },
      supplements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            dose: str,
            form: str,
            frequency: str,
            timing: { type: "array", items: { type: "string", enum: SLOTS } },
            days_of_week: { type: "array", items: { type: "string", enum: DOW } },
            start_date: str,
            duration_days: int,
            instructions: str,
            rationale: str,
          },
          required: ["name"],
        },
      },
      peptides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            dose: str,
            route: { type: "string", enum: ["subcutaneous", "intramuscular", "oral", "sublingual", "nasal", "topical", "other"] },
            frequency: str,
            timing: { type: "array", items: { type: "string", enum: SLOTS } },
            days_of_week: { type: "array", items: { type: "string", enum: DOW } },
            every_n_days: int,
            start_date: str,
            end_date: str,
            start_offset_days: int,
            cycle_length_days: int,
            reconstitution: str,
            instructions: str,
            rationale: str,
          },
          required: ["name"],
        },
      },
      follow_up_notes: str,
    },
    required: ["biomarkers", "supplements", "peptides"],
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function b64ToText(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const SUPABASE_URL = () => Netlify.env.get("SUPABASE_URL") || "https://gfdiwphqxyimckoxuqgs.supabase.co";
const PUBLISHABLE = () => Netlify.env.get("SUPABASE_PUBLISHABLE_KEY") || "sb_publishable_OjPZtrgkLAZ_oMuoI_e4ww_h3uT2_G_";

// Only signed-in administrators may spend extraction credits.
async function verifyAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return "unauthorized";
  const secret = Netlify.env.get("SUPABASE_SECRET_KEY");
  if (!secret) return "missing_supabase_secret";
  const u = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { apikey: PUBLISHABLE(), authorization: auth } });
  if (!u.ok) return "unauthorized";
  const user = await u.json();
  if (!user?.id) return "unauthorized";
  const a = await fetch(`${SUPABASE_URL()}/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id`, { headers: { apikey: secret } });
  if (!a.ok) return "unauthorized";
  return (await a.json()).length ? "ok" : "forbidden";
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "missing_api_key" }, 500);

  const who = await verifyAdmin(req);
  if (who !== "ok") return json({ error: who }, who === "forbidden" ? 403 : 401);

  const mediaType = (req.headers.get("x-media-type") || "").toLowerCase();
  if (!ALLOWED.includes(mediaType)) return json({ error: "unsupported_type" }, 415);

  const data = (await req.text()).trim();
  if (!data) return json({ error: "empty_file" }, 400);
  if (data.length > MAX_B64) return json({ error: "file_too_large" }, 413);

  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.headers.get("x-today") || "") ? req.headers.get("x-today") : new Date().toISOString().slice(0, 10);

  let block;
  if (mediaType === "application/pdf") block = { type: "document", source: { type: "base64", media_type: mediaType, data } };
  else if (mediaType.startsWith("image/")) block = { type: "image", source: { type: "base64", media_type: mediaType, data } };
  else block = { type: "document", source: { type: "text", media_type: "text/plain", data: b64ToText(data) } };

  const body = JSON.stringify({
    model: Netlify.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
    max_tokens: 8000,
    stream: true,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_journey" },
    messages: [
      {
        role: "user",
        content: [block, { type: "text", text: `Today's date is ${today}. Extract the client journey data from this document with the record_journey tool.` }],
      },
    ],
  });

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body,
  });

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 600);
    return json({ error: "upstream_error", status: upstream.status, detail }, 502);
  }

  return new Response(upstream.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/extract" };
