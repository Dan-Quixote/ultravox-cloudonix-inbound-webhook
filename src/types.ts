/** Environment bindings for the CF Worker */
export interface Env {
  ULTRAVOX_API_KEY: string;
  ULTRAVOX_AGENT_ID: string;
  LOOKUP_URL?: string;
  WEBHOOK_SECRET?: string;
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
