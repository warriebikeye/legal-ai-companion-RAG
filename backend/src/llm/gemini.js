// src/llm/gemini.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_MODELS } from "../config/ai.config.js";
import { getEmbeddingModel } from "../services/model-router.service.js";
import { trackModelCall, trackLatency } from "../utils/metrics.js";

/* =========================================================
   Logger
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[GEMINI] [${timestamp}] ${step}`, data)
    : console.log(`[GEMINI] [${timestamp}] ${step}`);
}

/* =========================================================
   Gemini Singleton + Model Cache
========================================================= */

let genAI = null;
const modelCache = new Map();

function initializeGemini() {
  if (genAI) return;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing from environment variables.");
  log("Initializing Gemini client");
  genAI = new GoogleGenerativeAI(apiKey);
  log("Gemini client initialized successfully");
}

function getModel(modelName) {
  initializeGemini();
  if (modelCache.has(modelName)) {
    log("Using cached model", { modelName });
    return modelCache.get(modelName);
  }
  log("Creating Gemini model", { modelName });
  const model = genAI.getGenerativeModel({ model: modelName });
  modelCache.set(modelName, model);
  return model;
}

function estimateTokens(text = "") {
  return Math.ceil(text.length / 4);
}

/* =========================================================
   Generate Embedding
========================================================= */

export async function getEmbedding(text) {
  const started = Date.now();
  try {
    const modelName = getEmbeddingModel();
    const embedModel = getModel(modelName);

    log("Embedding request started", {
      modelName,
      textLength: text?.length || 0,
      estimatedTokens: estimateTokens(text),
      preview: text?.slice(0, 100),
    });

    const result = await embedModel.embedContent(text);
    const embedding = result?.embedding?.values || [];
    const durationMs = Date.now() - started;

    log("✅ Embedding generated successfully", {
      modelName,
      vectorLength: embedding.length,
      durationMs,
    });

    // Fire-and-forget metrics
    trackModelCall(modelName);
    trackLatency(durationMs);

    return embedding;
  } catch (err) {
    console.error("❌ Gemini embedding error", { message: err?.message, stack: err?.stack });
    throw err;
  }
}

/* =========================================================
   Generate Answer — non-streaming (internal / cache path)
========================================================= */

export async function getAnswer({
  query,
  context,
  systemPrompt,
  modelName = AI_MODELS.FLASH,
  fallbackModel = AI_MODELS.FLASH,
}) {
  const started = Date.now();

  try {
    const model = getModel(modelName);

    log("Gemini answer generation started", {
      modelName,
      queryLength: query?.length || 0,
      contextLength: context?.length || 0,
      estimatedInputTokens: estimateTokens(`${systemPrompt}\n${query}\n${context}`),
      queryPreview: query?.slice(0, 120),
    });

    const prompt = `${systemPrompt}\n\nUSER QUERY:\n${query}\n\nCONTEXT:\n${context}`;

    const result = await model.generateContent(prompt);
    const response = result?.response?.text?.() || "";
    const durationMs = Date.now() - started;

    log("✅ Gemini response generated", {
      modelName,
      responseLength: response.length,
      estimatedOutputTokens: estimateTokens(response),
      durationMs,
    });

    trackModelCall(modelName);
    trackLatency(durationMs);

    return { response, modelUsed: modelName, latencyMs: durationMs, fallbackUsed: false };
  } catch (err) {
    console.error("❌ Gemini answer error", {
      modelName,
      message: err?.message,
      queryPreview: query?.slice(0, 120),
    });

    if (modelName !== fallbackModel) {
      log("Primary model failed → trying fallback", { failedModel: modelName, fallbackModel });
      try {
        const fallbackResponse = await getAnswer({
          query, context, systemPrompt,
          modelName: fallbackModel,
          fallbackModel,
        });
        log("✅ Fallback model succeeded", { fallbackModel });
        return { ...fallbackResponse, fallbackUsed: true };
      } catch (fallbackErr) {
        console.error("❌ Fallback model also failed", { message: fallbackErr?.message });
        throw fallbackErr;
      }
    }

    throw err;
  }
}

/* =========================================================
   Generate Answer — STREAMING
   Yields text chunks as they arrive from Gemini.
   The caller is responsible for writing chunks to the SSE stream.

   Usage:
     const stream = getAnswerStream({ query, context, systemPrompt, modelName });
     for await (const chunk of stream) {
       res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
     }
========================================================= */

export async function* getAnswerStream({
  query,
  context,
  systemPrompt,
  modelName = AI_MODELS.FLASH,
  fallbackModel = AI_MODELS.FLASH,
}) {
  const started = Date.now();

  log("Gemini stream started", {
    modelName,
    queryLength: query?.length || 0,
    estimatedInputTokens: estimateTokens(`${systemPrompt}\n${query}\n${context}`),
  });

  const prompt = `${systemPrompt}\n\nUSER QUERY:\n${query}\n\nCONTEXT:\n${context}`;

  let usedModel = modelName;

  try {
    const model = getModel(modelName);
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text?.() || "";
      if (text) yield text;
    }

    const durationMs = Date.now() - started;
    log("✅ Gemini stream complete", { modelName, durationMs });

    trackModelCall(usedModel);
    trackLatency(durationMs);

  } catch (err) {
    console.error("❌ Gemini stream error", { modelName, message: err?.message });

    // Fallback: if primary model fails mid-stream, try fallback (non-streaming)
    // to at least get an answer out rather than a silent failure
    if (modelName !== fallbackModel) {
      log("Stream failed → fallback to non-streaming", { failedModel: modelName, fallbackModel });
      try {
        const fallback = await getAnswer({
          query, context, systemPrompt,
          modelName: fallbackModel,
          fallbackModel,
        });
        usedModel = fallbackModel;
        // Yield the fallback response as one big chunk
        yield fallback.response;
        trackModelCall(fallbackModel);
        trackLatency(Date.now() - started);
        return;
      } catch (fallbackErr) {
        console.error("❌ Fallback also failed", { message: fallbackErr?.message });
        throw fallbackErr;
      }
    }

    throw err;
  }
}