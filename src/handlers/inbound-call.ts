import type { Env, CloudonixPayload, TemplateContext } from '../types';
import { lookupCaller } from '../providers/lookup';
import { createUltravoxCall } from '../providers/ultravox';
import { buildStreamResponse, buildErrorResponse } from '../cxml';

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
 * 3. Create Ultravox call with Twilio medium + templateContext
 * 4. Return CXML with <Connect><Stream> to route audio to Ultravox
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

    // 3. Build template context for Ultravox agent
    const { currentDate, currentTime } = getDateTimeContext();
    const templateContext: TemplateContext = {
      callerName: callerContext.name || callerName || 'caller',
      callerPhone: from,
      callerHistory: callerContext.history || 'new caller',
      currentDate,
      currentTime,
      // Spread any additional lookup fields
      ...Object.fromEntries(
        Object.entries(callerContext).filter(([_, v]) => v !== undefined) as [string, string][],
      ),
    };

    console.log(`Creating Ultravox call with context:`, JSON.stringify(templateContext));

    // 4. Create Ultravox call with Twilio medium
    const ultravoxCall = await createUltravoxCall(env, templateContext);
    console.log(`Ultravox call created: ${ultravoxCall.callId}, joinUrl: ${ultravoxCall.joinUrl}`);

    // 5. Return CXML with <Connect><Stream> to route audio via WebSocket
    return buildStreamResponse(ultravoxCall.joinUrl);
  } catch (err) {
    console.error('Inbound call handler error:', err instanceof Error ? err.message : err);
    return buildErrorResponse();
  }
}
