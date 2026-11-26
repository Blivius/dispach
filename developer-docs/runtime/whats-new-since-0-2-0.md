# What's new since 0.2.0

What 0.2.1 through the current 0.2.x release added on top of [0.2.0](whats-new-0-2-0.md). A manifest, store or client written for 0.2.0 keeps working. The one breaking change is 0.2.12's: an npm install needs Node 26.13.0 or later (the container image and the standalone archives carry their own Node). The [changelog](https://github.com/blivius/dispach/blob/main/CHANGELOG.md) has every entry, each release's store migrations, and its "Upgrading" notes.

## 0.2.13

- **The repository moved to [github.com/blivius/dispach](https://github.com/blivius/dispach).** CI, releases and the `curl … install.sh | sh` one-liner are on GitHub again.
- **Images on two registries:** `ghcr.io/blivius/dispach` and, as before, `docker.io/moeenmahmud007/dispach`.
- **npm and Homebrew are back.** 0.2.5 to 0.2.12 shipped as container images only, so npm went from 0.2.4 straight to 0.2.13. Homebrew is `brew install blivius/tap/dispach`.

## 0.2.12

- **Breaking: Node 26.13.0 or later** for an npm install. Node 24 now warns and is no longer tested. The image and the standalone archives run on Node 26.13.0.

## 0.2.11

- **WhatsApp:** self-chat messages sent by any agent on the account are ignored.
- **Schedules:** a manual run delivers its reply the way a timed run does.

## 0.2.10

- **Importing a bundle into a new agent works.** `POST /v1/agents/:id/import` now creates the agent's `memory/` and `knowledge/` folders first, so the first note no longer fails and rolls the import back.

## 0.2.9

- **Bedrock:** a system message after the start of a conversation is fenced as `<runtime_context>`, so Claude no longer reads it as a prompt injection and refuses its owner's requests.
- **Subagents** treat the person's request as context and make only the call they were handed.
- **One approval covers a routed call:** the child's identical call runs without asking the person a second time.

## 0.2.8

- **`confine: workspace` confines `exec` itself.** In 0.2.7 only skill scripts got the workspace scope, so a command could still read the agent's `.env`, `agent.yaml` and channel sessions.

## 0.2.7

- **`tools.providers.system.confine: workspace`** confines `exec` and skill scripts to the agent's workspace. The kernel refuses the rest of the agent's own directory, including its `.env`, so an agent that holds credentials can still be given a shell. See [Tools, skills, and plugins](guides/tools-skills-and-plugins.md).

## 0.2.6

- **`confine: agent`** confines `exec` and skill scripts to the agent's own directory with Linux's Landlock. Other agents' files, the runtime's `store.db` and its environment are refused by the kernel. Where Landlock is missing, a command is refused rather than run unconfined.
- **Composio file attachments:** a `file_uploadable` field takes a workspace path, uploaded at the call (25 MB cap, `.env` refused).
- **Composio and MCP schemas** that use `anyOf`, `oneOf`, `allOf`, `$ref`, `not` or `const` now load. That covers 80 of 3,917 Composio tools, among them Gmail and Outlook send.
- **`config_read`** lists only the settings `config_set` may change.
- **"Compact now"** shrinks a conversation that holds a long message, and answers `409 nothing_to_gain` when it would not.
- **A frozen event loop restarts the server.** A watchdog sends SIGKILL after `DISPACH_LOOP_STALL_S` seconds (default 60) so the supervisor restarts it.

## 0.2.5

- Moved to GitLab while the GitHub account was suspended. The image was published to Docker Hub only, and npm and Homebrew paused. 0.2.13 restored all three.

## 0.2.4

- Documentation: the npm quickstart, a complete HTTP reference with response bodies and error shapes, and one source for every version and default on the site. `init --help` names the right `--daemon` default.

## 0.2.3

- **Fan-out with `delegate`.** The model sends up to 8 tasks to its own subagents in one call. Each runs in a fresh context and returns one finding. A child opts in with `subagents[].spawn: true`. Read-only children run together, and a child that can write runs its tasks one at a time. See [Channels, schedules, and teams](guides/channels-schedules-and-teams.md).
- **Session checkpoints.** When compaction reaches its `reset` stage, the digest is saved and the next turn starts from it instead of compacting the whole history again. `POST /v1/agents/:id/sessions/:key/compact` saves one on demand. Every message stays stored. See [Turn lifecycle](concepts/turn-lifecycle.md).
- **`POST /v1/agents/:id/sessions/resolve`** answers which session key a turn would run in before you send it.

## 0.2.2

- **One conversation per person.** `sessions.scope: owner` puts the owner's turns from Telegram, WhatsApp, the web, the terminal, and the API into one session. The `202` from `POST …/messages` returns the key the turn actually runs in. See [Runtime, agents, and sessions](concepts/runtime-agents-and-sessions.md).
- **Peer ask.** `ask_agent` lets an agent ask another agent working for the same person and get the reply as text, one hop.
- **Shared memory for one person's agents** (`agents:<owner>`, `memory.shared`).
- **Web console pages** for schedules, tools, usage, turns, people, rooms, actions, memory, webhooks, keys and backup, with Markdown replies.
- **Install without Node**: a standalone archive per platform and `install.sh`. See [Install and serve](quickstart/install-and-serve.md).
- **Bedrock** through `init --preset bedrock --region <region>`.

## 0.2.1

- Fixes: a phase set over HTTP takes effect on the next turn, and WhatsApp pairing errors name their own code.
