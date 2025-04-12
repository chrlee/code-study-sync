// pages/popup/src/Popup.tsx
import { useState, useEffect } from 'react';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { githubAuthStorage, githubDeviceCodeStorage, githubRepoStorage } from '@extension/storage';
import '@src/Popup.css';

const Popup = () => {
  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ login: string; name?: string; avatar_url: string } | null>(null);
  const [repositories, setRepositories] = useState<{ name: string; full_name: string }[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [authPolling, setAuthPolling] = useState<number | null>(null);

  // Get config from storage
  const authToken = useStorage(githubAuthStorage);
  const repoConfig = useStorage(githubRepoStorage);
  const deviceInfo = useStorage(githubDeviceCodeStorage);

  // Derived state
  const isAuthenticated = Boolean(authToken);
  const isRepoConfigured = Boolean(repoConfig.owner && repoConfig.repo);
  const deviceFlowInProgress = deviceInfo !== null;

  // Check auth status on load
  useEffect(() => {
    if (isAuthenticated) {
      checkAuthStatus();
    }
  }, [isAuthenticated]);

  // Fetch repos when authenticated
  useEffect(() => {
    if (isAuthenticated && !repositories.length) {
      fetchRepositories();
    }

    if (isRepoConfigured) {
      setSelectedRepo(`${repoConfig.owner}/${repoConfig.repo}`);
    }
  }, [isAuthenticated, isRepoConfigured, user]);

  // Start polling for auth status if device flow is in progress
  useEffect(() => {
    if (deviceFlowInProgress && !authToken) {
      startAuthPolling();
    }

    return () => {
      if (authPolling) {
        clearInterval(authPolling);
      }
    };
  }, [deviceFlowInProgress, authToken]);

  // Check auth status and get user info
  const checkAuthStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'check-auth-status' });

      if (response && response.isLoggedIn) {
        setUser(response.user);
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
    }
  };

  const handleGithubLogin = () => {
    setIsLoading(true);
    setError(null);

    chrome.runtime.sendMessage({ action: 'github-login' }, response => {
      setIsLoading(false);

      if (chrome.runtime.lastError || !response || !response.success) {
        setError(response?.error || 'Failed to start authentication');
        return;
      }

      // Give user time to see and copy code before GitHub tab opens
      // The background script should be modified to NOT open a tab immediately
      setTimeout(() => {
        if (deviceInfo?.verification_uri) {
          chrome.tabs.create({ url: deviceInfo.verification_uri });
        }
      }, 5000); // Wait 5 seconds before opening GitHub
    });
  };

  // Open the verification URL in a new tab
  const openVerificationUrl = () => {
    if (deviceInfo?.verification_uri) {
      chrome.tabs.create({ url: deviceInfo.verification_uri });
    }
  };

  // Cancel the device flow
  const cancelDeviceFlow = () => {
    chrome.runtime.sendMessage({ action: 'cancel-device-flow' }, () => {
      stopAuthPolling();
    });
  };

  // Start polling for authentication status
  const startAuthPolling = () => {
    // Clear any existing polling
    if (authPolling) {
      clearInterval(authPolling);
      return;
    }

    // Poll every 2 seconds
    const intervalId = window.setInterval(() => {
      chrome.runtime.sendMessage({ action: 'check-auth-status' }, response => {
        if (response && response.isLoggedIn) {
          // Auth successful!
          setUser(response.user);
          setShowSuccess(true);
          stopAuthPolling();

          // Fetch repositories after a brief delay
          setTimeout(() => {
            setShowSuccess(false);
            fetchRepositories();
          }, 2000);
        }
      });
    }, 2000);

    setAuthPolling(intervalId);
  };

  // Stop polling for authentication status
  const stopAuthPolling = () => {
    if (authPolling) {
      clearInterval(authPolling);
      setAuthPolling(null);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    setIsLoading(true);

    try {
      await chrome.runtime.sendMessage({ action: 'github-logout' });
      setUser(null);
      setRepositories([]);
      setSelectedRepo('');
    } catch (err) {
      setError('Failed to log out');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch user's GitHub repositories
  const fetchRepositories = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await chrome.runtime.sendMessage({ action: 'fetch-github-repos' });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to fetch repositories');
      }

      setRepositories(response.repositories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repositories');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle repository selection
  const handleRepositoryChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const fullName = event.target.value;
    setSelectedRepo(fullName);

    if (!fullName) return;

    const [owner, repo] = fullName.split('/');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'save-repo-config',
        config: {
          owner,
          repo,
          branch: repoConfig.branch || 'main',
          path: repoConfig.path || 'leetcode-solutions',
        },
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to save repository configuration');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save repository configuration');
    }
  };

  // Handle path configuration
  const handlePathChange = async (event: React.FocusEvent<HTMLInputElement>) => {
    const path = event.target.value.trim();
    if (path === repoConfig.path) return; // No changes

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'update-repo-path',
        path,
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to update solutions path');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update solutions path');
    }
  };

  const renderDeviceFlowUI = () => {
    return (
      <div className="text-center py-4 bg-gray-50 dark:bg-gray-700 rounded-lg px-4">
        <div className="mb-4">
          <p className="font-medium">GitHub Authorization</p>
          <div className="animate-pulse mx-auto my-2 h-1 w-16 bg-blue-500 rounded"></div>
        </div>

        {deviceInfo && (
          <>
            <div className="my-4 bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
              <p className="text-sm mb-2">Enter this code on GitHub:</p>
              <div className="flex justify-center">
                <code className="text-2xl font-bold tracking-wider bg-gray-100 dark:bg-gray-900 px-4 py-2 rounded">
                  {deviceInfo.user_code}
                </code>
              </div>
            </div>

            <button
              onClick={openVerificationUrl}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded mt-2 w-full">
              Open GitHub Verification Page
            </button>

            <p className="text-xs text-gray-500 mt-3 mb-3">
              After clicking the button above, enter the code on GitHub to complete authentication
            </p>
          </>
        )}

        <button onClick={cancelDeviceFlow} className="text-sm text-red-500 hover:text-red-700">
          Cancel
        </button>
      </div>
    );
  };

  // Render based on authentication state
  return (
    <div className="popup-container p-4 bg-slate-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100">
      <header className="flex justify-between items-center mb-6">
        {user && (
          <>
            <div className="flex items-center">
              <img src={user.avatar_url} alt={user.login} className="w-6 h-6 rounded-full mr-2" />
              <span className="text-sm mr-2">{user.name || user.login}</span>
            </div>
            <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700" disabled={isLoading}>
              Sign Out
            </button>
          </>
        )}
      </header>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-2 mb-4" role="alert">
          <p>{error}</p>
        </div>
      )}

      {showSuccess && (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-2 mb-4" role="alert">
          <p>Successfully connected to GitHub!</p>
        </div>
      )}

      {!isAuthenticated ? (
        <div className="flex flex-col space-y-4">
          {deviceFlowInProgress ? (
            renderDeviceFlowUI()
          ) : (
            <button
              onClick={handleGithubLogin}
              disabled={isLoading}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded flex items-center justify-center disabled:opacity-50">
              {isLoading ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Connecting...
                </span>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Connect with GitHub
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        <div>
          {repositories.length > 0 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="repository">
                  Select Repository:
                </label>
                <select
                  id="repository"
                  value={selectedRepo}
                  onChange={handleRepositoryChange}
                  disabled={isLoading}
                  className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                  <option value="">Select a repository</option>
                  {repositories.map(repo => (
                    <option key={repo.full_name} value={repo.full_name}>
                      {repo.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedRepo && (
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="solutionPath">
                    Solutions Directory:
                  </label>
                  <input
                    type="text"
                    id="solutionPath"
                    defaultValue={repoConfig.path}
                    onBlur={handlePathChange}
                    placeholder="leetcode-solutions"
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              )}

              {isRepoConfigured && (
                <div className="mt-6 p-3 bg-green-100 dark:bg-green-800 rounded">
                  <p className="text-sm text-green-800 dark:text-green-100">
                    <span className="font-medium">Ready!</span> Your LeetCode solutions will be saved to:
                    <br />
                    <code className="block mt-1 font-mono bg-white dark:bg-gray-700 p-2 rounded">
                      {repoConfig.owner}/{repoConfig.repo}/{repoConfig.path}/
                    </code>
                  </p>
                </div>
              )}
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p>No repositories found.</p>
              <button onClick={fetchRepositories} className="text-blue-500 hover:underline mt-2 text-sm">
                Refresh repositories
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 border-t pt-4 text-xs text-gray-500">
        <p className="text-center">LeetCode to GitHub Extension</p>
      </div>
    </div>
  );
};

export default withErrorBoundary(
  withSuspense(Popup, <div className="p-4">Loading...</div>),
  <div className="p-4 text-red-500">Something went wrong</div>,
);
