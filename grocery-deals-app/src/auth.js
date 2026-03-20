const config = {
  domain: import.meta.env.VITE_COGNITO_DOMAIN,
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
  redirectSignIn:
    import.meta.env.VITE_COGNITO_REDIRECT_SIGNIN ||
    `${window.location.origin}/callback.html`,
  redirectSignOut:
    import.meta.env.VITE_COGNITO_REDIRECT_SIGNOUT ||
    `${window.location.origin}/`,
  scopes: (import.meta.env.VITE_COGNITO_SCOPES || "openid email profile").split(" ")
};

const STORAGE_KEYS = {
  idToken: "gd_id_token",
  accessToken: "gd_access_token",
  expiresAt: "gd_expires_at",
  state: "gd_oauth_state",
  codeVerifier: "gd_code_verifier"
};

let pendingCallbackSearch = null;
let pendingCallbackPromise = null;
let completedCallbackSearch = null;

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(message) {
  const data = new TextEncoder().encode(message);
  return await crypto.subtle.digest("SHA-256", data);
}

function randomString(length = 64) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => charset[x % charset.length]).join("");
}

export function isAuthenticated() {
  const token = localStorage.getItem(STORAGE_KEYS.idToken);
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || "0");
  return Boolean(token) && Date.now() < expiresAt;
}

export function getIdToken() {
  return localStorage.getItem(STORAGE_KEYS.idToken);
}

export async function login() {
  if (!config.domain || !config.clientId || !config.redirectSignIn) {
    throw new Error("Missing Cognito config in .env");
  }

  const state = randomString(32);
  const codeVerifier = randomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

  localStorage.setItem(STORAGE_KEYS.state, state);
  localStorage.setItem(STORAGE_KEYS.codeVerifier, codeVerifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: config.scopes.join(" "),
    redirect_uri: config.redirectSignIn,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  window.location.href = `https://${config.domain}/oauth2/authorize?${params.toString()}`;
}

export async function handleCallback(search) {
  console.info("[auth] handleCallback:start", { search });

  if (completedCallbackSearch === search && isAuthenticated()) {
    console.info("[auth] handleCallback:already-completed");
    return;
  }

  if (pendingCallbackSearch === search && pendingCallbackPromise) {
    console.info("[auth] handleCallback:reusing-pending-request");
    return pendingCallbackPromise;
  }

  pendingCallbackSearch = search;
  pendingCallbackPromise = (async () => {
    const urlParams = new URLSearchParams(search);
    const code = urlParams.get("code");
    const state = urlParams.get("state");

    const expectedState = localStorage.getItem(STORAGE_KEYS.state);
    const codeVerifier = localStorage.getItem(STORAGE_KEYS.codeVerifier);

    if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
      console.error("[auth] handleCallback:invalid-state", {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasExpectedState: Boolean(expectedState),
        stateMatches: state === expectedState,
        hasCodeVerifier: Boolean(codeVerifier)
      });
      throw new Error("Invalid OAuth callback state");
    }

    const tokenUrl = `https://${config.domain}/oauth2/token`;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectSignIn,
      code_verifier: codeVerifier
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[auth] handleCallback:token-exchange-failed", {
        status: response.status,
        body: text
      });
      throw new Error(`Token exchange failed: ${response.status} ${text}`);
    }

    const tokens = await response.json();
    const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

    localStorage.setItem(STORAGE_KEYS.idToken, tokens.id_token);
    localStorage.setItem(STORAGE_KEYS.accessToken, tokens.access_token || "");
    localStorage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));

    localStorage.removeItem(STORAGE_KEYS.state);
    localStorage.removeItem(STORAGE_KEYS.codeVerifier);
    completedCallbackSearch = search;
    console.info("[auth] handleCallback:success", {
      hasIdToken: Boolean(tokens.id_token),
      hasAccessToken: Boolean(tokens.access_token)
    });
  })();

  try {
    await pendingCallbackPromise;
  } finally {
    pendingCallbackSearch = null;
    pendingCallbackPromise = null;
  }
}

export function logout() {
  localStorage.removeItem(STORAGE_KEYS.idToken);
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.expiresAt);

  if (!config.domain || !config.clientId || !config.redirectSignOut) {
    return;
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.redirectSignOut
  });

  window.location.href = `https://${config.domain}/logout?${params.toString()}`;
}
