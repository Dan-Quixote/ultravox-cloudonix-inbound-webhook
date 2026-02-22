import type { CallerContext } from '../types';

/**
 * Look up caller context from a configurable external service (n8n webhook).
 * POSTs { call_inbound: { from_number } } and expects a JSON response
 * matching CallerContext (name, history, etc.).
 *
 * If no LOOKUP_URL is configured or the lookup fails, returns empty context.
 */
export async function lookupCaller(
  lookupUrl: string | undefined,
  phone: string,
): Promise<CallerContext> {
  if (!lookupUrl) {
    return {};
  }

  try {
    const response = await fetch(lookupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        call_inbound: {
          from_number: phone,
        },
      }),
      signal: AbortSignal.timeout(3000), // 3s max — don't keep the caller waiting
    });

    if (!response.ok) {
      console.warn(`Lookup returned ${response.status} for ${phone}`);
      return {};
    }

    return (await response.json()) as CallerContext;
  } catch (err) {
    console.warn(`Lookup failed for ${phone}:`, err instanceof Error ? err.message : err);
    return {};
  }
}
