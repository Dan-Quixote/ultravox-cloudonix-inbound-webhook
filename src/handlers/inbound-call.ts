import type { Env, CloudonixPayload, TemplateContext } from '../types';
import { lookupCaller } from '../providers/lookup';
import { buildSipDialResponse, buildErrorResponse } from '../cxml';

/**
 * Format current date/time for the agent's template context.
 * Uses Europe/Madrid timezone.
 */
function getDateTimeContext(): { currentDate: string; currentTime: string } {
  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return {
    currentDate: dateFormatter.format(now),
    currentTime: timeFormatter.format(now),
  };
}

/**
 * Core inbound call handler.
 * 1. Parse Cloudonix JSON webhook
 * 2. Lookup caller context (optional, 3s timeout)
 * 3. Return CXML with <Dial><Sip> + X- headers for caller context
 *
 * Ultravox auto-creates the call from the agent's call template when it
 * receives the SIP INVITE. No separate Ultravox API call needed.
 */
export async function handleInboundCall(request: Request, env: Env): Promise<Response> {
  try {
    // 1. Parse Cloudonix JSON payload
    const payload = (await request.json()) as CloudonixPayload;
    const { From: from, To: to, CallSid: callSid, CallerName: callerName } = payload;

    console.log(`Inbound call: from=${from} to=${to} sid=${callSid} callerName=${callerName || 'unknown'}`);

    if (!from) {
      console.error('No caller number in webhook payload');
      return buildErrorResponse();
    }

    // 2. Lookup caller context (non-blocking — falls back to empty if unavailable)
    const callerContext = await lookupCaller(env.LOOKUP_URL, from);

    // 3. Build template context — passed as SIP X- headers to Ultravox
    const { currentDate, currentTime } = getDateTimeContext();
    const templateContext: TemplateContext = {
      callerName: (callerContext.name || callerName || 'caller').split(' ')[0],
      callerPhone: from,
      callerHistory: callerContext.history || 'new caller',
      currentDate,
      currentTime,
      // Spread any additional lookup fields
      ...Object.fromEntries(
        Object.entries(callerContext).filter(([_, v]) => v !== undefined) as [string, string][],
      ),
    };

    // 4. Build SIP URI: agent_{id}@{sip_domain}
    const sipUri = `sip:agent_${env.ULTRAVOX_AGENT_ID}@${env.ULTRAVOX_SIP_DOMAIN}`;

    console.log(`Routing to Ultravox via SIP: ${sipUri}`);
    console.log(`Context headers:`, JSON.stringify(templateContext));

    // 5. Return CXML with <Dial><Sip> + context headers
    return buildSipDialResponse(sipUri, templateContext);
  } catch (err) {
    console.error('Inbound call handler error:', err instanceof Error ? err.message : err);
    return buildErrorResponse();
  }
}
