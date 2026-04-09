import type { RfqAgentPayload } from "../types";

export interface RfqAgentAdapterConfig {
  provider: string;
  endpoint: string;
  model: string;
  enabled: boolean;
}

export const defaultRfqAgentAdapter: RfqAgentAdapterConfig = {
  provider: "ZeroClaw bridge",
  endpoint: "/api/zeroclaw/rfq",
  model: "configure-your-llm",
  enabled: false,
};

export function serializeRfqAgentPayload(payload: RfqAgentPayload): string {
  return JSON.stringify(payload, null, 2);
}
