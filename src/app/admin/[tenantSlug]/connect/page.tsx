"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

type FieldDef = { key: string; label: string; required: boolean; placeholder?: string };

const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  REZDY: [
    { key: "apiKey", label: "Rezdy API key", required: true, placeholder: "Rezdy dashboard > Settings > API keys" },
    { key: "baseUrl", label: "API base URL (optional)", required: false, placeholder: "https://api.rezdy.com" }
  ],
  FAREHARBOR: [
    { key: "appKey", label: "FareHarbor App key (X-FareHarbor-API-App)", required: true, placeholder: "issued by FareHarbor" },
    { key: "userKey", label: "FareHarbor User key (X-FareHarbor-API-User)", required: true, placeholder: "issued by FareHarbor" },
    { key: "companyShortname", label: "Company shortname", required: true, placeholder: "your-company" },
    { key: "baseUrl", label: "Base URL (optional)", required: false, placeholder: "https://fareharbor.com/api/external/v1" }
  ]
};

type ConnectOk = { ok: true; provider: string; productCount: number; sampleTitles: string[] };
type ConnectErr = { ok?: false; error?: { message?: string } };

export default function ConnectPage() {
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params?.tenantSlug ?? "";
  const [provider, setProvider] = useState<keyof typeof PROVIDER_FIELDS>("REZDY");
  const [values, setValues] = useState<Record<string, string>>({});
  const [adminToken, setAdminToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(() => PROVIDER_FIELDS[provider], [provider]);
  const canSubmit = fields.every((f) => !f.required || (values[f.key] ?? "").trim().length > 0);

  async function connect() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/${tenantSlug}/integrations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, credentials: values, adminToken })
      });
      const data = (await res.json()) as ConnectOk | ConnectErr;
      if (res.ok && (data as ConnectOk).ok) {
        setResult(data as ConnectOk);
      } else {
        setError((data as ConnectErr).error?.message ?? `Request failed (${res.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Connect your booking system</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Tenant <strong>{tenantSlug}</strong>. Paste your own account keys and connect — we run a live test call, and only
        store them (encrypted) if it works. Nothing here confirms a booking.
      </p>

      <label style={labelStyle}>Provider</label>
      <select
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value as keyof typeof PROVIDER_FIELDS);
          setValues({});
          setResult(null);
          setError(null);
        }}
        style={inputStyle}
      >
        <option value="REZDY">Rezdy</option>
        <option value="FAREHARBOR">FareHarbor</option>
      </select>

      {fields.map((f) => (
        <div key={f.key}>
          <label style={labelStyle}>
            {f.label} {f.required ? <span style={{ color: "#c00" }}>*</span> : null}
          </label>
          <input
            type={/key/i.test(f.key) ? "password" : "text"}
            value={values[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            style={inputStyle}
          />
        </div>
      ))}

      <label style={labelStyle}>Admin token</label>
      <input
        type="password"
        value={adminToken}
        onChange={(e) => setAdminToken(e.target.value)}
        placeholder="KAI_ADMIN_TOKEN"
        style={inputStyle}
      />

      <button
        onClick={connect}
        disabled={busy || !canSubmit || !adminToken}
        style={{
          marginTop: 16,
          padding: "12px 20px",
          borderRadius: 10,
          border: "none",
          background: busy || !canSubmit || !adminToken ? "#9db4ab" : "#0f5132",
          color: "#fff",
          fontWeight: 600,
          cursor: busy || !canSubmit || !adminToken ? "not-allowed" : "pointer"
        }}
      >
        {busy ? "Testing connection..." : `Connect ${provider === "REZDY" ? "Rezdy" : "FareHarbor"}`}
      </button>

      {result ? (
        <div style={{ ...noticeStyle, background: "#e7f5ec", border: "1px solid #0f5132", color: "#0f5132" }}>
          Connected to {result.provider}. Found {result.productCount} products
          {result.sampleTitles.length ? `: ${result.sampleTitles.join(", ")}` : ""}. Kai now uses your account.
        </div>
      ) : null}
      {error ? (
        <div style={{ ...noticeStyle, background: "#fdeaea", border: "1px solid #c0392b", color: "#8e2f22" }}>{error}</div>
      ) : null}
    </main>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, margin: "14px 0 6px" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  fontSize: 14,
  boxSizing: "border-box"
};
const noticeStyle: React.CSSProperties = { marginTop: 18, padding: 14, borderRadius: 10, fontSize: 14, lineHeight: 1.4 };
