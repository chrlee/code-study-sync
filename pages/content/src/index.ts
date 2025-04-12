import { initLeetCodeMonitoring } from '@src/leetcode';

console.log('content script loaded');

if (window.location.hostname.includes('leetcode.com')) {
  initLeetCodeMonitoring();
}
