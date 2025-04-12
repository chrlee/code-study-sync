// Track state
let lastProcessedSubmissionId: string | null = null;
let isWaitingForSubmissionResult = false;

declare global {
  interface Window {
    monaco?: any;
  }
}

/**
 * Extract problem details from the current page
 */
function extractProblemDetails(): { problemId: string; problemName: string; submissionId: string | null } {
  let problemId = '';
  let problemName = '';
  let submissionId = null;

  // Get problem ID from URL
  const urlMatch = window.location.pathname.match(/\/problems\/([^/]+)/);
  if (urlMatch) {
    problemId = urlMatch[1];
  }

  // Try to get submission ID from URL
  const submissionMatch = window.location.pathname.match(/\/submissions\/(\d+)/);
  if (submissionMatch) {
    submissionId = submissionMatch[1];
  }

  // Get problem name from title or page elements
  const title = document.title.replace(' - LeetCode', '').trim();
  if (title) {
    const titleMatch = title.match(/^\d+\.\s+(.+)$/);
    if (titleMatch) {
      problemName = titleMatch[1];
    } else {
      problemName = title;
    }
  }

  if (!problemName) {
    const headerElement = document.querySelector('[data-cy="question-title"], .title');
    if (headerElement?.textContent) {
      problemName = headerElement.textContent.trim();
    }
  }

  return { problemId, problemName, submissionId };
}

function waitForMonacoEditor(timeout = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const interval = 100; // Check every 100ms
    let elapsed = 0;

    const check = () => {
      // Check if monaco is available on window
      if (window.monaco && window.monaco.editor) {
        // Try to get models or editors
        const models = window.monaco.editor.getModels?.() || [];
        const editors = window.monaco.editor.getEditors?.() || [];

        // If we have models with getValue method, we're good
        if (models.length > 0 && typeof models[0].getValue === 'function') {
          resolve(models[0]);
          return;
        }

        // If we have editors, try to get model from there
        if (editors.length > 0 && editors[0].getModel) {
          const model = editors[0].getModel();
          if (model && typeof model.getValue === 'function') {
            resolve(model);
            return;
          }
        }
      }

      // Not available yet, check if we've timed out
      elapsed += interval;
      if (elapsed >= timeout) {
        reject(new Error('Timed out waiting for Monaco editor.'));
      } else {
        setTimeout(check, interval);
      }
    };

    // Start checking
    check();
  });
}

function waitForEditorContainer(timeout = 10000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const interval = 100;
    let elapsed = 0;

    const check = () => {
      const container = document.querySelector('.monaco-editor');
      if (container) {
        resolve(container);
        return;
      }
      elapsed += interval;
      if (elapsed >= timeout) {
        reject(new Error('Timed out waiting for editor container to appear.'));
      } else {
        setTimeout(check, interval);
      }
    };

    check();
  });
}

async function getSolutionCode(): Promise<{ code: string; language: string }> {
  try {
    // Wait for the Monaco editor DOM container
    await waitForEditorContainer();

    // Now wait for Monaco to initialize and load a model
    const model = await waitForMonacoEditor();
    const code = model.getValue();

    console.log(`[CODE] Successfully extracted code from Monaco editor: ${code.length} characters`);

    return {
      code,
      language: determineLanguage(),
    };
  } catch (error) {
    console.error('[CODE] Error extracting code:', error);
    throw new Error('Failed to extract code from editor: ' + error.message);
  }
}

function determineLanguage(): string {
  // Check for the language button text in the LeetCode UI
  const languageButton = document.querySelector('button.rounded.items-center.whitespace-nowrap.group');

  if (languageButton) {
    const buttonText = languageButton.textContent?.trim();
    console.log('Found language button with text:', buttonText);

    if (buttonText) {
      // Extract just the language name (removing any icons or other text)
      // We want to capture the language name before any special characters or whitespace
      const languageMatch = buttonText.match(/^(\w+(?:[\d#+-]+)?)/);

      if (languageMatch) {
        const language = languageMatch[1].toLowerCase();
        console.log('Extracted language:', language);

        // Handle special cases
        switch (language) {
          case 'c#':
            return 'csharp';
          case 'c++':
            return 'cpp';
          default:
            return language;
        }
      }

      // If regex doesn't match, use the whole button text
      return buttonText.toLowerCase();
    }
  }

  console.log('Could not find language button, returning unknown');
  return 'unknown';
}

/**
 * Set up monitoring
 */
function setupPageMonitoring(): void {
  console.log('Setting up simplified LeetCode monitoring');

  // 1. Monitor submit button clicks
  document.addEventListener(
    'click',
    e => {
      const target = e.target as Element;

      // Check for the submit button
      if (
        target.matches('button[data-e2e-locator="console-submit-button"]') ||
        (target.closest('button') && target.closest('button')!.textContent?.toLowerCase().includes('submit'))
      ) {
        console.log('Submit button clicked!');
        isWaitingForSubmissionResult = true;

        // Clear the waiting flag after a timeout if nothing happens
        setTimeout(() => {
          isWaitingForSubmissionResult = false;
        }, 30000);
      }
    },
    true,
  );

  // 2. Set up a MutationObserver to watch for result elements appearing
  const resultObserver = new MutationObserver(mutations => {
    if (!isWaitingForSubmissionResult) return;

    // Check if any of the mutations added a result element
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      // Check added nodes for result elements
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;

        // Check if this is a result element or contains one
        const resultElement = node.matches('span[data-e2e-locator="submission-result"]')
          ? node
          : node.querySelector('span[data-e2e-locator="submission-result"]');

        if (resultElement && resultElement.textContent?.includes('Accepted')) {
          console.log('Detected successful submission result!', resultElement.textContent);

          // Extract submission ID if available
          let submissionId = extractSubmissionIdFromPage();

          // Skip if we've already processed this submission
          if (submissionId && submissionId === lastProcessedSubmissionId) {
            return;
          }

          // Reset state
          isWaitingForSubmissionResult = false;
          lastProcessedSubmissionId = submissionId;

          // Process the successful submission
          processSuccessfulSubmission();
        }
      });
    }
  });

  // Start observing the entire document for changes
  resultObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

/**
 * Extract submission ID from the page if available
 */
function extractSubmissionIdFromPage(): string | null {
  // Try to get from URL
  const submissionMatch = window.location.pathname.match(/\/submissions\/(\d+)/);
  if (submissionMatch) {
    return submissionMatch[1];
  }

  // Try to get from page elements
  const submissionElement = document.querySelector('[data-submission-id]');
  if (submissionElement) {
    return submissionElement.getAttribute('data-submission-id');
  }

  return null;
}
/**
 * Process a successful submission
 */
async function processSuccessfulSubmission(): Promise<void> {
  try {
    console.log('[PROCESS] Processing successful submission');

    // Get problem details
    const { problemId, problemName } = extractProblemDetails();
    if (!problemId) {
      console.warn('[PROCESS] Could not extract problem ID');
      return;
    }

    // Get solution code using the reliable method
    const { code, language } = await getSolutionCode();
    console.log(`[PROCESS] Got solution code: ${code.length} characters`);

    // Send directly to GitHub
    saveSolutionToGitHub(problemId, problemName, language, code);
  } catch (error) {
    console.error('[PROCESS] Error processing submission:', error);
  }
}

function saveSolutionToGitHub(problemId: string, problemName: string, language: string, code: string): void {
  console.log(`[SAVE] Saving solution: ${code.length} characters`);
  console.log(`[SAVE] First 100 chars: ${code.substring(0, 100)}`);
  console.log(`[SAVE] Last 100 chars: ${code.substring(code.length - 100)}`);

  // Map language names to standard file extensions
  const languageToExtension: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    java: 'java',
    python: 'py',
    python3: 'py',
    csharp: 'cs',
    'c#': 'cs',
    javascript: 'js',
    typescript: 'ts',
    php: 'php',
    swift: 'swift',
    kotlin: 'kt',
    dart: 'dart',
    go: 'go',
    ruby: 'rb',
    scala: 'scala',
    rust: 'rs',
    racket: 'rkt',
    erlang: 'erl',
    elixir: 'ex',
    unknown: 'txt',
  };

  // Get the file extension for this language
  let extension = 'txt'; // Default
  const normalizedLang = language.toLowerCase();
  if (languageToExtension[normalizedLang]) {
    extension = languageToExtension[normalizedLang];
  }

  console.log(`[SAVE] Using extension: .${extension} for language: ${language}`);

  // Check if chrome runtime is available
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('[SAVE] Chrome runtime is not available');
    return;
  }

  try {
    // Create a new object with the code to avoid reference issues
    const dataToSend = {
      problemId,
      problemName,
      language,
      extension,
      code: String(code), // Make sure we're using a string copy
    };

    console.log(`[SAVE] Sending message with code length: ${dataToSend.code.length}`);

    // Send message to background script
    chrome.runtime
      .sendMessage({
        action: 'submit-leetcode-solution',
        data: dataToSend,
      })
      .then(response => {
        console.log('[SAVE] Got response:', response);
        if (response && response.success) {
          showSuccessNotification(problemId, problemName, response.result);
        } else {
          showErrorNotification(problemId, response?.error || 'Failed to save solution');
        }
      })
      .catch(error => {
        console.error('[SAVE] Error saving solution:', error);
        showErrorNotification(problemId, error.message || 'Failed to save solution');
      });
  } catch (error) {
    console.error('[SAVE] Error in saveSolutionToGitHub:', error);
    showErrorNotification(problemId, `Error: ${error.message || 'Unknown error occurred'}`);
  }
}

/**
 * Show a success notification
 */
function showSuccessNotification(problemId: string, problemName: string, commitResult: any): void {
  const notification = document.createElement('div');

  // Style the notification
  Object.assign(notification.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    backgroundColor: '#4caf50',
    color: 'white',
    padding: '12px 20px',
    borderRadius: '4px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
    zIndex: '10000',
    maxWidth: '300px',
  });

  notification.innerHTML = `
    <div>
      <strong>Solution saved to GitHub!</strong>
      <p>Problem: ${problemName} (#${problemId})</p>
      ${commitResult?.html_url ? `<a href="${commitResult.html_url}" target="_blank" style="color:white;text-decoration:underline;">View commit</a>` : ''}
    </div>
  `;

  document.body.appendChild(notification);

  // Remove after 5 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 5000);
}

/**
 * Show an error notification
 */
function showErrorNotification(problemId: string, errorMessage: string): void {
  const notification = document.createElement('div');

  // Style the notification
  Object.assign(notification.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    backgroundColor: '#f44336',
    color: 'white',
    padding: '12px 20px',
    borderRadius: '4px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
    zIndex: '10000',
    maxWidth: '300px',
  });

  notification.innerHTML = `
    <div>
      <strong>Failed to save solution</strong>
      <p>Problem: #${problemId}</p>
      <p>${errorMessage}</p>
    </div>
  `;

  document.body.appendChild(notification);

  // Remove after 5 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 5000);
}

/**
 * Start monitoring
 */
export function initLeetCodeMonitoring(): void {
  console.log('LeetCode solution monitoring initialized');
  setupPageMonitoring();
}
