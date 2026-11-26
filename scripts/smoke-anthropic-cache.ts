/**
 * Live check that `anthropic-messages` caches: the same request twice per model, where the second must
 * read its prefix from the cache. Costs about a cent in total.
 *
 *   ANTHROPIC_API_KEY=… bun scripts/smoke-anthropic-cache.ts [model …]
 *
 * Exits 1 when a second call reports no cache read, which is the claim this transport exists for.
 */

import { ANTHROPIC_MESSAGES_TRANSPORT } from "../packages/core/src/model/anthropic-messages.ts"
import type { ChatChunk, ChatRequest } from "../packages/core/src/model/provider.ts"

const models = process.argv.slice(2)
const ids = models.length > 0 ? models : ["claude-sonnet-5-5", "claude-haiku-5-5"]

// Well past every 5.x model's minimum cacheable prefix (512 tokens): about 3,000 tokens.
const prefix = Array.from(
    { length: 300 },
    (_, index) => `Rule ${index}: answer in one word unless asked otherwise.`,
).join("\n")

let failed = false
for (const id of ids) {
    const provider = ANTHROPIC_MESSAGES_TRANSPORT.create({
        id: `anthropic-messages:${id}`,
        field: "model.main",
        config: { id, api: "anthropic-messages" },
        options: undefined,
    })
    const request: ChatRequest = {
        model: id,
        maxTokens: 16,
        reasoningEffort: "low",
        messages: [
            { role: "system", content: prefix, cacheBreakpoint: true },
            { role: "user", content: "Say ok.", turnInput: true },
        ],
    }
    for (const call of [1, 2]) {
        let usage: Extract<ChatChunk, { type: "usage" }> | undefined
        for await (const chunk of provider.chat(request, new AbortController().signal)) {
            if (chunk.type === "usage") usage = chunk
        }
        const read = usage?.cachedPromptTokens ?? 0
        const written = usage?.cacheWriteTokens ?? 0
        console.log(
            `${id} call ${call}: prompt ${usage?.promptTokens ?? "?"}, cache read ${read}, cache write ${written}`,
        )
        if (call === 2 && read === 0) failed = true
    }
}

if (failed) {
    console.error("FAIL: a second identical call read nothing from the cache.")
    process.exit(1)
}
console.log("ok: every second call read its prefix from the cache.")
