import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import { Issuer, generators, type TokenSet } from "openid-client";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";

type Session = {
  accessToken: string;
  expiresAt?: number;
  claims: Record<string, unknown>;
};

type LoginState = {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
};

const {
  PORT = "4000",
  OIDC_ISSUER,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  FRONTEND_URL,
  API_BASE_URL,
  SESSION_COOKIE_NAME = "bff_session",
} = process.env;

function requireEnv(name: string, value?: string): string {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const issuerUrl = requireEnv("OIDC_ISSUER", OIDC_ISSUER);
const clientId = requireEnv("CLIENT_ID", CLIENT_ID);
const clientSecret = requireEnv("CLIENT_SECRET", CLIENT_SECRET);
const redirectUri = requireEnv("REDIRECT_URI", REDIRECT_URI);
const frontendUrl = requireEnv("FRONTEND_URL", FRONTEND_URL);
const apiBaseUrl = requireEnv("API_BASE_URL", API_BASE_URL);

const sessions = new Map<string, Session>();
const loginStates = new Map<string, LoginState>();

const issuer = await Issuer.discover(issuerUrl);
const client = new issuer.Client({
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uris: [redirectUri],
  response_types: ["code"],
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);

function getSession(sessionId?: string) {
  if (!sessionId) {
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (session.expiresAt && session.expiresAt * 1000 < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, session };
}

function tokenClaims(tokenSet: TokenSet) {
  return tokenSet.claims();
}

app.get("/auth/login", (c) => {
  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  loginStates.set(state, {
    codeVerifier,
    nonce,
    createdAt: Date.now(),
  });

  const authorizationUrl = client.authorizationUrl({
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    redirect_uri: redirectUri,
  });

  return c.redirect(authorizationUrl);
});

app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  const loginState = loginStates.get(state);
  if (!loginState) {
    return c.json({ error: "Invalid state" }, 400);
  }
  loginStates.delete(state);

  const tokenSet = await client.callback(
    redirectUri,
    { code, state },
    {
      code_verifier: loginState.codeVerifier,
      nonce: loginState.nonce,
      state,
    }
  );

  const sessionId = randomUUID();
  sessions.set(sessionId, {
    accessToken: tokenSet.access_token ?? "",
    expiresAt: tokenSet.expires_at,
    claims: tokenClaims(tokenSet),
  });

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });

  return c.redirect(frontendUrl);
});

app.get("/me", (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  const data = getSession(sessionId);
  if (!data) {
    return c.json({ error: "Unauthenticated" }, 401);
  }
  return c.json({ user: data.session.claims });
});

app.all("/api/*", async (c) => {
  const urlPath = c.req.path.replace(/^\/api/, "");
  const targetUrl = new URL(urlPath, apiBaseUrl).toString();

  const isHealthCheck = urlPath === "/health";
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  const sessionData = getSession(sessionId);
  if (!isHealthCheck && !sessionData) {
    return c.json({ error: "Unauthenticated" }, 401);
  }

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (["host", "cookie", "content-length"].includes(key)) return;
    headers.set(key, value);
  });
  if (sessionData?.session.accessToken) {
    headers.set("authorization", `Bearer ${sessionData.session.accessToken}`);
  }

  const method = c.req.method;
  const needsBody = method !== "GET" && method !== "HEAD";
  const body = needsBody ? await c.req.arrayBuffer() : undefined;

  const response = await fetch(targetUrl, {
    method,
    headers,
    body: needsBody ? body : undefined,
  });

  const responseBody = await response.text();
  const contentType = response.headers.get("content-type");
  if (contentType) {
    c.header("content-type", contentType);
  }
  return c.body(responseBody, response.status);
});

app.get("/health", (c) => c.json({ status: "ok" }));

serve({
  fetch: app.fetch,
  port: Number(PORT),
  hostname: "0.0.0.0",
});
