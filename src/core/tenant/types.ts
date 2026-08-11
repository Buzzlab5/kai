export type TenantStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type BookingMode = "MANUAL_INQUIRY" | "AUTO_BOOKING";

// "REZDY_AGENT" is the new Rezdy Agent API path (BluePass as reseller across many operators via one
// credential) - deliberately distinct from "REZDY" (Supplier API, Boattime's live demo path) so the
// two are never conflated by the registry or by a tenant's config. Not yet added to the Prisma
// `PmsProvider` enum backing TenantConfig.pmsProvider/TenantIntegration.provider - that's a
// production schema migration, intentionally deferred until a real tenant needs to persist this
// value (see pms-adapter-registry.ts and bluepass-rezdy-agent-api-v3 handoff doc for why).
export type PmsProvider = "MOCK" | "REZDY" | "REZDY_AGENT" | "INSEANQ" | "FAREHARBOR" | "BOKUN" | "NATIVE";

export interface TenantBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  widgetTitle: string;
  welcomeMessage: string;
  brandVoice: string;
}

export interface TenantConfig {
  supportedChannels: Array<"WEB_WIDGET" | "WHATSAPP">;
  enabledFeatures: string[];
  requiredSlots: Record<string, string[]>;
  bookingMode: BookingMode;
  escalationRules: string[];
  responseGuardrails: string[];
}

export interface BusinessPack {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  allowedOrigins: string[];
  branding: TenantBranding;
  config: TenantConfig;
  pmsProvider: PmsProvider;
}
