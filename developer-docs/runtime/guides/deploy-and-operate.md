# Deploy and operate

The shipped container runs the published Node 26.13.0 package as a non-root user. The process needs persistent storage for agents, stores, keys, and logs.

To run outside a container, install through npm, Homebrew, or the install script: see [Install and serve](../quickstart/install-and-serve.md).

## Health checks

Use `/v1/ready` for traffic readiness. Local startup completes before channels and remote catalogues connect; inspect status and events for those integrations separately.

On a host install, where `serve` runs under the service manager:

```bash
curl --fail http://localhost:7420/v1/ready
dispach status
dispach daemon logs
```

In the container, `serve` is the foreground process and writes to the container's output, so read it there; the image's health check already polls `/v1/ready`:

```bash
curl --fail http://localhost:7420/v1/ready
docker compose logs server      # or: docker logs <container>
```

Do not expose a non-loopback server without `DISPACH_API_TOKEN`. Issue scoped keys to applications that should reach only one agent.

## Traces

Every turn can be sent to an OpenTelemetry backend (Phoenix, or any OTLP/HTTP collector) as a trace: the turn, each model call with its tokens and latency, each tool call, and each delegation, nested. Name the bundled plugin in the agent's manifest:

```yaml
plugins:
  - spec: "@dispach/trace-otlp"
    config:
      endpoint: http://localhost:6006/v1/traces
      headersEnv: { authorization: TRACES_AUTH }   # optional: a variable name, set in the agent's .env
```

`dispach init --traces http://localhost:6006` writes the same entry for a new agent. The endpoint must be OTLP/HTTP (protobuf): a `grpc://` URL is refused, and an `http` URL at a gRPC port (4317) fails on the first export. Phoenix 22 requires a bearer token by default, so set `TRACES_AUTH=Bearer <key>` in the agent's `.env`.

Spans carry names, models, token counts, latencies and outcomes, never a prompt, a reply or a tool's output. A turn never waits on the collector. When exports fail, an `agent.warning` with code `trace_export_failed` says so on the first failure and every twentieth, and `trace_export_recovered` reports how many spans were lost; failed exports are not retried. `serve` writes both to its log as well, so they appear in `docker logs`.

## Persistence and backups

Back up the complete Dispach home or the deployment volume while writes are quiesced. A useful backup includes manifests, workspace files, SQLite stores, secret environment files, and key material. Test restore into an isolated home before relying on the procedure.

## Isolation

The runtime policy controls which tool calls may execute. It does not replace container, VM, namespace, or host isolation. Choose the containment boundary from the trust relationship between tenants and from the system tools enabled for their agents.

## Upgrades

1. Read `CHANGELOG.md`.
2. Back up state.
3. Deploy one version of the runtime and client contract together.
4. Check readiness and a representative detached turn.

OpenAPI and event types are compatibility surfaces; event names are append-only within wire version 1.

For separate per-user containers, use the [control plane](../../control-plane/README.md) rather than building lifecycle management into the runtime process.
