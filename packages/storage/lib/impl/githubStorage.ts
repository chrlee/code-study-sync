// packages/storage/lib/impl/githubStorage.ts
import type { BaseStorage } from '../base/index.js';
import { createStorage, StorageEnum } from '../base/index.js';

// GitHub Auth Token Storage
const authTokenStorage = createStorage<string>('github_auth_token', '', {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type GithubAuthStorage = BaseStorage<string> & {
  clear: () => Promise<void>;
  isAuthenticated: () => Promise<boolean>;
};

// Export the auth token storage with extended methods
export const githubAuthStorage: GithubAuthStorage = {
  ...authTokenStorage,
  clear: async () => {
    await authTokenStorage.set('');
  },
  isAuthenticated: async () => {
    const token = await authTokenStorage.get();
    return Boolean(token);
  },
};

// Repository Configuration Interface
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

// Create repository configuration storage
const repoConfigStorage = createStorage<RepoConfig>(
  'github_selected_repo',
  {
    owner: '',
    repo: '',
    branch: 'main',
    path: 'leetcode-solutions',
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export type GithubRepoStorage = BaseStorage<RepoConfig> & {
  isConfigured: () => Promise<boolean>;
  updatePath: (path: string) => Promise<void>;
};

// Export the repository storage with extended methods
export const githubRepoStorage: GithubRepoStorage = {
  ...repoConfigStorage,
  isConfigured: async () => {
    const config = await repoConfigStorage.get();
    return Boolean(config.owner && config.repo);
  },
  updatePath: async (path: string) => {
    await repoConfigStorage.set(config => ({
      ...config,
      path,
    }));
  },
};

// Device Code Information Interface
export interface DeviceCodeInfo {
  device_code: string; // Used for token polling
  user_code: string; // Code shown to user
  verification_uri: string; // URL where user enters the code
  interval: number; // Polling interval in seconds
  expires_in: number; // Expiration time in seconds
  expires_at?: number; // Calculated timestamp for expiration
}

// Create device code storage
const deviceCodeStorage = createStorage<DeviceCodeInfo | null>('github_device_code', null, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type GithubDeviceCodeStorage = BaseStorage<DeviceCodeInfo | null> & {
  clear: () => Promise<void>;
  isActive: () => Promise<boolean>;
  setWithExpiration: (info: DeviceCodeInfo) => Promise<void>;
};

// Export the device code storage with extended methods
export const githubDeviceCodeStorage: GithubDeviceCodeStorage = {
  ...deviceCodeStorage,
  clear: async () => {
    await deviceCodeStorage.set(null);
  },
  isActive: async () => {
    const info = await deviceCodeStorage.get();
    if (!info) return false;

    // Check if expires_at exists and hasn't passed yet
    if (info.expires_at && info.expires_at > Date.now()) {
      return true;
    }

    // Check if expires_in exists, calculate expires_at, and compare
    if (info.expires_in) {
      // If expires_at doesn't exist but we have the original info,
      // calculate it now (as a fallback)
      const expiresAt = Date.now() + info.expires_in * 1000;
      if (expiresAt > Date.now()) {
        // Update the stored value with the expiration timestamp
        await deviceCodeStorage.set({
          ...info,
          expires_at: expiresAt,
        });
        return true;
      }
    }

    // If we got here, the code has expired, so clear it
    await deviceCodeStorage.set(null);
    return false;
  },
  setWithExpiration: async (info: DeviceCodeInfo) => {
    // Calculate absolute expiration time
    const expiresAt = Date.now() + info.expires_in * 1000;

    // Store with expiration timestamp
    await deviceCodeStorage.set({
      ...info,
      expires_at: expiresAt,
    });
  },
};
