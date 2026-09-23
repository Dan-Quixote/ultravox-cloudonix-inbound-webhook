import { describe, expect, test } from 'bun:test';
import { resolveAgent } from '../src/handlers/route-call';
import type { AgentRoute, Env } from '../src/types';

function env(route: unknown, overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'production',
    ULTRAVOX_API_KEY: 'test',
    ULTRAVOX_AGENT_ID: 'legacy-agent',
    ULTRAVOX_SIP_DOMAIN: 'legacy.example.test',
    AGENT_ROUTING: {
      get: async () => route,
    } as unknown as KVNamespace,
    ...overrides,
  };
}

describe('resolveAgent', () => {
  test('returns a valid KV route for the called BookingMate number', async () => {
    const route: AgentRoute = {
      agentId: 'tenant-agent',
      sipDomain: 'tenant.example.test',
      organizationId: 'org-123',
    };

    expect(await resolveAgent(env(route), '+441133339999')).toEqual(route);
  });

  test('rejects an unknown DID in production', async () => {
    expect(await resolveAgent(env(null), '+441133339999')).toBeNull();
  });

  test('rejects a malformed KV route instead of using the default agent', async () => {
    expect(await resolveAgent(env({ agentId: 'tenant-agent' }), '+441133339999')).toBeNull();
  });

  test('rejects a missing DID', async () => {
    expect(await resolveAgent(env(null), '')).toBeNull();
  });

  test('rejects a malformed DID before KV lookup', async () => {
    expect(
      await resolveAgent(
        env({
          agentId: 'tenant-agent',
          sipDomain: 'tenant.example.test',
        }),
        'abc123',
      ),
    ).toBeNull();
  });

  test('allows the legacy default only when explicitly enabled outside production', async () => {
    expect(
      await resolveAgent(
        env(null, { ENVIRONMENT: 'development', ALLOW_LEGACY_AGENT_FALLBACK: 'true' }),
        '+441133339999',
      ),
    ).toEqual({
      agentId: 'legacy-agent',
      sipDomain: 'legacy.example.test',
      lookupUrl: undefined,
    });
  });

  test('never allows the legacy default in production', async () => {
    expect(
      await resolveAgent(
        env(null, { ENVIRONMENT: 'production', ALLOW_LEGACY_AGENT_FALLBACK: 'true' }),
        '+441133339999',
      ),
    ).toBeNull();
  });

  test('sends an operational alert for a rejected DID', async () => {
    const originalFetch = globalThis.fetch;
    let alertBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      alertBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      expect(
        await resolveAgent(
          env(null, { ROUTING_ALERT_WEBHOOK_URL: 'https://alerts.example.test/routing' }),
          '+441133339999',
          { provider: 'twilio' },
        ),
      ).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(alertBody).toMatchObject({
      event: 'inbound_route_rejected',
      reason: 'unknown_did',
      provider: 'twilio',
      did: '+441133339999',
    });
  });
});
