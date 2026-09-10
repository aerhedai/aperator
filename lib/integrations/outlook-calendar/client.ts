const GRAPH_ME_BASE = "https://graph.microsoft.com/v1.0/me";

// v1 simplification: every date/time this module sends or reads is UTC.
// Real per-business timezone configuration is a real follow-up, not
// something guessed at here — see CLAUDE.md #30 on not over-building
// ahead of an actual need.
const TIME_ZONE = "UTC";

async function graphFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${GRAPH_ME_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Microsoft Graph request to ${path} failed (${response.status}): ${body}`,
    );
  }
  return response;
}

function attendeeList(emails: string[]) {
  return emails.map((address) => ({
    emailAddress: { address },
    type: "required",
  }));
}

export interface MeetingTimeSuggestion {
  start: string;
  end: string;
  confidence: number;
}

interface FindMeetingTimesResponse {
  meetingTimeSuggestions: {
    confidence: number;
    meetingTimeSlot: {
      start: { dateTime: string };
      end: { dateTime: string };
    };
  }[];
}

export async function findMeetingTimes(
  accessToken: string,
  params: {
    attendees: string[];
    durationMinutes: number;
    rangeStart: string;
    rangeEnd: string;
  },
): Promise<MeetingTimeSuggestion[]> {
  const response = await graphFetch(accessToken, "/findMeetingTimes", {
    method: "POST",
    body: JSON.stringify({
      attendees: attendeeList(params.attendees),
      timeConstraint: {
        timeslots: [
          {
            start: { dateTime: params.rangeStart, timeZone: TIME_ZONE },
            end: { dateTime: params.rangeEnd, timeZone: TIME_ZONE },
          },
        ],
      },
      meetingDuration: `PT${params.durationMinutes}M`,
    }),
  });
  const data = (await response.json()) as FindMeetingTimesResponse;
  return data.meetingTimeSuggestions.map((s) => ({
    start: s.meetingTimeSlot.start.dateTime,
    end: s.meetingTimeSlot.end.dateTime,
    confidence: s.confidence,
  }));
}

export async function createCalendarEvent(
  accessToken: string,
  params: {
    subject: string;
    start: string;
    end: string;
    attendees: string[];
  },
): Promise<{ id: string }> {
  const response = await graphFetch(accessToken, "/events", {
    method: "POST",
    body: JSON.stringify({
      subject: params.subject,
      start: { dateTime: params.start, timeZone: TIME_ZONE },
      end: { dateTime: params.end, timeZone: TIME_ZONE },
      attendees: attendeeList(params.attendees),
    }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

// Partial update — only the fields actually supplied are sent, so
// updating just the time doesn't accidentally clear the subject or
// attendee list. Attendees are notified of the change automatically by
// Graph, same as on create, which is why this is approval-gated too.
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  params: {
    subject?: string;
    start?: string;
    end?: string;
    attendees?: string[];
  },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (params.subject !== undefined) body.subject = params.subject;
  if (params.start !== undefined) {
    body.start = { dateTime: params.start, timeZone: TIME_ZONE };
  }
  if (params.end !== undefined) {
    body.end = { dateTime: params.end, timeZone: TIME_ZONE };
  }
  if (params.attendees !== undefined) {
    body.attendees = attendeeList(params.attendees);
  }
  await graphFetch(accessToken, `/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Graph's /cancel action sends a cancellation message to every attendee
// and removes the event — the correct way to call off a meeting, unlike a
// plain DELETE which silently removes it from the organiser's calendar
// without telling anyone it invited. Hard to undo once attendees have
// been told, which is why this is approval-gated.
export async function cancelCalendarEvent(
  accessToken: string,
  eventId: string,
  comment?: string,
): Promise<void> {
  await graphFetch(accessToken, `/events/${eventId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ comment: comment ?? "" }),
  });
}

export interface CalendarEventSummary {
  id: string;
  subject: string;
  start: string;
  end: string;
}

interface GraphCalendarEvent {
  id: string;
  subject?: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

// calendarView (not /events) expands recurring events into their actual
// occurrences within the range — the right endpoint for "what's actually
// on the calendar this week," not just the recurrence master.
export async function listCalendarEvents(
  accessToken: string,
  params: { start: string; end: string },
): Promise<CalendarEventSummary[]> {
  const query = new URLSearchParams({
    startDateTime: params.start,
    endDateTime: params.end,
    $orderby: "start/dateTime",
  });
  const response = await graphFetch(
    accessToken,
    `/calendarView?${query.toString()}`,
  );
  const data = (await response.json()) as { value: GraphCalendarEvent[] };
  return data.value.map((event) => ({
    id: event.id,
    subject: event.subject ?? "",
    start: event.start.dateTime,
    end: event.end.dateTime,
  }));
}
