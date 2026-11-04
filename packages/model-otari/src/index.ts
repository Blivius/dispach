/**
 * Mozilla.ai's Otari gateway as a model transport: `model.<role>.api: otari`.
 *
 * ```yaml
 * model:
 *   main:
 *     id: z-ai/glm-5.3                    # a catalog id; Otari falls back across its offerings
 *     api: otari                          # baseUrl defaults to hosted Otari, apiKeyEnv to OTARI_API_KEY
 *     options:
 *       guardrails: [{ profile: lakera-guard, mode: block }]
 *       tags: { app: support }            # sent as metadata; role is always added
 * ```
 *
 * The CLI and the image bundle this transport, so `api: otari` needs no `plugins:` entry. An embedder
 * calling the runtime directly passes `otariTransport()` in `RuntimeOptions.modelTransports`.
 */

import { type Plugin, VERSION } from "@dispach/core"
import { OTARI_KEY_ENV, otariTransport } from "./transport.ts"

export {
    OTARI_BASE_URL,
    OTARI_KEY_ENV,
    type OtariGuardrail,
    type OtariOptions,
    otariTransport,
    readRefusal,
    refusalError,
    shapeBody,
} from "./transport.ts"

export default {
    name: "model-otari",
    version: VERSION,
    dispachApi: "^0.2",
    permissions: [
        { kind: "network", hosts: ["api.otari.ai"] },
        { kind: "env", vars: [OTARI_KEY_ENV] },
    ],
    setup(ctx) {
        ctx.defineModelTransport("otari", otariTransport())
    },
} satisfies Plugin
