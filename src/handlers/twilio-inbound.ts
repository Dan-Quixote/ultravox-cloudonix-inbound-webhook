import type { Env } from '../types';
import { buildTwimlSipDialResponse, buildTwimlErrorResponse } from '../cxml';
import { resolveAgent, buildCallContext } from './route-call';
import { validateTwilioSignature } from '../twilio-auth';

/**
 * Twilio inbound call handler.
 * Twilio sends form-urlencoded POST with From, To, CallSid, etc.
 *
 * 1. Parse raw body with URLSearchParams (not FormData — more reliable for URL-encoded)
 * 2. Validate Twilio request signature
 * 3. Resolve agent by DID (unknown numbers fail closed)
 * 4. Fetch caller context + availability from booking worker (or legacy lookup)
 * 5. Return TwiML with <Dial><Sip> + context as URI params
 */
export async function handleTwilioInbound(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    // Read raw body for both auth and parsing
    const body = await request.text();
    const params = new URLSearchParams(body);

    // Validate Twilio signature before processing
    const isValid = await validateTwilioSignature(request, params, env);
    if (!isValid) {
      console.error('[twilio] Rejected — invalid signature');
      return new Response('Unauthorized', { status: 403 });
    }

    const from = params.get('From') || '';
    const to = params.get('To') || '';
    const callSid = params.get('CallSid') || '';
    const callerName = params.get('CallerName');

    console.log(`[twilio] Inbound call: from=${from} to=${to} sid=${callSid}`);

    if (!from) {
      console.error('[twilio] No caller number in webhook payload');
      return buildTwimlErrorResponse();
    }

    // Resolve agent by DID
    const agent = await resolveAgent(env, to || '', {
      provider: 'twilio',
      waitUntil: ctx.waitUntil.bind(ctx),
    });
    if (!agent) {
      console.error(
        JSON.stringify({ event: 'inbound_call_rejected', provider: 'twilio', reason: 'unknown_did', did: to }),
      );
      return buildTwimlErrorResponse(
        'Sorry, this number is temporarily unavailable. Please contact the business directly.',
      );
    }

    // Build caller context (booking worker or legacy lookup)
    const templateContext = await buildCallContext(env, agent, from, callerName || undefined, callSid);

    // Add phone numbers for post-call pipeline extraction via SIP headers
    templateContext.fromNumber = from;
    templateContext.toNumber = to || '';

    // Build SIP URI
    const sipUri = `sip:agent_${agent.agentId}@${agent.sipDomain}`;

    console.log(`[twilio] Routing to: ${sipUri}`);
    console.log(`[twilio] Context:`, JSON.stringify(templateContext));

    return buildTwimlSipDialResponse(sipUri, templateContext);
  } catch (err) {
    console.error('[twilio] Handler error:', err instanceof Error ? err.message : err);
    return buildTwimlErrorResponse();
  }
}
