import { useMemo, useState } from "react";

type ApiResult = {
  status: number;
  body: string;
};

export default function Home() {
  const [meResult, setMeResult] = useState<ApiResult | null>(null);
  const [apiResult, setApiResult] = useState<ApiResult | null>(null);

  const bffBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_BFF_BASE_URL ?? "http://localhost:4000",
    []
  );

  const login = () => {
    window.location.href = `${bffBaseUrl}/auth/login`;
  };

  const loadMe = async () => {
    const response = await fetch(`${bffBaseUrl}/me`, {
      credentials: "include",
    });
    const body = await response.text();
    setMeResult({ status: response.status, body });
  };

  const callApi = async () => {
    const response = await fetch(`${bffBaseUrl}/api/protected`, {
      credentials: "include",
    });
    const body = await response.text();
    setApiResult({ status: response.status, body });
  };

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>OIDC (SSO) + Passkeys PoC</h1>
      <p>Frontend communicates only with the BFF (HttpOnly cookie).</p>
      <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
        <button onClick={login} type="button">
          Login
        </button>
        <button onClick={loadMe} type="button">
          /me
        </button>
        <button onClick={callApi} type="button">
          /api/protected
        </button>
      </div>
      <section style={{ marginTop: "2rem" }}>
        <h2>Me</h2>
        <pre style={{ background: "#f6f8fa", padding: "1rem" }}>
          {meResult ? JSON.stringify(meResult, null, 2) : "Not loaded"}
        </pre>
      </section>
      <section style={{ marginTop: "2rem" }}>
        <h2>API</h2>
        <pre style={{ background: "#f6f8fa", padding: "1rem" }}>
          {apiResult ? JSON.stringify(apiResult, null, 2) : "Not loaded"}
        </pre>
      </section>
    </main>
  );
}
