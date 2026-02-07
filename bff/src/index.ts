import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Issuer, generators, type TokenSet } from "openid-client";
import { randomUUID } from "node:crypto";

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
  COOKIE_SECRET,
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
const cookieSecret = requireEnv("COOKIE_SECRET", COOKIE_SECRET);

const sessions = new Map<string, Session>();
const loginStates = new Map<string, LoginState>();

const issuer = await Issuer.discover(issuerUrl);
const client = new issuer.Client({
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uris: [redirectUri],
  response_types: ["code"],
});

const app = Fastify({ logger: true });

await app.register(cookie, {
  secret: cookieSecret,
});

await app.register(cors, {
  origin: frontendUrl,
  credentials: true,
});

function getSession(request: typeof app.request) {
  const sessionId = request.cookies[SESSION_COOKIE_NAME];
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

app.get("/auth/login", async (_request, reply) => {
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

  return reply.redirect(authorizationUrl);
});

app.get("/auth/callback", async (request, reply) => {
  const { code, state } = request.query as { code?: string; state?: string };
  if (!code || !state) {
    return reply.status(400).send({ error: "Missing code or state" });
  }

  const loginState = loginStates.get(state);
  if (!loginState) {
    return reply.status(400).send({ error: "Invalid state" });
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

  reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return reply.redirect(frontendUrl);
});

app.get("/me", async (request, reply) => {
  const data = getSession(request);
  if (!data) {
    return reply.status(401).send({ error: "Unauthenticated" });
  }
  return reply.send({ user: data.session.claims });
});

app.all("/api/*", async (request, reply) => {
  const urlPath = request.url.replace(/^\/api/, "");
  const targetUrl = new URL(urlPath, apiBaseUrl).toString();

  const isHealthCheck = urlPath === "/health";
  const sessionData = getSession(request);
  if (!isHealthCheck && !sessionData) {
    return reply.status(401).send({ error: "Unauthenticated" });
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) continue;
    if (["host", "cookie", "content-length"].includes(key)) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  if (sessionData?.session.accessToken) {
    headers.set("authorization", `Bearer ${sessionData.session.accessToken}`);
  }

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (typeof request.body === "string") {
      body = request.body;
    } else if (request.body) {
      body = JSON.stringify(request.body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
  }

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body,
  });

  const responseText = await response.text();
  const contentType = response.headers.get("content-type");
  if (contentType) {
    reply.header("content-type", contentType);
  }
  return reply.status(response.status).send(responseText);
});

app.get("/health", async () => ({ status: "ok" }));

await app.listen({ port: Number(PORT), host: "0.0.0.0" });
