/**
 * Fetch caller context (booking history + availability) from the shared booking tools worker.
 * Replaces the external n8n lookup — all data comes from one source.
 *
 * Two parallel requests:
 *   1. get-bookings — upcoming bookings for this phone number (caller history)
 *   2. check-availability — next 5 weekdays of slots (pre-cached for the agent)
 *
 * Both have a 3s timeout. Failures are non-fatal — the call proceeds with partial context.
 */

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
  baseUrl: string,
  orgId: string,
  phone: string,
  signingSecret: string,
  callId: string,
): Promise<BookingHistoryResult> {
  try {
    const body = JSON.stringify({ phoneNumber: phone });
    const res = await fetch(`${baseUrl}/get-bookings?organization_id=${orgId}`, {
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
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(dt);
        return `${b.title} - ${formatted} [uid:${b.uid}]`;
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
 * Fetch availability for the next 5 weekdays.
 * Returns a compact formatted string for injection into the agent's context.
 */
async function fetchAvailability(
  baseUrl: string,
  orgId: string,
  timezone: string,
  signingSecret: string,
  callId: string,
): Promise<AvailabilityResult> {
  try {
    // Generate next 5 weekday dates
    const dates = getNextWeekdays(5, timezone);

    // Fetch all dates in parallel
    const results = await Promise.all(
      dates.map(async (date) => {
        try {
          const body = JSON.stringify({ date });
          const res = await fetch(`${baseUrl}/check-availability?organization_id=${orgId}`, {
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

          if (!res.ok) return null;

          const data = (await res.json()) as {
            success: boolean;
            date: string;
            availableSlots: string[];
            count: number;
            note?: string;
          };

          if (!data.success || data.count === 0) return null;

          // Format: "Mon 10 Mar: 10:00, 11:00, 14:30"
          const dt = new Date(`${date}T12:00:00Z`);
          const dayLabel = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }).format(dt);

          const times = data.availableSlots
            .map((slot) => {
              // Extract HH:MM from ISO like "2026-03-10T10:00:00+01:00"
              const t = slot.split('T')[1];
              return t ? t.substring(0, 5) : slot;
            })
            .join(', ');

          return `${dayLabel}: ${times}`;
        } catch {
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
 * Get the next N weekday dates (Mon-Fri) in YYYY-MM-DD format.
 */
function getNextWeekdays(count: number, timezone: string): string[] {
  const dates: string[] = [];
  const now = new Date();
  let cursor = new Date(now);

  while (dates.length < count) {
    cursor.setDate(cursor.getDate() + 1); // start from tomorrow
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(cursor);

    if (dayName !== 'Sat' && dayName !== 'Sun') {
      const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(cursor);
      dates.push(dateStr);
    }
  }

  return dates;
}

/**
 * Main entry: fetch booking history + availability in parallel from the shared worker.
 */
export async function lookupFromBookingWorker(
  baseUrl: string,
  orgId: string,
  phone: string,
  timezone: string,
  signingSecret: string,
  callId: string,
): Promise<{ callerName: string; callerHistory: string; availability: string }> {
  const [history, avail] = await Promise.all([
    fetchBookingHistory(baseUrl, orgId, phone, signingSecret, callId),
    fetchAvailability(baseUrl, orgId, timezone, signingSecret, callId),
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
