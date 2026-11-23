import { test as base } from '@playwright/test';

test.extend({
  setupTestEnvironment: async ({}, use) => {
    const setup = async () => {
      // Start mock server if not already running
      const mockServer = Bun.spawn(['bun', 'run', 'mock'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      const baseUrl = 'http://localhost:3000';

      // Create agent
      const agentResponse = await fetch(`${baseUrl}/v1/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Agent',
          model: 'gpt-3.5-turbo',
          instructions: 'You are a helpful test assistant.',
        }),
      });

      if (!agentResponse.ok) {
        throw new Error(`Failed to create agent: ${agentResponse.statusText}`);
      }

      const agentData = await agentResponse.json();
      const agentId = agentData.id;

      // Create participant
      const participantResponse = await fetch(`${baseUrl}/v1/participants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Participant',
          agentId: agentId,
        }),
      });

      if (!participantResponse.ok) {
        throw new Error(`Failed to create participant: ${participantResponse.statusText}`);
      }

      const participantData = await participantResponse.json();
      const participantId = participantData.id;

      // Create room
      const roomResponse = await fetch(`${baseUrl}/v1/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Room',
          participantIds: [participantId],
        }),
      });

      if (!roomResponse.ok) {
        throw new Error(`Failed to create room: ${roomResponse.statusText}`);
      }

      const roomData = await roomResponse.json();
      const roomId = roomData.id;

      return {
        url: baseUrl,
        agentId,
        participantId,
        roomId
      };
    };

    await use(setup);
  },
});

export const assertPageLoads = async (page: any, pagePath: string) => {
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Check for console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Check if page has heading based on path
  let headingSelector;
  switch (pagePath) {
    case '/':
      headingSelector = 'h1, h2, [data-testid="heading"]';
      break;
    case '/rooms':
      headingSelector = 'h1, h2, [data-testid="heading"], text=/Rooms/';
      break;
    case '/actions':
      headingSelector = 'h1, h2, [data-testid="heading"], text=/Actions/';
      break;
    case '/a2a':
      headingSelector = 'h1, h2, [data-testid="heading"], text=/A2A/';
      break;
    case '/settings':
      headingSelector = 'h1, h2, [data-testid="heading"], text=/Settings/';
      break;
    default:
      headingSelector = 'h1, h2, [data-testid="heading"]';
  }

  // Assert heading is present
  await expect(page.locator(headingSelector)).toBeVisible();
  
  // Assert no console errors
  expect(consoleErrors).toHaveLength(0);
  
  // Assert page is not wider than viewport
  const pageWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = page.viewportSize().width;
  expect(pageWidth).toBeLessThanOrEqual(viewportWidth + 10); // Allow small padding
};

export const assertChatWorks = async (page: any) => {
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
};