/* ============================================================================
   Passage by StaGove — Groq proxy (Netlify Function)
   ----------------------------------------------------------------------------
   The browser never sees the API key. The frontend POSTs to /api/groq (mapped
   to this function in netlify.toml); this function adds the key from the
   GROQ_API_KEY environment variable and forwards the request to Groq's
   OpenAI-compatible endpoint, then returns the result.

   Set GROQ_API_KEY in: Netlify → Site settings → Environment variables.
   Get a free key at: https://console.groq.com/keys
   ========================================================================== */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const ALLOWED_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b"
]);

const JSON_HEADERS = { "Content-Type": "application/json" };

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: "Method not allowed. Use POST." }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "Server is missing GROQ_API_KEY. Add it in Netlify → Site settings → Environment variables, then redeploy." })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "messages[] is required." }) };
  }

  const model = ALLOWED_MODELS.has(payload.model) ? payload.model : "llama-3.3-70b-versatile";

  const body = {
    model,
    messages,
    temperature: typeof payload.temperature === "number" ? payload.temperature : 0.2,
    max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : 2600
  };
  if (payload.response_format) body.response_format = payload.response_format;

  try {
    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      // Surface a clean, user-actionable message; never leak the key or raw stack.
      let detail = text;
      try { detail = JSON.parse(text)?.error?.message || text; } catch (_) {}
      const friendly =
        upstream.status === 401 ? "The server's Groq key was rejected. Check GROQ_API_KEY in Netlify."
        : upstream.status === 429 ? "The free Groq rate limit was hit. Wait a moment and try again."
        : "The analysis service returned an error.";
      return {
        statusCode: upstream.status,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: friendly, detail: String(detail).slice(0, 400) })
      };
    }

    let data;
    try { data = JSON.parse(text); } catch (_) {
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "Unexpected response from analysis service." }) };
    }

    const content = data?.choices?.[0]?.message?.content ?? "";
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ content }) };
  } catch (err) {
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "Could not reach the analysis service. Try again shortly." })
    };
  }
};
