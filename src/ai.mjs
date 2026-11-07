// The chat brain. Claude (ANTHROPIC_API_KEY) or Gemini (GEMINI_API_KEY); AI_PROVIDER
// picks one if both are set.
//
//   ai.run({ system, messages, tools, runTool }) → { texts: string[], refused: boolean }
//
// `messages` is the conversation so far as plain text turns ({ role: "user" | "assistant",
// content }), rebuilt from the database each time, so nothing lives in server memory and
// a restart loses nothing. Tool calls inside one turn loop until the model is done.

import { toGeminiSchema, rankModels } from "../gemini.mjs";

const MAX_STEPS = 6;

export async function makeAi(env = process.env) {
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const claudeKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
  const provider = (env.AI_PROVIDER || (claudeKey ? "claude" : geminiKey ? "gemini" : "none")).toLowerCase();
  if (provider === "claude" && claudeKey) return makeClaude(env);
  if (provider === "gemini" && geminiKey) return makeGemini(geminiKey, env.GEMINI_MODEL);
  return null;
}

async function makeClaude(env) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const model = env.SHOPKEEP_MODEL || env.AW33_MODEL || "claude-opus-5-5";
  const effort = env.SHOPKEEP_EFFORT || "low"; // short DM replies don't need deep thinking

  async function run({ system, messages, tools, runTool }) {
    const convo = [...messages];
    const texts = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const params = {
        model,
        max_tokens: 16000,
        system,
        tools,
        messages: convo,
        output_config: { effort },
        cache_control: { type: "ephemeral" },
      };
      // Haiku has no server-side fallback; the others get one if a safety classifier declines.
      const res = model.startsWith("claude-haiku")
        ? await client.messages.create(params)
        : await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

      if (res.stop_reason === "refusal") return { texts: [], refused: true };
      convo.push({ role: "assistant", content: res.content }); // unchanged, thinking blocks included
      for (const b of res.content) if (b.type === "text" && b.text.trim()) texts.push(b.text);
      if (res.stop_reason === "pause_turn") continue;
      if (res.stop_reason !== "tool_use") break;

      const results = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        const out = await runTool(b.name, b.input);
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out), ...(out && out.error ? { is_error: true } : {}) });
      }
      convo.push({ role: "user", content: results }); // all results in one message
    }
    return { texts, refused: false };
  }

  const isQuotaError = (err) => err instanceof Anthropic.RateLimitError || err.status === 429 || err.status === 529;
  return { provider: "claude", model, run, isQuotaError };
}

async function makeGemini(key, fixedModel) {
  const BASE = "https://generativelanguage.googleapis.com/v1beta";
  async function call(p, body, timeoutMs = 25000) {
    const r = await fetch(BASE + p, {
      method: body ? "POST" : "GET",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`Gemini ${r.status}: ${(j.error && j.error.message) || r.statusText}`);
      e.status = r.status;
      throw e;
    }
    return j;
  }
  const ranked = fixedModel ? [fixedModel] : await rankModels(call);
  const api = { provider: "gemini", model: ranked[0] };

  async function generate(body) {
    try {
      return await call(`/models/${api.model}:generateContent`, body);
    } catch (err) {
      // Slow, overloaded or over quota → move to the next model and retry once.
      const next = ranked[ranked.indexOf(api.model) + 1];
      const retryable = err.name === "TimeoutError" || [429, 500, 503].includes(err.status);
      if (!retryable || !next) throw err;
      console.log(`Gemini: ${api.model} failed (${err.status || err.name}), switching to ${next}`);
      api.model = next;
      return call(`/models/${api.model}:generateContent`, body);
    }
  }

  api.run = async ({ system, messages, tools, runTool }) => {
    const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const fnTools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) }];
    const texts = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const j = await generate({ systemInstruction: { parts: [{ text: system }] }, contents, tools: fnTools, generationConfig: { temperature: 0.6 } });
      const cand = j.candidates && j.candidates[0];
      if (!cand || !cand.content || !cand.content.parts || !cand.content.parts.length) return { texts, refused: !texts.length };
      contents.push(cand.content); // unchanged (may carry signatures Gemini needs back)
      for (const p of cand.content.parts) if (p.text && !p.thought) texts.push(p.text);
      const calls = cand.content.parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      if (!calls.length) break;
      const parts = [];
      for (const fc of calls) parts.push({ functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response: (await runTool(fc.name, fc.args || {})) || {} } });
      contents.push({ role: "user", parts });
    }
    return { texts, refused: false };
  };
  api.isQuotaError = (err) => err.status === 429;
  return api;
}
