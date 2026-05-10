freedom Uprise Groq client with model fallback
const { callGroqWithFallback } = require("./groqClient");
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const PRIMARY_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const FALLBACK_MODELS = (
  process.env.GROQ_FALLBACK_MODELS ||
  "openai/gpt-oss-20b,meta-llama/llama-4-scout-17b-16e-instruct,llama-3.1-8b-instant"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGroqWithFallback({
  prompt,
  system = "You are the Freedom Uprise AI operations assistant. Be direct, practical, and return clean structured output.",
  maxTokens = 1200,
  temperature = 0.2,
  jsonMode = false,
}) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const models = [
    PRIMARY_MODEL,
    ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL),
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const body = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      };

      if (jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "FreedomUprise/1.0 Node",
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();

      if (!res.ok) {
        lastError = `${model} failed HTTP ${res.status}: ${text.slice(0, 500)}`;

        // Bad key will not be fixed by trying another model.
        if (res.status === 401) {
          throw new Error(`Groq API key unauthorized: ${text.slice(0, 500)}`);
        }

        // These are worth trying fallback models for.
        if ([403, 408, 409, 429, 500, 502, 503, 504].includes(res.status)) {
          await sleep(800);
          continue;
        }

        throw new Error(lastError);
      }

      const data = JSON.parse(text);

      return {
        modelUsed: model,
        content: data.choices?.[0]?.message?.content?.trim() || "",
        raw: data,
      };
    } catch (err) {
      lastError = `${model} failed: ${err.message}`;

      // If it is a bad key, stop immediately.
      if (err.message.includes("unauthorized")) {
        throw err;
      }

      await sleep(800);
      continue;
    }
  }

  throw new Error(`All Groq models failed. Last error: ${lastError}`);
}

module.exports = {
  callGroqWithFallback,
};
