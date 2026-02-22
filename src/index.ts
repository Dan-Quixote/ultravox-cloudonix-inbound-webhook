import type { Env } from './types';
import { validateRequest } from './auth';
import { handleInboundCall } from './handlers/inbound-call';
import { handleCallStatus } from './handlers/call-status';

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

    // Only accept POST for webhook endpoints
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Validate Cloudonix auth
    if (!validateRequest(request, env)) {
      console.error('Auth validation failed — invalid X-CX-APIKey');
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
