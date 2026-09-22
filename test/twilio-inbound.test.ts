import { expect, test } from 'bun:test';
import { handleTwilioInbound } from '../src/handlers/twilio-inbound';
import type { Env } from '../src/types';

const env: Env = {
  ENVIRONMENT: 'production',
  ULTRAVOX_API_KEY: 'test',
  ULTRAVOX_AGENT_ID: 'legacy-agent',
  ULTRAVOX_SIP_DOMAIN: 'legacy.example.test',
  TWILIO_AUTH_TOKEN: 'regional-primary-token',
  TWILIO_WEBHOOK_URL: 'https://worker.example.test/twilio-inbound',
};

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

test('the public Twilio handler returns 403 before processing an unsigned request', async () => {
  const request = new Request(env.TWILIO_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      From: '+441133339998',
      To: '+441133339999',
      CallSid: 'CA123',
    }),
  });

  const response = await handleTwilioInbound(request, env, ctx);

  expect(response.status).toBe(403);
  expect(await response.text()).toBe('Unauthorized');
});
