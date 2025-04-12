// chrome-extension/src/background/index.ts
import 'webextension-polyfill';
import { githubAuthStorage, githubRepoStorage, githubDeviceCodeStorage } from '@extension/storage';
import { getGithubUserInfo, isAuthenticated, pollForAccessToken, signOut, startDeviceFlow } from './github-auth';
import { commitSolutionToGithub, fetchUserRepositories } from './github-api';

/**
 * Setup message handlers for the extension
 */
function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Organize message handlers by functionality
    const handlers = {
      // Authentication flow handlers
      'github-login': handleGithubLogin,
      'check-device-flow': handleCheckDeviceFlow,
      'cancel-device-flow': handleCancelDeviceFlow,
      'check-auth-status': handleCheckAuthStatus,
      'github-logout': handleLogout,
      'open-verification-page': handleOpenVerificationPage,

      // Repository management handlers
      'fetch-github-repos': handleFetchRepositories,
      'save-repo-config': handleSaveRepoConfig,
      'update-repo-path': handleUpdateRepoPath,

      // LeetCode integration handlers
      'submit-leetcode-solution': handleSubmitLeetCodeSolution,
    };

    // Call the appropriate handler if it exists
    const handler = handlers[message.action];
    if (handler) {
      return handler(message, sendResponse);
    }

    return false;
  });
}

/**
 * Handle GitHub login request
 */
function handleGithubLogin(message, sendResponse) {
  console.log('[BACKGROUND] GitHub login request received');

  githubDeviceCodeStorage
    .isActive()
    .then(async isActive => {
      try {
        console.log('active: ', isActive);
        if (isActive) {
          // Return existing device code info
          const deviceInfo = await githubDeviceCodeStorage.get();
          sendResponse({
            success: true,
            alreadyInProgress: true,
            deviceCode: deviceInfo.user_code,
            verificationUrl: deviceInfo.verification_uri,
          });
          return;
        }

        // Start a new device flow
        const deviceInfo = await startDeviceFlow();

        // Send response with device code info
        sendResponse({
          success: true,
          deviceCode: deviceInfo.user_code,
          verificationUrl: deviceInfo.verification_uri,
        });

        // We don't open the verification page automatically anymore
        // The user will need to click a button in the popup

        // Start polling for token in background
        pollForAccessToken(deviceInfo.device_code, deviceInfo.interval)
          .then(token => {
            // Save the token
            return githubAuthStorage.set(token).then(() => {
              console.log('[BACKGROUND] Authentication completed successfully');
              githubDeviceCodeStorage.clear();
            });
          })
          .catch(error => {
            console.error('[BACKGROUND] Authentication failed:', error);
            githubDeviceCodeStorage.clear();
          });
      } catch (error) {
        console.error('[BACKGROUND] Failed to start device flow:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start authentication',
        });
      }
    })
    .catch(error => {
      console.error('[BACKGROUND] Error checking device flow status:', error);
      sendResponse({ success: false, error: 'Internal error checking auth status' });
    });

  return true; // Indicate we'll respond asynchronously
}

/**
 * Handle opening verification page (new handler)
 */
function handleOpenVerificationPage(message, sendResponse) {
  githubDeviceCodeStorage
    .get()
    .then(deviceInfo => {
      if (deviceInfo && deviceInfo.verification_uri) {
        chrome.tabs.create({ url: deviceInfo.verification_uri });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No active device flow found' });
      }
    })
    .catch(error => {
      console.error('[BACKGROUND] Error opening verification page:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
}

/**
 * Handle check device flow status request
 */
function handleCheckDeviceFlow(message, sendResponse) {
  githubDeviceCodeStorage
    .isActive()
    .then(async isActive => {
      if (isActive) {
        const deviceInfo = await githubDeviceCodeStorage.get();
        sendResponse({
          inProgress: true,
          deviceCode: deviceInfo.user_code,
          verificationUrl: deviceInfo.verification_uri,
        });
      } else {
        sendResponse({ inProgress: false });
      }
    })
    .catch(error => {
      console.error('[BACKGROUND] Error checking device flow:', error);
      sendResponse({ inProgress: false, error: error.message });
    });

  return true;
}

/**
 * Handle cancel device flow request
 */
function handleCancelDeviceFlow(message, sendResponse) {
  githubDeviceCodeStorage
    .clear()
    .then(() => {
      console.log('[BACKGROUND] Device flow cancelled');
      sendResponse({ success: true });
    })
    .catch(error => {
      console.error('[BACKGROUND] Error cancelling device flow:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
}

/**
 * Handle check authentication status request
 */
function handleCheckAuthStatus(message, sendResponse) {
  isAuthenticated()
    .then(async isLoggedIn => {
      if (isLoggedIn) {
        const token = await githubAuthStorage.get();
        const userInfo = await getGithubUserInfo(token);
        sendResponse({ isLoggedIn, user: userInfo });
      } else {
        sendResponse({ isLoggedIn });
      }
    })
    .catch(error => {
      console.error('[BACKGROUND] Auth check error:', error);
      sendResponse({ isLoggedIn: false, error: error.message });
    });

  return true;
}

/**
 * Handle logout request
 */
function handleLogout(message, sendResponse) {
  signOut()
    .then(() => {
      console.log('[BACKGROUND] User logged out');
      sendResponse({ success: true });
    })
    .catch(error => {
      console.error('[BACKGROUND] Logout error:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
}

/**
 * Handle fetch repositories request
 */
function handleFetchRepositories(message, sendResponse) {
  githubAuthStorage
    .get()
    .then(token => {
      if (!token) {
        sendResponse({ success: false, error: 'Not authenticated with GitHub' });
        return null;
      }

      return fetchUserRepositories(token);
    })
    .then(repositories => {
      if (repositories) {
        sendResponse({ success: true, repositories });
      }
    })
    .catch(error => {
      console.error('[BACKGROUND] Error fetching repositories:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch repositories',
      });
    });

  return true;
}

/**
 * Handle update repository path request
 */
function handleUpdateRepoPath(message, sendResponse) {
  githubRepoStorage
    .updatePath(message.path)
    .then(() => {
      console.log('[BACKGROUND] Updated repository path to:', message.path);
      sendResponse({ success: true });
    })
    .catch(error => {
      console.error('[BACKGROUND] Error updating path:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update path',
      });
    });

  return true;
}

/**
 * Handle save repository configuration request
 */
function handleSaveRepoConfig(message, sendResponse) {
  githubRepoStorage
    .set(message.config)
    .then(() => {
      console.log('[BACKGROUND] Saved repository config:', message.config);
      sendResponse({ success: true });
    })
    .catch(error => {
      console.error('[BACKGROUND] Error saving repo config:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
}

/**
 * Handle submit LeetCode solution request
 */
function handleSubmitLeetCodeSolution(message, sendResponse) {
  console.log('[BACKGROUND] Received solution data:', {
    problemId: message.data.problemId,
    problemName: message.data.problemName,
    language: message.data.language,
    codeLength: message.data.code?.length || 0,
  });

  commitSolutionToGithub(message.data)
    .then(result => {
      console.log('[BACKGROUND] Solution committed successfully:', result);
      sendResponse({ success: true, result });
    })
    .catch(error => {
      console.error('[BACKGROUND] Failed to commit solution:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to commit solution to GitHub',
      });
    });

  return true;
}

/**
 * Initialize the extension
 */
function init() {
  console.log('[BACKGROUND] Script loaded at:', new Date().toISOString());

  // Set up message handlers
  setupMessageHandlers();

  // Listen for installation events
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    console.log('[BACKGROUND] Extension installed/updated:', reason);

    // Clear any stale device codes on install/update
    githubDeviceCodeStorage.clear().catch(console.error);
  });

  console.log('[BACKGROUND] Script initialized successfully');
}

// Start the extension
init();
