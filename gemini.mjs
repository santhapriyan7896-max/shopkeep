// Gemini (Google AI Studio API key) as the Live AI brain.
//
// Uses the Gemini REST API directly (no extra package). Same shop prompt, same tools
// (save_order, save_team_lead, handoff_to_human) and same checks as the Claude version.
// The model is picked automatically: the newest stable "gemini-X-flash" your key can use,
// unless GEMINI_MODEL is set in .env.

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// Our tool schemas are JSON Schema; Gemini's function declarations use an OpenAPI-style
// subset (upper-case types, no additionalProperties).
export function toGeminiSchema(s) {
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

export async function createGemini({ key, model, system, tools, runTool }) {
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

  // Ranked list of models to use; the first is the current one. If it stalls or is
  // over quota during a chat, we move to the next and retry once.
  const ranked = model ? [model] : await rankModels(call, key);
  model = ranked[0];
  const fnTools = [
    { functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) },
  ];
  const sessions = new Map(); // sessionId → contents, kept exactly as Gemini returned them

  // Returns the reply texts, or null if Gemini declined / returned nothing (caller hands off).
  async function chatTurn(sessionId, userText, events, ctx) {
    if (!sessions.has(sessionId)) {
      if (sessions.size >= 500) sessions.delete(sessions.keys().next().value); // keep memory bounded
      sessions.set(sessionId, []);
    }
    if (sessions.get(sessionId).length > 80) {
      // very long chat: start fresh rather than grow without limit
      sessions.set(sessionId, []);
    }
    const contents = sessions.get(sessionId);
    const before = contents.length;
    contents.push({ role: "user", parts: [{ text: userText }] });
    const replies = [];
    for (let i = 0; i < 6; i++) {
      const body = { systemInstruction: { parts: [{ text: system }] }, contents, tools: fnTools, generationConfig: { temperature: 0.6 } };
      let j;
      try {
        j = await call(`/models/${api.model}:generateContent`, body);
      } catch (err) {
        // Slow, overloaded or over quota → switch to the next model and retry once.
        const retryable = err.name === "TimeoutError" || err.name === "AbortError" || [429, 500, 503].includes(err.status);
        const next = ranked[ranked.indexOf(api.model) + 1];
        if (retryable && next) {
          console.log(`Gemini: ${api.model} failed (${err.status || err.name}), switching to ${next}`);
          api.model = next;
          try {
            j = await call(`/models/${api.model}:generateContent`, body);
          } catch (err2) {
            contents.length = before;
            throw err2;
          }
        } else {
          contents.length = before; // leave history as it was
          throw err;
        }
      }
      const cand = j.candidates && j.candidates[0];
      if (!cand || !cand.content || !cand.content.parts || !cand.content.parts.length) {
        contents.length = before;
        return null;
      }
      // Keep the model's turn unchanged (it can carry signatures Gemini needs back).
      contents.push(cand.content);
      for (const p of cand.content.parts) if (p.text && !p.thought) replies.push(p.text);
      const calls = cand.content.parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      if (!calls.length) break;
      contents.push({
        role: "user",
        parts: calls.map((fc) => ({
          functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response: runTool(fc.name, fc.args || {}, events, ctx) },
        })),
      });
    }
    return replies;
  }

  const api = { model, chatTurn, ranked };
  return api;
}

// Newest "Flash" models first, but only ones that actually answer quickly for this key:
// probe the candidates in parallel with a tiny request and keep those that reply in time.
export async function rankModels(call) {
  let ids = [];
  try {
    const { models = [] } = await call("/models?pageSize=1000");
    ids = models.filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  } catch {}
  const ver = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const flash = ids
    .filter((id) => /^gemini-\d+(\.\d+)?-flash(-preview)?$/.test(id))
    .sort((a, b) => ver(b) - ver(a) || (a.includes("preview") ? 1 : -1))
    .slice(0, 6);
  const lite = ids.filter((id) => /^gemini-\d+(\.\d+)?-flash-lite$/.test(id)).sort((a, b) => ver(b) - ver(a)).slice(0, 2);
  const probe = async (id) => {
    const t0 = Date.now();
    try {
      await call(`/models/${id}:generateContent`, { contents: [{ role: "user", parts: [{ text: "Reply with ok." }] }] }, 9000);
      return { id, ms: Date.now() - t0 };
    } catch {
      return null;
    }
  };
  const fast = (await Promise.all([...flash, ...lite].map(probe))).filter(Boolean);
  // keep the newest-first order among models that answered within the probe time
  const order = [...flash, ...lite].filter((id) => fast.some((f) => f.id === id));
  if (order.length) {
    console.log("Gemini models answering quickly:", fast.map((f) => `${f.id} ${(f.ms / 1000).toFixed(1)}s`).join(", "));
    return order;
  }
  return flash.length ? flash : ["gemini-3.5-flash"];
}
