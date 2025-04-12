// chrome-extension/src/background/github-auth.ts
import { githubAuthStorage, githubDeviceCodeStorage } from '@extension/storage';

const CLIENT_ID = 'Ov23liGv4JgHmvPmvmgW';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const SCOPE = 'read:user user:email repo';

/**
 * Starts the GitHub device flow and returns the device code data
 */
export async function startDeviceFlow() {
  console.log('[GITHUB-AUTH] Starting device flow');

  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: SCOPE,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('[GITHUB-AUTH] Device flow error:', errorText);
    throw new Error('Failed to initiate GitHub device flow');
  }

  const data = await res.json();
  console.log('[GITHUB-AUTH] Device flow started successfully:', {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
  });

  // Calculate expiration timestamp
  const expiresAt = Date.now() + data.expires_in * 1000;

  // Store the device code info with expiration timestamp
  const deviceInfo = {
    ...data,
    expires_at: expiresAt,
  };

  // Store directly in storage
  await githubDeviceCodeStorage.set(deviceInfo);

  return data;
}

/**
 * Polls GitHub for the access token
 */
export async function pollForAccessToken(deviceCode: string, interval: number): Promise<string> {
  console.log('[GITHUB-AUTH] Starting token polling');

  // Keep track of attempts
  let attempts = 0;
  const maxAttempts = 60; // About 5 minutes with 5s interval

  while (attempts < maxAttempts) {
    attempts++;

    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!res.ok) {
        console.warn(`[GITHUB-AUTH] Token request failed with status ${res.status}`);
        await new Promise(r => setTimeout(r, interval * 1000));
        continue;
      }

      const data = await res.json();

      if (data.access_token) {
        console.log('[GITHUB-AUTH] Successfully obtained access token');
        return data.access_token;
      }

      if (data.error === 'authorization_pending') {
        console.log(`[GITHUB-AUTH] Authorization pending (attempt ${attempts}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, interval * 1000));
      } else {
        console.error('[GITHUB-AUTH] OAuth error:', data.error);
        throw new Error(`GitHub OAuth failed: ${data.error}`);
      }
    } catch (error) {
      console.error('[GITHUB-AUTH] Error during token polling:', error);
      throw error;
    }
  }

  // If we exit the loop without returning a token, the user didn't authorize in time
  throw new Error('Authentication timed out. Please try again.');
}

/**
 * Validates a GitHub access token
 */
export async function validateGithubToken(token: string): Promise<boolean> {
  try {
    console.log('[GITHUB-AUTH] Validating token');
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const isValid = res.status === 200;
    console.log(`[GITHUB-AUTH] Token validation result: ${isValid ? 'valid' : 'invalid'}`);
    return isValid;
  } catch (error) {
    console.error('[GITHUB-AUTH] Token validation error:', error);
    return false;
  }
}

/**
 * Gets the authenticated user's info
 */
export async function getGithubUserInfo(token: string): Promise<{ login: string; name: string; avatar_url: string }> {
  console.log('[GITHUB-AUTH] Fetching user info');
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) {
    console.error(`[GITHUB-AUTH] Failed to fetch user info: ${res.status}`);
    throw new Error('Failed to fetch user information');
  }

  return res.json();
}

/**
 * Checks if user is authenticated with GitHub
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await githubAuthStorage.get();
  if (!token) {
    console.log('[GITHUB-AUTH] No token found, not authenticated');
    return false;
  }

  return validateGithubToken(token);
}

/**
 * Signs out from GitHub by removing the stored token
 */
export async function signOut(): Promise<void> {
  console.log('[GITHUB-AUTH] Signing out, clearing token');
  await githubAuthStorage.clear();
}
