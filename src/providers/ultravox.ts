import type { Env, TemplateContext, UltravoxCallResponse } from '../types';

type MediumType = 'twilio' | 'sip';

/**
 * Create an Ultravox call with the specified medium and caller context.
 * - 'twilio': Returns a wss:// joinUrl for WebSocket streaming
 * - 'sip': Returns a sip: URI for native SIP audio
 */
export async function createUltravoxCall(
  env: Env,
  templateContext: TemplateContext,
  mediumType: MediumType = 'twilio',
): Promise<UltravoxCallResponse> {
  const medium = mediumType === 'sip'
    ? { sip: { incoming: {} } }
    : { twilio: {} };

  const response = await fetch(
    `https://api.ultravox.ai/api/agents/${env.ULTRAVOX_AGENT_ID}/calls`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': env.ULTRAVOX_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        medium,
        templateContext,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Ultravox API ${response.status}: ${errorText}`);
  }

  return (await response.json()) as UltravoxCallResponse;
}
