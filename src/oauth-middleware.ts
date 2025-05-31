export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

interface OAuthState {
  redirectTo?: string;
  codeVerifier: string;
}

export async function handleOAuth(request: Request, env: Env, scope = "user:email"): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/login') {
    return handleLogin(request, env, scope);
  }
  
  if (path === '/callback') {
    return handleCallback(request, env);
  }
  
  if (path === '/logout') {
    return handleLogout(request);
  }

  return null; // Not an OAuth route, let other handlers take over
}

async function handleLogin(request: Request, env: Env, scope:string): Promise<Response> {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirect_to') || '/';
  
  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  
  // Create state with redirect info and code verifier
  const state: OAuthState = {
    redirectTo,
    codeVerifier
  };
  
  const stateString = btoa(JSON.stringify(state));
  
  // Build GitHub OAuth URL
  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set('redirect_uri', `${url.origin}/callback`);
  githubUrl.searchParams.set('scope', scope);
  githubUrl.searchParams.set('state', stateString);
  githubUrl.searchParams.set('code_challenge', codeChallenge);
  githubUrl.searchParams.set('code_challenge_method', 'S256');
  
  
  return new Response(null,{status:302,headers:{Location:githubUrl.toString(),"Set-Cookie":`oauth_state=${encodeURIComponent(stateString)}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`}})
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  
  if (!code || !stateParam) {
    return new Response('Missing code or state parameter', { status: 400 });
  }
  
  // Get state from cookie
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const stateCookie = cookies.oauth_state;
  console.log({stateCookie,stateParam})
  if (!stateCookie || stateCookie !== stateParam) {
    return new Response('Invalid state parameter', { status: 400 });
  }
  
  // Parse state
  let state: OAuthState;
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return new Response('Invalid state format', { status: 400 });
  }
  
  // Exchange code for token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
      code_verifier: state.codeVerifier
    })
  });
  
  const tokenData = await tokenResponse.json() as any;
  
  if (!tokenData.access_token) {
    return new Response('Failed to get access token', { status: 400 });
  }
  
  // Get user info
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OAuth-Worker'
    }
  });
  
  if (!userResponse.ok) {
    return new Response('Failed to get user info', { status: 400 });
  }
  
  const userData = await userResponse.json() as any;
  
  // Create session token (simple JWT-like structure)
  const sessionData = {
    user: userData,
    accessToken: tokenData.access_token,
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  };
  
  const sessionToken = btoa(JSON.stringify(sessionData));
  
  // Redirect to original destination
  const headers = new Headers({Location:state.redirectTo||'/'})
  
  // Clear oauth state cookie and set session cookie
  headers.append('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  headers.append('Set-Cookie', `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; Path=/`);
  
  return new Response(null,{status:302,headers});
}

async function handleLogout(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirect_to') || '/';  
  return new Response(null,{status:302,headers:{Location:redirectTo,"Set-Cookie":'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'}});
}

// Helper function to get current user from session
export function getCurrentUser(request: Request): any | null {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionToken = cookies.session;
  
  if (!sessionToken) return null;
  
  try {
    const sessionData = JSON.parse(atob(sessionToken));
    
    // Check if session is expired
    if (Date.now() > sessionData.exp) {
      return null;
    }
    
    return sessionData.user;
  } catch {
    return null;
  }
}

// Helper function to get access token from session
export function getAccessToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionToken = cookies.session;
  
  if (!sessionToken) return null;
  
  try {
    const sessionData = JSON.parse(atob(sessionToken));
    
    // Check if session is expired
    if (Date.now() > sessionData.exp) {
      return null;
    }
    
    return sessionData.accessToken;
  } catch {
    return null;
  }
}

// Utility functions
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  
  return cookies;
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}