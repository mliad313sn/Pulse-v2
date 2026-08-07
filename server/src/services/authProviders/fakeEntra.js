/**
 * Test double for the Entra provider — same interface, no network.
 * The "authorization code" is simply `code:<email>`; the test drives the full
 * login -> callback flow against it. Never wired in production (`index.js`
 * always builds the real provider from env).
 */
export function createFakeEntraProvider({ directory = {} } = {}) {
  return {
    name: 'fake-entra',
    configured: true,

    getAuthorizationUrl(state) {
      return `https://fake.entra.local/authorize?state=${encodeURIComponent(state)}`;
    },

    async exchangeCodeForUser(code) {
      const email = String(code ?? '').replace(/^code:/, '');
      const extra = directory[email] ?? {};
      return {
        email,
        name: extra.name ?? email,
        externalId: extra.externalId ?? `ext-${email}`,
      };
    },
  };
}
