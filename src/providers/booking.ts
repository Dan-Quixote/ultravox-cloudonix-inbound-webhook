/**
 * Fetch caller context (booking history + availability) from the shared booking tools worker.
 * Replaces the external n8n lookup — all data comes from one source.
 *
 * Two parallel requests:
 *   1. get-bookings — upcoming bookings for this phone number (caller history)
 *   2. check-availability — today plus the next 6 days of slots (pre-cached for the agent)
 *
 * Both have a 3s timeout. Failures are non-fatal — the call proceeds with partial context.
 * Requests go through the BOOKING_TOOLS service binding: a plain fetch to the
 * booking worker's workers.dev URL is blocked by Cloudflare (same-account 404).
 */

/** fetch, or a service binding's fetch */
export type BookingFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Days of availability injected: today plus the next 6 days, weekends included */
const AVAILABILITY_DAYS = 7;

interface BookingHistoryResult {
  callerName: string;
  callerHistory: string;
}

interface AvailabilityResult {
  availability: string;
}

/**
 * Look up caller's upcoming bookings by phone number.
 * Returns the caller's name (from their last booking) and a formatted history string.
 */
async function fetchBookingHistory(
  bookingFetch: BookingFetch,
  baseUrl: string,
  orgId: string,
  phone: string,
  timezone: string,
  signingSecret: string,
  callId: string,
): Promise<BookingHistoryResult> {
  try {
    const body = JSON.stringify({ phoneNumber: phone });
    const res = await bookingFetch(`${baseUrl}/get-bookings?organization_id=${orgId}`, {
      method: 'POST',
      headers: await createBookingToolHeaders(signingSecret, orgId, 'get-bookings', callId),
      body,
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      console.warn(`[booking] get-bookings returned ${res.status}`);
      return { callerName: '', callerHistory: '' };
    }

    const data = (await res.json()) as {
      success: boolean;
      count: number;
      bookings: Array<{
        uid: string;
        title: string;
        attendeeName: string;
        startTime: string;
        endTime: string;
        status: string;
      }>;
    };

    if (!data.success || data.count === 0) {
      return { callerName: '', callerHistory: '' };
    }

    // Extract name from most recent booking
    const name = data.bookings[0]?.attendeeName || '';

    // Format history as concise lines with booking UIDs for cancel/reschedule
    const history = data.bookings
      .slice(0, 5) // max 5 bookings in context
      .map((b) => {
        // startTime is already in local timezone from the booking worker
        // e.g. "2026-03-10T10:00:00+01:00"
        const dt = new Date(b.startTime);
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(dt);
        // "Private Tour between Ray Winston and John Hamilton" → "Private Tour"
        const service = b.title.split(' between ')[0];
        return `${service} - ${formatted} [uid:${b.uid}]`;
      })
      .join('; ');

    return {
      callerName: name.split(' ')[0], // first name only
      callerHistory: history || '',
    };
  } catch (err) {
    console.warn(`[booking] History lookup failed:`, err instanceof Error ? err.message : err);
    return { callerName: '', callerHistory: '' };
  }
}

/**
 * Fetch availability for today plus the next 6 days.
 * Returns a compact string for injection into the agent's context, e.g.
 * "Mon 12 Oct: 06:00-21:30 every 30m | Sat 17 Oct: none". Every day gets a
 * line, so the agent can copy weekday labels instead of computing them.
 */
async function fetchAvailability(
  bookingFetch: BookingFetch,
  baseUrl: string,
  orgId: string,
  timezone: string,
  signingSecret: string,
  callId: string,
): Promise<AvailabilityResult> {
  try {
    const dates = getUpcomingDates(AVAILABILITY_DAYS, timezone);

    // Fetch all dates in parallel
    const results = await Promise.all(
      dates.map(async (date) => {
        try {
          const body = JSON.stringify({ date });
          const res = await bookingFetch(`${baseUrl}/check-availability?organization_id=${orgId}`, {
            method: 'POST',
            headers: await createBookingToolHeaders(
              signingSecret,
              orgId,
              'check-availability',
              callId,
            ),
            body,
            signal: AbortSignal.timeout(3000),
          });

          if (!res.ok) {
            console.warn(`[booking] check-availability ${date} returned ${res.status}`);
            return null;
          }

          const data = (await res.json()) as {
            success: boolean;
            date: string;
            availableSlots: string[];
            count: number;
            note?: string;
          };

          if (!data.success) return null;

          return `${formatDayLabel(date)}: ${formatSlotRanges(data.availableSlots ?? [])}`;
        } catch (err) {
          console.warn(
            `[booking] check-availability ${date} failed:`,
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      }),
    );

    const availability = results.filter(Boolean).join(' | ');
    return { availability };
  } catch (err) {
    console.warn(`[booking] Availability fetch failed:`, err instanceof Error ? err.message : err);
    return { availability: '' };
  }
}

/**
 * Get today plus the following dates in the organisation's timezone (YYYY-MM-DD).
 */
export function getUpcomingDates(count: number, timezone: string, now: Date = new Date()): string[] {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const dates: string[] = [];
  const cursor = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** "2026-10-12" → "Mon 12 Oct" (calendar date, so no timezone shift) */
export function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(',', '');
}

/**
 * Collapse slot start times into ranges to keep the SIP headers small.
 * Slots are local-time ISO strings like "2026-10-12T10:00:00+01:00".
 * ["10:00","10:30","11:00","14:00"] → "10:00-11:00, 14:00 every 30m"
 */
export function formatSlotRanges(slots: string[]): string {
  const minutes = slots
    .map((slot) => slot.split('T')[1]?.substring(0, 5))
    .filter((t): t is string => Boolean(t))
    .map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
  if (minutes.length === 0) return 'none';

  // Smallest gap between consecutive slots is the slot interval
  let step = Infinity;
  for (let i = 1; i < minutes.length; i += 1) {
    const gap = minutes[i] - minutes[i - 1];
    if (gap > 0 && gap < step) step = gap;
  }

  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const ranges: string[] = [];
  let rangeStart = minutes[0];
  let previous = minutes[0];
  for (const m of [...minutes.slice(1), NaN]) {
    if (m - previous === step) {
      previous = m;
      continue;
    }
    ranges.push(rangeStart === previous ? hhmm(rangeStart) : `${hhmm(rangeStart)}-${hhmm(previous)}`);
    rangeStart = m;
    previous = m;
  }

  return Number.isFinite(step) ? `${ranges.join(', ')} every ${step}m` : ranges.join(', ');
}

/**
 * Main entry: fetch booking history + availability in parallel from the shared worker.
 */
export async function lookupFromBookingWorker(
  bookingFetch: BookingFetch,
  baseUrl: string,
  orgId: string,
  phone: string,
  timezone: string,
  signingSecret: string,
  callId: string,
): Promise<{ callerName: string; callerHistory: string; availability: string }> {
  const [history, avail] = await Promise.all([
    fetchBookingHistory(bookingFetch, baseUrl, orgId, phone, timezone, signingSecret, callId),
    fetchAvailability(bookingFetch, baseUrl, orgId, timezone, signingSecret, callId),
  ]);

  return {
    callerName: history.callerName,
    callerHistory: history.callerHistory,
    availability: avail.availability,
  };
}

export async function createBookingToolHeaders(
  rootSecret: string,
  organizationId: string,
  action: string,
  callId: string,
  now: Date = new Date(),
): Promise<Record<string, string>> {
  const timestamp = now.toISOString();
  const actionToken = `bm_v1_${await hmacHex(
    rootSecret,
    `booking-tools:v1:${organizationId}:${action}`,
  )}`;
  const sharedSecret = await hmacHex(rootSecret, `ultravox-tools:v1:${organizationId}`);
  const signature = await hmacHex(sharedSecret, callId + timestamp);

  return {
    Authorization: `Bearer ${actionToken}`,
    'Content-Type': 'application/json',
    'X-Ultravox-Call-ID': callId,
    'X-Ultravox-Signature-Timestamp': timestamp,
    'X-Ultravox-Signature': signature,
  };
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
