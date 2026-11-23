# Testing Real-World Channels

This guide provides step-by-step instructions for testing the Slack and Teams channels against real workspaces and tenants. This testing is essential to validate the experimental status of these channels.

## Overview

The Slack and Teams channels are currently marked as experimental and have only been tested against mock APIs. This guide helps you:

1. Set up each channel with real accounts
2. Perform comprehensive testing scenarios
3. Report results with proper log collection

## Prerequisites

### For Slack Testing
- A Slack workspace (can be a free one)
- Permissions to create apps and install them to the workspace
- A bot token with `chat:write`, `im:read`, and `channels:history` scopes

### For Teams Testing
- A Microsoft 365 or Office 365 tenant
- Permissions to create bots and webhooks
- A bot token with appropriate permissions

## Testing Scenarios

For each channel, perform these tests and document results:

### 1. Connection Test
```bash
dispach status
dispach channels list [agent-name]
```
- Verify the channel shows as connected
- Check that no errors appear in logs

### 2. Direct Message Test
- Send a direct message to your bot
- Verify the bot receives and processes it
- Check for any errors in logs

### 3. Reply Test
- Send a message to the bot
- Verify the bot replies correctly
- Check that the reply appears in the expected format

### 4. Channel Mention Test
- Add the bot to a channel
- Mention the bot in a message (@botname message)
- Verify the bot processes the mention and replies

### 5. Long Message Test
- Send a message longer than 1,000 characters
- Verify the bot handles it correctly (may split into multiple messages)
- Check that threading works properly if applicable

### 6. Restart Test
- Send a message to the bot
- Restart the dispach service while it's processing
- Verify no duplicate replies after restart
- Check that the bot resumes normal operation

### 7. Access Control Test
```bash
dispach config allow [agent-name] stranger@example.com
dispach config deny [agent-name] stranger@example.com
```
- Have an unauthorized user send a message
- Verify the bot rejects it based on `allowFrom` settings
- Check logs for proper rejection handling

## Setting Up Slack Channel

### 1. Create a Slack App
1. Go to https://api.slack.com/apps
2. Create a new app "From scratch"
3. Add the following OAuth scopes under "OAuth & Permissions":
   - `chat:write`
   - `im:read`
   - `channels:history`
   - `app_mentions:read`

### 2. Enable Socket Mode
1. Enable Socket Mode under "Socket Mode"
2. Subscribe to the following bot event:
   - `message.im`
   - `app_mention`

### 3. Install App to Workspace
1. Install the app to your workspace
2. Note the bot token (xoxb-...)

### 4. Configure Dispach
```bash
dispach channels add slack [agent-name] \
  --token xoxb-your-token \
  --socket-mode true
dispach channels enable slack [agent-name]
```

## Setting Up Teams Channel

### 1. Create a Bot in Azure
1. Go to https://portal.azure.com
2. Create a new "Azure Bot" registration
3. Configure with:
   - Microsoft App ID and password
   - Messaging endpoint (your dispach service URL)

### 2. Configure Bot Framework
1. In the Azure Bot, configure the "Channels" page
2. Enable the "Teams" channel
3. Note the Microsoft App ID and password

### 3. Configure Dispach
```bash
dispach channels add teams [agent-name] \
  --appid your-app-id \
  --appsecret your-app-secret
dispach channels enable teams [agent-name]
```

## Collecting and Redacting Logs

### Log Collection
1. Run dispach with verbose logging:
   ```bash
dispach --verbose [command]
   ```
2. Capture all output during testing
3. Save logs to a file for each test scenario

### Redacting Sensitive Information
Before sharing logs:
1. Replace all tokens with `[REDACTED_TOKEN]`
2. Replace all workspace/tenant IDs with `[REDACTED_ID]`
3. Replace all email addresses with `[REDACTED_EMAIL]`
4. Keep timestamps and message content intact

## Reporting Format

For each channel tested, provide:

### Summary
- Workspace/tenant type (e.g., Free Slack, Teams E5)
- Date of testing
- Your role (e.g., contributor, community member)

### Results Table
| Test Scenario | Status | Notes |
|--------------|--------|-------|
| Connection | ✓/✗ | | 
| Direct Message | ✓/✗ | | 
| Reply | ✓/✗ | | 
| Channel Mention | ✓/✗ | | 
| Long Message | ✓/✗ | | 
| Restart | ✓/✗ | | 
| Access Control | ✓/✗ | | 

### Log Samples
Include redacted log snippets for:
- Successful connections
- Error cases (if any)
- Interesting behaviors

### Issues Found
List any bugs or unexpected behaviors discovered:

1. **Description**: What happened
2. **Expected**: What should have happened
3. **Steps to reproduce**: How to trigger the issue
4. **Environment**: Workspace type, dispach version, etc.

## Contributing Results

### Creating Issues
For each bug found:
1. Create a new issue with the title format:
   `[Slack/Teams] Bug description`
2. Include the completed reporting format above
3. Attach redacted log files

### Commenting on This Issue
If testing was partially successful or you have questions:
1. Comment on this issue with your results
2. Include the summary table and any observations
3. Ask for guidance if you encounter issues

## Next Steps

Once real-world testing is complete:
1. The experimental status will be updated based on results
2. Documentation will be updated with known issues
3. The community will be informed of the channels' readiness

## Troubleshooting

### Common Issues
- **Connection refused**: Check firewall settings
- **Authentication errors**: Verify tokens and permissions
- **Message delivery**: Check bot is added to correct channels

### Getting Help
1. Check existing issues for similar problems
2. Create a new issue with:
   - Your setup details
   - Exact error messages
   - Steps you've already tried
