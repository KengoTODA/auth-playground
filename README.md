# OIDC(SSO) + Passkeys(WebAuthn) PoC

Minimal TypeScript PoC for browser SSO (OIDC) + Passkeys (WebAuthn) using a BFF and API.

## Components
- **Keycloak**: OIDC provider + WebAuthn (passkeys).
- **Frontend**: Next.js UI that only calls the BFF.
- **BFF**: Hono server handling OAuth2 Authorization Code + PKCE and holding tokens in session.
- **API**: Hono server validating JWTs.

## Configuration Summary
- Realm: `poc`
- Issuer: `http://localhost:8080/realms/poc`
- Client: `bff` (confidential, PKCE)
- Redirect URI: `http://localhost:4000/auth/callback`

## Quick Start
```bash
docker compose up --build
```

Open the app at <http://localhost:3000>.

### Default Credentials
- **Keycloak admin**: `admin` / `admin`
- **Demo user**: `demo` / `demo`

## Flow Checklist (Acceptance Criteria)
1. Click **Login** in the frontend to trigger `/auth/login`.
2. You should be redirected to Keycloak and authenticated via OIDC (Auth Code + PKCE).
3. Returning to the app, click **/me** and **/api/protected**.
4. Confirm that repeated logins in the same browser do not prompt again (SSO).

## Enable Passkeys (WebAuthn)
1. Log into Keycloak Admin Console: <http://localhost:8080/admin>.
2. Select realm **poc**.
3. Go to **Authentication → Required Actions** and enable **WebAuthn Register** if not already enabled.
4. For the user **demo**, click **Users → demo → Required User Actions** and add **WebAuthn Register**.
5. Next login will prompt passkey registration; subsequent logins can use the passkey.

## Endpoints
### BFF (`http://localhost:4000`)
- `GET /auth/login`
- `GET /auth/callback`
- `GET /me`
- `/api/*` (proxy to API)

### API (`http://localhost:5000`)
- `GET /health` (no auth)
- `GET /protected` (Bearer token required)

## Notes
- Frontend holds only HttpOnly cookie (no tokens in browser storage).
- BFF keeps access token in server-side session memory (PoC only).
- API validates `iss`, `aud`, and `exp` using Keycloak JWKS.
