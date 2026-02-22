# cloudonix-inbound-worker

A Cloudflare Worker that bridges inbound phone calls from [Cloudonix](https://www.cloudonix.io/) (cloud PBX) to [Ultravox](https://www.ultravox.ai/) (AI voice agents) via native SIP trunking, with optional caller context enrichment from any HTTP webhook.

Built for production use at Los Naranjos Golf Club, but designed as a generic bridge adaptable to any Ultravox-powered voice agent.

## How It Works

```
Caller
  → VoIP Provider (e.g. Zadarma, Twilio)
  → Cloudonix PBX (border.cloudonix.io)
  → This Cloudflare Worker (/inbound webhook)
  → [Optional] Caller context lookup (n8n, Make, any HTTP endpoint) — 3s timeout
  → CXML response with <Dial><Sip> + X-headers
  → Ultravox SIP agent (receives context via X-headers → template variables)
```

1. Your VoIP provider receives the inbound call and forwards it to Cloudonix.
2. Cloudonix fires a JSON webhook to this Worker's `/inbound` endpoint.
3. The Worker optionally POSTs to a configurable lookup webhook to fetch caller context (name, booking history, etc.) from your CRM or booking system — with a hard 3-second timeout so the caller is never kept waiting.
4. The Worker returns CXML instructing Cloudonix to dial the Ultravox SIP agent URI, passing caller context as SIP `X-` headers.
5. Ultravox receives the SIP INVITE, maps the `X-` headers to template variables in the agent's system prompt, and the AI handles the call with full caller context from the first word.

## Key Features

- **Native SIP trunking** — no WebSocket bridging, superior audio quality and lower latency
- **Caller context enrichment** — passes name, booking history, and custom fields to the AI agent before the call connects
- **Zero-latency context delivery** — context arrives via SIP `X-` headers in the INVITE, not via a mid-call API lookup
- **3-second lookup timeout** — if the CRM lookup is slow, the call proceeds with a generic greeting rather than keeping the caller waiting
- **Date/time injection** — current date and time (configurable timezone) injected into every call for context-aware agent responses
- **First-name personalization** — full name from CRM is trimmed to first name for natural greetings
- **Webhook authentication** — optional Bearer token validation on the `/inbound` endpoint
- **Health check endpoint** — `/health` for uptime monitoring
- **Zero cold-start overhead** — Cloudflare Workers edge runtime, globally distributed

## File Structure

```
src/
├── index.ts                 Router: /inbound, /status, /health, /ws-proxy
├── types.ts                 TypeScript interfaces (Env, CloudonixPayload, CallerContext, TemplateContext)
├── cxml.ts                  CXML response builders (buildSipDialResponse, buildErrorResponse)
├── auth.ts                  Webhook authentication (Bearer token validation)
├── handlers/
│   ├── inbound-call.ts      Core handler: parse webhook → lookup caller → build SIP dial response
│   ├── call-status.ts       Call status callback handler
│   └── ws-debug.ts          WebSocket debug proxy (development only)
└── providers/
    ├── lookup.ts             Caller context lookup (POST to configurable webhook, 3s timeout)
    └── ultravox.ts           Legacy Ultravox API provider (kept for reference, not used in SIP flow)
```

## CXML Response

The Worker returns CXML that Cloudonix executes to dial the Ultravox SIP agent:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you now.</Say>
  <Dial>
    <Header name="X-Caller-Name" value="John"/>
    <Header name="X-Caller-Phone" value="+1234567890"/>
    <Header name="X-Caller-History" value="Existing booking: Monday, February 23 at 10:00 AM"/>
    <Header name="X-Current-Date" value="Saturday, February 22, 2026"/>
    <Header name="X-Current-Time" value="9:15 PM"/>
    <Sip>sip:agent_your-agent-id@your-sip-domain.example.com</Sip>
  </Dial>
  <Say>The call has ended. Goodbye.</Say>
  <Hangup/>
</Response>
```

## SIP Header to Template Variable Mapping

Ultravox automatically maps SIP `X-` headers from the INVITE to template variables in your agent's system prompt. No configuration needed on the Worker side.

| SIP Header | Ultravox Template Variable | Example Value |
|---|---|---|
| `X-Caller-Name` | `{{caller_name}}` | `John` |
| `X-Caller-Phone` | `{{caller_phone}}` | `+1234567890` |
| `X-Caller-History` | `{{caller_history}}` | `Existing booking: Feb 23 at 10 AM` |
| `X-Current-Date` | `{{current_date}}` | `Saturday, February 22, 2026` |
| `X-Current-Time` | `{{current_time}}` | `9:15 PM` |

In your Ultravox agent's system prompt, reference these as `{{caller_name}}`, `{{caller_history}}`, etc.

## Caller Context Lookup Webhook

When `LOOKUP_URL` is configured, the Worker sends a POST request for every inbound call:

**Request (from Worker to your webhook):**
```json
POST https://your-webhook.example.com/lookup
Content-Type: application/json

{
  "call_inbound": {
    "from_number": "+1234567890"
  }
}
```

**Response (from your webhook to Worker):**
```json
{
  "name": "John Hammond",
  "history": "Existing booking: Monday, February 23 at 10:00 AM"
}
```

Any field in the response is passed through as an `X-` header. The `name` field is automatically trimmed to first name only for the `X-Caller-Name` header.

If the lookup URL is not set, or if the request times out or fails, the Worker falls back gracefully — the call still connects, the agent just won't have caller-specific context.

## Setup

### Prerequisites

- [Bun](https://bun.sh/) (package manager — do not use npm or yarn)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`bun add -g wrangler`)
- A Cloudflare account with Workers enabled
- A Cloudonix account with a configured domain
- An Ultravox account with a SIP-enabled agent

### 1. Clone and Install

```bash
git clone https://github.com/your-username/cloudonix-inbound-worker.git
cd cloudonix-inbound-worker
bun install
```

### 2. Configure wrangler.toml

Edit `wrangler.toml` and set your Ultravox agent details:

```toml
name = "cloudonix-inbound-worker"
main = "src/index.ts"
compatibility_date = "2025-02-14"

[vars]
ULTRAVOX_AGENT_ID = "your-agent-id"
ULTRAVOX_SIP_DOMAIN = "your-sip-domain.example.com"
```

`ULTRAVOX_AGENT_ID` is the UUID of your Ultravox agent. `ULTRAVOX_SIP_DOMAIN` is the SIP domain shown in your Ultravox agent's SIP settings. The Worker will construct the SIP URI as `sip:agent_{ULTRAVOX_AGENT_ID}@{ULTRAVOX_SIP_DOMAIN}`.

### 3. Set Secrets

```bash
# Required: authenticates Cloudonix webhook requests
wrangler secret put WEBHOOK_SECRET

# Optional: enables caller context lookup (n8n, Make, or any HTTP endpoint)
wrangler secret put LOOKUP_URL
```

`WEBHOOK_SECRET` should match the API key you configure in Cloudonix's webhook settings. If not set, authentication is skipped (not recommended for production).

`LOOKUP_URL` is the full URL of your caller context webhook. Omit it entirely if you don't need CRM lookups.

### 4. Local Development

```bash
bun run dev
```

This starts a local Wrangler dev server. You can use [ngrok](https://ngrok.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose it for webhook testing.

### 5. Deploy

```bash
bun run deploy
```

Your Worker will be live at `https://cloudonix-inbound-worker.your-subdomain.workers.dev`.

### 6. Configure Cloudonix

In your Cloudonix domain settings, set the inbound call webhook URL to your deployed Worker:

```
https://cloudonix-inbound-worker.your-subdomain.workers.dev/inbound
```

Set the webhook method to `POST` and configure the API key to match your `WEBHOOK_SECRET`.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/inbound` | `POST` | Main webhook — receives Cloudonix call events |
| `/status` | `POST` | Call status callback (logs call lifecycle events) |
| `/health` | `GET` | Health check — returns `200 OK` with status payload |
| `/ws-proxy` | `GET` | WebSocket debug proxy (development use only) |

## Timezone Configuration

The Worker injects the current date and time using the `Europe/Madrid` timezone by default. To change it, edit the `timeZone` values in `src/handlers/inbound-call.ts`:

```typescript
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', // change to your timezone
  ...
});
```

Any [IANA timezone string](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) is valid.

## Logs

Stream live logs from the deployed Worker:

```bash
bun run tail
```

The Worker logs the caller number, call SID, resolved SIP URI, and the full template context passed to Ultravox for every inbound call.

## Environment Variables Reference

| Variable | Type | Required | Description |
|---|---|---|---|
| `ULTRAVOX_AGENT_ID` | `wrangler.toml` var | Yes | Ultravox agent UUID |
| `ULTRAVOX_SIP_DOMAIN` | `wrangler.toml` var | Yes | Ultravox SIP domain |
| `WEBHOOK_SECRET` | Secret | Recommended | Bearer token for Cloudonix webhook auth |
| `LOOKUP_URL` | Secret | No | Caller context lookup endpoint URL |

## Stack

- **Runtime:** Cloudflare Workers (edge, globally distributed)
- **Language:** TypeScript
- **Package manager:** Bun
- **Telephony:** Cloudonix CXML + SIP trunking
- **AI voice:** Ultravox SIP agent
- **Context enrichment:** Any HTTP webhook (n8n, Make, custom)

## License

MIT
