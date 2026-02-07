import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { serve } from "@hono/node-server";

const { PORT = "5000", OIDC_ISSUER, OIDC_AUDIENCE } = process.env;

function requireEnv(name: string, value?: string): string {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const issuer = requireEnv("OIDC_ISSUER", OIDC_ISSUER);
const audience = requireEnv("OIDC_AUDIENCE", OIDC_AUDIENCE);

const jwksUri = new URL(`${issuer}/protocol/openid-connect/certs`);
const jwks = createRemoteJWKSet(jwksUri);

const app = new Hono();

async function verifyBearer(authHeader?: string): Promise<JWTPayload> {
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new Error("Invalid Authorization header");
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
  });

  return payload;
}

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/protected", async (c) => {
  try {
    const payload = await verifyBearer(c.req.header("authorization"));
    return c.json({
      message: "Protected data",
      subject: payload.sub,
      email: payload.email,
    });
  } catch (error) {
    console.warn("JWT verification failed", error);
    return c.json({ error: "Unauthorized" }, 401);
  }
});

serve({
  fetch: app.fetch,
  port: Number(PORT),
  hostname: "0.0.0.0",
});
