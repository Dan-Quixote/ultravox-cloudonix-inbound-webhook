import type { Env, CloudonixPayload } from '../types';
import { buildSipDialResponse, buildErrorResponse } from '../cxml';
import { resolveAgent, buildCallContext } from './route-call';

/**
 * Cloudonix inbound call handler.
 * 1. Parse Cloudonix JSON webhook
 * 2. Resolve agent by DID (unknown numbers fail closed)
 * 3. Fetch caller context + availability from booking worker (or legacy lookup)
 * 4. Return CXML with <Dial><Sip> + X- headers for caller context
 *
 * Ultravox auto-creates the call from the agent's call template when it
 * receives the SIP INVITE. No separate Ultravox API call needed.
 */
export async function handleInboundCall(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const payload = (await request.json()) as CloudonixPayload;
    const { From: from, To: to, CallSid: callSid, CallerName: callerName } = payload;

    console.log(`[cloudonix] Inbound call: from=${from} to=${to} sid=${callSid}`);

    if (!from) {
      console.error('No caller number in webhook payload');
      return buildErrorResponse();
    }

    // Resolve agent by DID
    const agent = await resolveAgent(env, to || '', {
      provider: 'cloudonix',
      waitUntil: ctx.waitUntil.bind(ctx),
    });
    if (!agent) {
      console.error(
        JSON.stringify({ event: 'inbound_call_rejected', provider: 'cloudonix', reason: 'unknown_did', did: to }),
      );
      return buildErrorResponse(
        'Sorry, this number is temporarily unavailable. Please contact the business directly.',
      );
    }

    // Build caller context (booking worker or legacy lookup)
    const templateContext = await buildCallContext(env, agent, from, callerName, callSid);

    // Add phone numbers for post-call pipeline extraction via SIP headers
    templateContext.fromNumber = from;
    templateContext.toNumber = to || '';

    // Build SIP URI
    const sipUri = `sip:agent_${agent.agentId}@${agent.sipDomain}`;

    console.log(`[cloudonix] Routing to: ${sipUri}`);
    console.log(`[cloudonix] Context:`, JSON.stringify(templateContext));

    return buildSipDialResponse(sipUri, templateContext);
  } catch (err) {
    console.error('Cloudonix handler error:', err instanceof Error ? err.message : err);
    return buildErrorResponse();
  }
}
