import type { Env, TemplateContext, UltravoxCallResponse } from '../types';

/**
 * Create an Ultravox call with Twilio medium and caller context.
 * Returns the joinUrl (wss:// WebSocket URI) for Cloudonix to stream audio to.
 */
export async function createUltravoxCall(
  env: Env,
  templateContext: TemplateContext,
): Promise<UltravoxCallResponse> {
  const response = await fetch(
    `https://api.ultravox.ai/api/agents/${env.ULTRAVOX_AGENT_ID}/calls`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': env.ULTRAVOX_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        medium: { twilio: {} },
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
