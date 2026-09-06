import type {
  AIProvider,
  AIResponse,
  GenerateRequest,
} from "@/lib/ai/provider";
import {
  fromGeminiResponse,
  toGeminiContents,
  toGeminiTools,
} from "@/lib/ai/providers/gemini-message-mapping";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini's REST generateContent API — no SDK dependency, matching
 * OllamaProvider's own style and CLAUDE.md §8's "never scatter
 * provider-specific SDK calls" rule. See
 * lib/ai/providers/gemini-message-mapping.ts for why the request/response
 * shapes need real translation rather than a field rename.
 *
 * Deliberately does not implement generateEmbedding. AIProvider already
 * treats it as optional for exactly this situation (see its own comment)
 * — the knowledge base's pgvector column is a fixed vector(768), matching
 * nomic-embed-text; Gemini's embedding models default to a different
 * dimensionality, and getting that wrong would silently corrupt retrieval
 * rather than fail loudly. Adding Gemini embeddings later is additive, not
 * a rewrite — it just isn't part of what this was asked to fix.
 */
export class GeminiProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async generateResponse(request: GenerateRequest): Promise<AIResponse> {
    const { systemInstruction, contents } = toGeminiContents(request.messages);
    const tools = toGeminiTools(request.tools);

    function buildBody(disableThinking: boolean) {
      return JSON.stringify({
        ...(systemInstruction && { systemInstruction }),
        contents,
        ...(tools && { tools }),
        generationConfig: {
          ...(request.responseFormat === "json" && {
            responseMimeType: "application/json",
          }),
          // Same intent as OllamaProvider's think: false: extraction,
          // classification and composition are narrow, atomic questions
          // that never benefit from deliberation, and thinking tokens are
          // billed as output at full price when a model spends them. This
          // is a cost *ceiling*, not a proven saving on every call — a
          // response's thoughtSignature part shows up whether or not this
          // is set, and measured live, a short extraction call cost
          // exactly the same 27 completion tokens with and without it: the
          // model was already spending nothing extra on this simple a task.
          // It should still matter on a genuinely complex extraction where
          // a model would otherwise choose to reason at length, so it
          // stays set — just don't read the comment above as "this cut our
          // bill," because on the one real task tested, it didn't.
          //
          // Not every model accepts this, though — confirmed live that
          // gemini-3.5-flash-lite hard-rejects thinkingBudget: 0 with a 400.
          // Rather than hardcode which model names support it — Agent.model
          // is a free string precisely so this provider never needs to know
          // model names in advance — a 400 triggers one retry without it,
          // below.
          ...(disableThinking && { thinkingConfig: { thinkingBudget: 0 } }),
        },
      });
    }

    // Which model to call is request.model, exactly like OllamaProvider —
    // Agent.model is already a free string ("qwen2.5:14b" today), so a
    // Gemini agent just sets it to a Gemini model name instead. No new
    // configuration surface: when the model needs to change, that's editing
    // the agent's Model field, not a code change. gemini-2.5-flash-lite was
    // the original choice; live-verified since as "no longer available to
    // new users" (a real 404 from Google, not a guess) — new connections
    // need a 3.x model.
    const url = `${GEMINI_API_BASE}/models/${request.model}:generateContent`;
    const headers = {
      "Content-Type": "application/json",
      // Header, not ?key=... in the URL — the query-param form is still
      // accepted for backwards compatibility, but the key would then land
      // in request logs and error messages that echo the URL. Header keeps
      // it out of both.
      "x-goog-api-key": this.apiKey,
    };

    let response = await fetch(url, {
      method: "POST",
      headers,
      body: buildBody(true),
    });

    if (!response.ok && response.status === 400) {
      // Live-confirmed: Google's 400 for an unsupported thinkingConfig is
      // "Request contains an invalid argument" — generic, with nothing in
      // the message that names thinkingConfig specifically, so there is no
      // reliable text to match on to confirm the cause before retrying.
      // Retrying every 400 once without it is the honest response to that:
      // if this was the cause, the retry succeeds; if it wasn't, the retry
      // fails on the same underlying problem and that error still
      // propagates below — one extra request, never a masked failure.
      response = await fetch(url, {
        method: "POST",
        headers,
        body: buildBody(false),
      });
    }

    if (!response.ok) {
      throw new Error(
        `Gemini request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Parameters<
      typeof fromGeminiResponse
    >[0];
    return fromGeminiResponse(data);
  }
}
