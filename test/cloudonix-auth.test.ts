import { describe, expect, test } from 'bun:test';
import { validateRequest } from '../src/auth';
import type { Env } from '../src/types';

function env(secret?: string): Env {
  return {
    ULTRAVOX_API_KEY: 'test',
    ULTRAVOX_AGENT_ID: 'test-agent',
    ULTRAVOX_SIP_DOMAIN: 'example.test',
    WEBHOOK_SECRET: secret,
  };
}

describe('Cloudonix webhook authentication', () => {
  test('accepts the configured bearer secret', () => {
    const request = new Request('https://example.test/inbound', {
      headers: { Authorization: 'Bearer correct-secret' },
    });
    expect(validateRequest(request, env('correct-secret'))).toBe(true);
  });

  test('rejects a wrong bearer secret', () => {
    const request = new Request('https://example.test/inbound', {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(validateRequest(request, env('correct-secret'))).toBe(false);
  });

  test('fails closed when the server secret is missing', () => {
    const request = new Request('https://example.test/inbound');
    expect(validateRequest(request, env())).toBe(false);
  });
});
