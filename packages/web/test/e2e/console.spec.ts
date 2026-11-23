import { test, expect } from '@playwright/test';
import { setupTestEnvironment, assertPageLoads, assertChatWorks } from './utils';

const CONSOLE_PAGES = [
  '/',
  '/rooms',
  '/actions',
  '/a2a',
  '/settings'
];

const VIEWPORTS = [
  { width: 1400, height: 900, name: 'desktop' },
  { width: 390, height: 844, name: 'mobile' }
];

test.describe('Web Console E2E Tests', () => {
  let baseUrl;
  let agentId;
  let participantId;
  let roomId;

  test.beforeAll(async () => {
    const { url, createdAgentId, createdParticipantId, createdRoomId } = await setupTestEnvironment();
    baseUrl = url;
    agentId = createdAgentId;
    participantId = createdParticipantId;
    roomId = createdRoomId;
  });

  test.describe('Console pages at different viewports', () => {
    for (const viewport of VIEWPORTS) {
      test.describe(`at ${viewport.width}x${viewport.height}`, () => {
        test.beforeEach(async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
        });

        for (const pagePath of CONSOLE_PAGES) {
          test(`loads ${pagePath} without errors and has heading`, async ({ page }) => {
            await page.goto(`${baseUrl}${pagePath}`);
            await assertPageLoads(page, pagePath);
          });
        }
      });
    }
  });

  test.describe('Chat functionality', () => {
    test('sends message and receives reply', async ({ page }) => {
      await page.goto(`${baseUrl}/`);
      
      // Wait for chat interface to be ready
      await page.waitForSelector('[data-testid="chat-input"]', { state: 'visible' });
      
      // Send a test message
      const testMessage = 'Hello, this is a test message';
      await page.fill('[data-testid="chat-input"]', testMessage);
      await page.click('[data-testid="send-button"]');
      
      // Wait for reply to appear
      await expect(page.locator('[data-testid="chat-message"]')).toHaveCount(2); // Original message + reply
      
      // Verify reply contains expected elements
      await expect(page.locator('[data-testid="chat-message-reply"]')).toBeVisible();
    });
  });

  test.describe('Error handling', () => {
    test('shows console errors if any occur', async ({ page }) => {
      // Capture console messages
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Navigate through all pages
      for (const pagePath of CONSOLE_PAGES) {
        await page.goto(`${baseUrl}${pagePath}`);
        await page.waitForLoadState('networkidle');
      }

      // Assert no console errors occurred
      expect(consoleErrors).toHaveLength(0);
    });
  });
});