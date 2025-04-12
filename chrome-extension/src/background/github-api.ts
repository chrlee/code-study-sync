import { githubAuthStorage, githubRepoStorage } from '@extension/storage';

export async function commitSolutionToGithub(data: {
  problemId: string;
  problemName: string;
  language: string;
  extension?: string;
  code: string;
}) {
  try {
    console.log(`[GITHUB] Starting commit with code length: ${data.code.length}`);

    // Get GitHub token
    const token = await githubAuthStorage.get();

    // Get repository configuration
    const repoConfig = await githubRepoStorage.get();
    if (!token || !repoConfig || !repoConfig.owner || !repoConfig.repo) {
      throw new Error('Missing GitHub configuration');
    }

    // Create filename with the extension
    const extension = data.extension || 'txt';
    const timestamp = Date.now();
    const fileName = `${data.problemId}_${timestamp}.${extension}`;

    // Determine file path
    let filePath = fileName;
    if (repoConfig.path) {
      const path = repoConfig.path.endsWith('/') ? repoConfig.path : `${repoConfig.path}/`;
      filePath = `${path}${fileName}`;
    }

    console.log(`[GITHUB] Saving to path: ${filePath}`);

    // Create commit message
    const commitMessage = `Solution for ${data.problemId}: ${data.problemName} (${data.language})`;

    // Base64 encode the content
    const base64Content = btoa(unescape(encodeURIComponent(data.code)));

    // Make GitHub API call
    const apiUrl = `https://api.github.com/repos/${repoConfig.owner}/${repoConfig.repo}/contents/${filePath}`;

    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: base64Content,
        branch: repoConfig.branch || 'main',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`GitHub API error: ${errorData.message}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[GITHUB] Error:', error);
    throw error;
  }
}
/**
 * Gets file information from GitHub
 */
async function getFileInfo(owner: string, repo: string, path: string, branch: string, token: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get file: ${response.status}`);
  }

  return response.json();
}

/**
 * Updates or creates a file on GitHub
 */
async function updateFile({
  owner,
  repo,
  path,
  message,
  content,
  sha,
  branch,
  token,
}: {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string;
  sha?: string;
  branch: string;
  token: string;
}) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const body: Record<string, any> = {
    message,
    content,
    branch,
  };

  // If sha is provided, it's an update rather than a create
  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`GitHub API error: ${error.message}`);
  }

  return response.json();
}

/**
 * Gets the file extension based on the programming language
 */
function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    python3: 'py',
    java: 'java',
    'c++': 'cpp',
    c: 'c',
    csharp: 'cs',
    ruby: 'rb',
    swift: 'swift',
    kotlin: 'kt',
    go: 'go',
    rust: 'rs',
    scala: 'scala',
    php: 'php',
  };

  return extensions[language.toLowerCase()] || 'txt';
}

/**
 * Formats a problem name to be used as a file name
 */
function formatFileName(name: string): string {
  // Replace spaces with underscores and remove special characters
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w-]/g, '');
}

/**
 * Fetches the user's GitHub repositories
 */
export async function fetchUserRepositories(): Promise<Array<{ name: string; full_name: string }>> {
  const token = await githubAuthStorage.get();
  if (!token) {
    throw new Error('Not authenticated with GitHub');
  }

  const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch repositories: ${response.status}`);
  }

  const repos = await response.json();

  // Return only the needed data
  return repos.map((repo: any) => ({
    name: repo.name,
    full_name: repo.full_name,
  }));
}
