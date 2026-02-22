import type { Env } from './types';
import { validateRequest } from './auth';
import { handleInboundCall } from './handlers/inbound-call';
import { handleCallStatus } from './handlers/call-status';
import { handleWebSocketDebug } from './handlers/ws-debug';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return Response.json({
        status: 'ok',
        service: 'cloudonix-inbound-worker',
        agentConfigured: !!env.ULTRAVOX_AGENT_ID,
        lookupConfigured: !!env.LOOKUP_URL,
      });
    }

    // WebSocket proxy for debugging (no auth — Cloudonix connects directly)
    if (path === '/ws-proxy') {
      const target = url.searchParams.get('target');
      if (!target) {
        return Response.json({ error: 'Missing target param' }, { status: 400 });
      }
      return handleWebSocketDebug(request, target);
    }

    // Only accept POST for webhook endpoints
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Skip auth for stream-status callbacks (Cloudonix sends them without Bearer)
    if (path === '/stream-status') {
      const body = await request.text();
      console.log('Stream status event:', body);
      return new Response('<Response/>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Validate Cloudonix auth
    if (!validateRequest(request, env)) {
      console.error('Auth validation failed — invalid Authorization Bearer token');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Route to handler
    switch (path) {
      case '/inbound':
        return handleInboundCall(request, env);

      case '/status':
        return handleCallStatus(request);

      default:
        return Response.json(
          { error: `Unknown route: ${path}. Use /inbound or /status` },
          { status: 404 },
        );
    }
  },
} satisfies ExportedHandler<Env>;
