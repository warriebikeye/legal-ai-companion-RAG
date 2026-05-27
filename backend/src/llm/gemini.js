// src/llm/gemini.js

import { GoogleGenerativeAI } from "@google/generative-ai";

import {
  AI_MODELS,
} from "../config/ai.config.js";

import {
  getEmbeddingModel,
} from "../services/model-router.service.js";

/* =========================================================
   Logger
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[GEMINI] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[GEMINI] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   Gemini Singleton
========================================================= */

let genAI = null;

/* =========================================================
   Model Cache
========================================================= */

const modelCache = new Map();

/* =========================================================
   Initialize Gemini
========================================================= */

function initializeGemini() {
  if (genAI) {
    return;
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY missing from environment variables."
    );
  }

  log("Initializing Gemini client");

  genAI =
    new GoogleGenerativeAI(
      apiKey
    );

  log(
    "Gemini client initialized successfully"
  );
}

/* =========================================================
   Get Cached Model
========================================================= */

function getModel(modelName) {
  initializeGemini();

  if (
    modelCache.has(modelName)
  ) {
    log("Using cached model", {
      modelName,
    });

    return modelCache.get(
      modelName
    );
  }

  log("Creating Gemini model", {
    modelName,
  });

  const model =
    genAI.getGenerativeModel({
      model: modelName,
    });

  modelCache.set(
    modelName,
    model
  );

  return model;
}

/* =========================================================
   Estimate Tokens
========================================================= */

function estimateTokens(
  text = ""
) {
  return Math.ceil(
    text.length / 4
  );
}

/* =========================================================
   Generate Embedding
========================================================= */

export async function getEmbedding(
  text
) {
  const started = Date.now();

  try {
    const modelName =
      getEmbeddingModel();

    const embedModel =
      getModel(modelName);

    log(
      "Embedding request started",
      {
        modelName,

        textLength:
          text?.length || 0,

        estimatedTokens:
          estimateTokens(text),

        preview:
          text?.slice(0, 100),
      }
    );

    const result =
      await embedModel.embedContent(
        text
      );

    const embedding =
      result?.embedding?.values ||
      [];

    log(
      "✅ Embedding generated successfully",
      {
        modelName,

        vectorLength:
          embedding.length,

        durationMs:
          Date.now() - started,
      }
    );

    return embedding;
  } catch (err) {
    console.error(
      "❌ Gemini embedding error",
      {
        message:
          err?.message,

        stack:
          err?.stack,
      }
    );

    throw err;
  }
}

/* =========================================================
   Generate Answer
========================================================= */

/* =========================================================
   Generate Answer
========================================================= */

export async function getAnswer({
  query,
  context,
  systemPrompt,
  modelName =
    AI_MODELS.FLASH,
  fallbackModel =
    AI_MODELS.FLASH,
}) {
  const started = Date.now();

  try {
    const model =
      getModel(modelName);

    log(
      "Gemini answer generation started",
      {
        modelName,

        queryLength:
          query?.length || 0,

        contextLength:
          context?.length || 0,

        systemPromptLength:
          systemPrompt?.length || 0,

        estimatedInputTokens:
          estimateTokens(
            `${systemPrompt}\n${query}\n${context}`
          ),

        queryPreview:
          query?.slice(0, 120),
      }
    );

    const prompt = `
${systemPrompt}

USER QUERY:
${query}

CONTEXT:
${context}
`;

    log("Prompt constructed", {
      modelName,

      promptLength:
        prompt.length,
    });

    const result =
      await model.generateContent(
        prompt
      );

    log(
      "Gemini generateContent completed",
      {
        modelName,
      }
    );

    const response =
      result?.response?.text?.() ||
      "";

    log(
      "✅ Gemini response generated",
      {
        modelName,

        responseLength:
          response.length,

        estimatedOutputTokens:
          estimateTokens(
            response
          ),

        durationMs:
          Date.now() - started,
      }
    );

    return {
      response,

      modelUsed: modelName,

      latencyMs:
        Date.now() - started,

      fallbackUsed: false,
    };
  } catch (err) {
    console.error(
      "❌ Gemini answer error",
      {
        modelName,

        message:
          err?.message,

        queryPreview:
          query?.slice(0, 120),
      }
    );

    /* =====================================================
       Fallback Model Logic
    ===================================================== */

    if (
      modelName !==
      fallbackModel
    ) {
      log(
        "Primary model failed → trying fallback",
        {
          failedModel:
            modelName,

          fallbackModel,
        }
      );

      try {
        const fallbackResponse =
          await getAnswer({
            query,
            context,
            systemPrompt,
            modelName:
              fallbackModel,
            fallbackModel,
          });

        log(
          "✅ Fallback model succeeded",
          {
            fallbackModel,
          }
        );

        return {
          ...fallbackResponse,
          fallbackUsed: true,
        };
      } catch (fallbackErr) {
        console.error(
          "❌ Fallback model also failed",
          {
            message:
              fallbackErr?.message,
          }
        );

        throw fallbackErr;
      }
    }

    throw err;
  }
}