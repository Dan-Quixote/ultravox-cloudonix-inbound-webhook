import type { CallerContext } from '../types';

/**
 * Look up caller context from a configurable external service.
 * The LOOKUP_URL receives a GET request with ?phone={number}
 * and should return JSON matching CallerContext.
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
    const url = new URL(lookupUrl);
    url.searchParams.set('phone', phone);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
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
