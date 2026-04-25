import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN });

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const CALENDAR_ID  = "info@wine-whiskey.com";
const PAVEL_EMAIL  = "pavelrasputin@gmail.com";
const IRINA_EMAIL  = "i@wine-whiskey.com";
const TIMEZONE     = "Asia/Bangkok";

export interface CalendarEventParams {
  title:            string;
  date:             string;       // YYYY-MM-DD
  time?:            string;       // HH:MM (если не указано — весь день)
  duration_minutes?: number;      // default 60
  attendees?:       ("pavel" | "irina")[];
  description?:     string;
  location?:        string;
}

export async function addCalendarEvent(params: CalendarEventParams): Promise<string> {
  if (!process.env.GOOGLE_CALENDAR_REFRESH_TOKEN) {
    return JSON.stringify({ ok: false, error: "GOOGLE_CALENDAR_REFRESH_TOKEN не задан" });
  }
  const { title, date, time, duration_minutes = 60, attendees = [], description, location } = params;

  const attendeeList: { email: string }[] = [];
  if (attendees.includes("pavel")) attendeeList.push({ email: PAVEL_EMAIL });
  if (attendees.includes("irina")) attendeeList.push({ email: IRINA_EMAIL });

  let start: object;
  let end: object;

  if (time) {
    const startDt = `${date}T${time}:00`;
    const startMs = new Date(`${date}T${time}:00+07:00`).getTime();
    const endMs   = startMs + duration_minutes * 60_000;
    const endDt   = new Date(endMs).toISOString().replace("Z", "+07:00").slice(0, 19) + "+07:00";
    start = { dateTime: startDt, timeZone: TIMEZONE };
    end   = { dateTime: endDt,   timeZone: TIMEZONE };
  } else {
    start = { date };
    end   = { date };
  }

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    sendUpdates: attendeeList.length > 0 ? "all" : "none",
    requestBody: {
      summary:     title,
      description: description ?? undefined,
      location:    location ?? undefined,
      start,
      end,
      attendees:   attendeeList.length > 0 ? attendeeList : undefined,
    },
  });

  const link = event.data.htmlLink ?? "";
  return JSON.stringify({ ok: true, event_id: event.data.id, link });
}
