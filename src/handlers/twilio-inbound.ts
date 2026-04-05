import type { Env } from '../types';
import { buildTwimlSipDialResponse, buildTwimlErrorResponse } from '../cxml';
import { resolveAgent, buildCallContext } from './route-call';
import { validateTwilioSignature } from '../twilio-auth';

/**
 * Twilio inbound call handler.
 * Twilio sends form-urlencoded POST with From, To, CallSid, etc.
 *
 * 1. Validate Twilio request signature
 * 2. Parse Twilio webhook payload
 * 3. Resolve agent by DID (KV lookup, falls back to env)
 * 4. Fetch caller context + availability from booking worker (or legacy lookup)
 * 5. Return TwiML with <Dial><Sip> + context as URI params
 */
export async function handleTwilioInbound(request: Request, env: Env): Promise<Response> {
  try {
    // Twilio sends application/x-www-form-urlencoded
    const formData = await request.formData();

    // Validate Twilio signature before processing
    const isValid = await validateTwilioSignature(request, formData, env);
    if (!isValid) {
      console.error('[twilio] Rejected — invalid signature');
      return new Response('Unauthorized', { status: 403 });
    }

    const from = formData.get('From') as string;
    const to = formData.get('To') as string;
    const callSid = formData.get('CallSid') as string;
    const callerName = formData.get('CallerName') as string | null;

    console.log(`[twilio] Inbound call: from=${from} to=${to} sid=${callSid}`);

    if (!from) {
      console.error('[twilio] No caller number in webhook payload');
      return buildTwimlErrorResponse();
    }

    // Resolve agent by DID
    const agent = await resolveAgent(env, to || '');

    // Build caller context (booking worker or legacy lookup)
    const templateContext = await buildCallContext(env, agent, from, callerName || undefined);

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
