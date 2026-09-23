import type { Env, AgentRoute, TemplateContext } from '../types';
import { lookupCaller } from '../providers/lookup';
import { lookupFromBookingWorker } from '../providers/booking';

/**
 * Format current date/time for the agent's template context.
 * Uses the provided timezone (defaults to Europe/Madrid).
 */
function getDateTimeContext(tz: string = 'Europe/Madrid'): { currentDate: string; currentTime: string } {
  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return {
    currentDate: dateFormatter.format(now),
    currentTime: timeFormatter.format(now),
  };
}

type RouteProvider = 'twilio' | 'cloudonix' | 'unknown';
type RouteRejectionReason = 'missing_did' | 'malformed_did' | 'malformed_route' | 'unknown_did';

export interface RoutingAlertContext {
  provider?: RouteProvider;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Accept only canonical E.164 DIDs for tenant routing. */
function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  return /^\+[1-9]\d{7,14}$/.test(trimmed) ? trimmed : null;
}

async function rejectRoute(
  env: Env,
  reason: RouteRejectionReason,
  did: string,
  alertContext: RoutingAlertContext,
): Promise<null> {
  const event = {
    event: 'inbound_route_rejected',
    reason,
    provider: alertContext.provider ?? 'unknown',
    did,
  };
  console.error(JSON.stringify(event));

  if (env.ROUTING_ALERT_WEBHOOK_URL) {
    const alert = fetch(env.ROUTING_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `BookingMate inbound route rejected (${event.provider}/${reason}) for DID ${did || '<missing>'}`,
        ...event,
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      })
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: 'routing_alert_failed',
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      });

    if (alertContext.waitUntil) alertContext.waitUntil(alert);
    else await alert;
  }

  return null;
}

/**
 * Resolve which agent to route to based on the called DID.
 * Unknown or malformed routes fail closed. A legacy default agent is available
 * only when it is explicitly enabled outside production.
 */
export async function resolveAgent(
  env: Env,
  calledNumber: string,
  alertContext: RoutingAlertContext = {},
): Promise<AgentRoute | null> {
  const normalized = normalizePhone(calledNumber);

  if (!normalized) {
    return rejectRoute(
      env,
      calledNumber.trim() ? 'malformed_did' : 'missing_did',
      calledNumber,
      alertContext,
    );
  }

  if (env.AGENT_ROUTING) {
    const route = await env.AGENT_ROUTING.get(normalized, 'json');
    if (isAgentRoute(route)) {
      console.log(`KV routing match for ${normalized}: agentId=${route.agentId}`);
      return route;
    }

    if (route !== null) {
      return rejectRoute(env, 'malformed_route', normalized, alertContext);
    }
  }

  if (legacyFallbackAllowed(env)) {
    console.warn(
      JSON.stringify({ event: 'legacy_route_fallback', did: normalized, environment: env.ENVIRONMENT }),
    );
    return {
      agentId: env.ULTRAVOX_AGENT_ID,
      sipDomain: env.ULTRAVOX_SIP_DOMAIN,
      lookupUrl: env.LOOKUP_URL,
    };
  }

  return rejectRoute(env, 'unknown_did', normalized, alertContext);
}

function isAgentRoute(value: unknown): value is AgentRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.agentId === 'string' &&
    route.agentId.trim().length > 0 &&
    typeof route.sipDomain === 'string' &&
    route.sipDomain.trim().length > 0
  );
}

function legacyFallbackAllowed(env: Env): boolean {
  return env.ENVIRONMENT !== 'production' && env.ALLOW_LEGACY_AGENT_FALLBACK === 'true';
}

/**
 * Build the template context for an inbound call.
 * Shared between Cloudonix and Twilio handlers.
 *
 * When BOOKING_TOOLS_URL is configured and the route has an organizationId,
 * fetches caller history + availability from the shared booking worker.
 * Otherwise falls back to the legacy external lookup webhook.
 */
export async function buildCallContext(
  env: Env,
  agent: AgentRoute,
  from: string,
  callerName?: string,
  callId?: string,
): Promise<TemplateContext> {
  const tz = agent.timezone || 'Europe/Madrid';
  const { currentDate, currentTime } = getDateTimeContext(tz);

  // Shared booking worker path: history + availability in one shot
  if (env.BOOKING_TOOLS_URL && agent.organizationId) {
    console.log(`[context] Using booking worker for org=${agent.organizationId}`);

    if (!env.BOOKING_TOOLS_SIGNING_SECRET || !callId) {
      console.error(
        JSON.stringify({
          event: 'booking_context_skipped',
          reason: !env.BOOKING_TOOLS_SIGNING_SECRET ? 'missing_signing_secret' : 'missing_call_id',
          organizationId: agent.organizationId,
        }),
      );
      return {
        callerName: (callerName || 'caller').split(' ')[0],
        callerPhone: from,
        callerHistory: 'new caller',
        availability: '',
        currentDate,
        currentTime,
      };
    }

    const result = await lookupFromBookingWorker(
      env.BOOKING_TOOLS_URL,
      agent.organizationId,
      from,
      tz,
      env.BOOKING_TOOLS_SIGNING_SECRET,
      callId,
    );

    return {
      callerName: result.callerName || (callerName || 'caller').split(' ')[0],
      callerPhone: from,
      callerHistory: result.callerHistory || 'new caller',
      availability: result.availability || '',
      currentDate,
      currentTime,
    };
  }

  // Legacy path: external webhook lookup (n8n, custom CRM, etc.)
  const lookupUrl = agent.lookupUrl ?? env.LOOKUP_URL;
  const callerContext = await lookupCaller(lookupUrl, from);

  return {
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
}
