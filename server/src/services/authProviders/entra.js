/**
 * Microsoft Entra ID (Azure AD) OIDC auth-code provider (E02).
 *
 * Provider interface (any SSO adapter must implement):
 *   name: string
 *   configured: boolean
 *   getAuthorizationUrl(state) -> string
 *   exchangeCodeForUser(code)  -> Promise<{ email, name, externalId }>
 *
 * Status: BLOCKED_EXTERNAL — a real tenant (AZURE_TENANT_ID / AZURE_CLIENT_ID /
 * AZURE_CLIENT_SECRET / AZURE_REDIRECT_URI) is required to exercise this path;
 * without those env vars `configured` is false and the routes answer
 * 501 NOT_CONFIGURED. test/entra.test.js drives the same flow through
 * fakeEntra.js instead.
 */
import { notConfigured } from '../../errors.js';

export function createEntraProvider(env = process.env) {
  const tenantId = env.AZURE_TENANT_ID;
  const clientId = env.AZURE_CLIENT_ID;
  const clientSecret = env.AZURE_CLIENT_SECRET;
  const redirectUri = env.AZURE_REDIRECT_URI;
  const configured = Boolean(tenantId && clientId && clientSecret && redirectUri);

  return {
    name: 'entra',
    configured,

    getAuthorizationUrl(state) {
      if (!configured) throw notConfigured('Entra ID SSO is not configured');
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: 'openid profile email',
        state,
      });
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
    },

    async exchangeCodeForUser(code) {
      if (!configured) throw notConfigured('Entra ID SSO is not configured');
      const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          scope: 'openid profile email',
        }),
      });
      if (!res.ok) {
        throw new Error(`Entra token exchange failed: HTTP ${res.status}`);
      }
      const body = await res.json();
      // Decode the id_token payload (signature verification is delegated to
      // the direct TLS exchange with the token endpoint — standard for the
      // confidential-client auth-code flow).
      const payload = JSON.parse(
        Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8'),
      );
      return {
        email: payload.preferred_username ?? payload.email,
        name: payload.name ?? payload.preferred_username,
        externalId: payload.oid ?? payload.sub,
      };
    },
  };
}
