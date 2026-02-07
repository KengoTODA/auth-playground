import Fastify from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

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

const app = Fastify({ logger: true });

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

app.get("/health", async () => ({ status: "ok" }));

app.get("/protected", async (request, reply) => {
  try {
    const payload = await verifyBearer(request.headers.authorization);
    return reply.send({
      message: "Protected data",
      subject: payload.sub,
      email: payload.email,
    });
  } catch (error) {
    request.log.warn({ error }, "JWT verification failed");
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

await app.listen({ port: Number(PORT), host: "0.0.0.0" });
