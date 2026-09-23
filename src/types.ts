/** Environment bindings for the CF Worker */
export interface Env {
  /** Deployment environment. Legacy fallback is forbidden in production. */
  ENVIRONMENT?: 'production' | 'staging' | 'development';
  ULTRAVOX_API_KEY: string;
  /** Fallback agent ID when no KV routing match is found */
  ULTRAVOX_AGENT_ID: string;
  ULTRAVOX_SIP_DOMAIN: string;
  LOOKUP_URL?: string;
  WEBHOOK_SECRET?: string;
  /** Twilio Auth Token — used to validate webhook signatures */
  TWILIO_AUTH_TOKEN?: string;
  /** Exact public URL configured as the Twilio voice webhook */
  TWILIO_WEBHOOK_URL?: string;
  /** KV namespace mapping DIDs to agent configs (multi-tenant routing) */
  AGENT_ROUTING?: KVNamespace;
  /** Base URL for the shared booking tools worker */
  BOOKING_TOOLS_URL?: string;
  /** Root secret for authenticated, tenant-bound booking tool requests */
  BOOKING_TOOLS_SIGNING_SECRET?: string;
  /** Explicit temporary fallback for non-production testing only */
  ALLOW_LEGACY_AGENT_FALLBACK?: string;
  /** Optional secret webhook for operational unknown/malformed DID alerts */
  ROUTING_ALERT_WEBHOOK_URL?: string;
}

/** Per-DID agent configuration stored in AGENT_ROUTING KV */
export interface AgentRoute {
  agentId: string;
  sipDomain: string;
  lookupUrl?: string;
  /** Organization ID for the shared booking tools worker */
  organizationId?: string;
  /** IANA timezone for date/time context (defaults to Europe/Madrid) */
  timezone?: string;
}

/** Cloudonix inbound webhook payload */
export interface CloudonixPayload {
  CallSid: string;
  From: string;
  To: string;
  CallerName?: string;
  Direction: string;
  CallStatus: string;
  Session?: string;
  Domain?: string;
}

/** Caller context returned by the lookup service */
export interface CallerContext {
  name?: string;
  history?: string;
  preferences?: string;
  language?: string;
  [key: string]: string | undefined;
}

/** Template context passed to Ultravox agent's system prompt */
export interface TemplateContext {
  callerName: string;
  callerPhone: string;
  callerHistory: string;
  currentDate: string;
  currentTime: string;
  [key: string]: string;
}

/** Ultravox create-call response */
export interface UltravoxCallResponse {
  callId: string;
  joinUrl: string;
  [key: string]: unknown;
}
