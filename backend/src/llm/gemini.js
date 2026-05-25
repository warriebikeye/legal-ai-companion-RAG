import { GoogleGenerativeAI } from "@google/generative-ai";

/* =========================================================
   Simple Gemini Logger
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
   Lazy Gemini Initialization
========================================================= */

let genAI = null;
let chatModel = null;
let embedModel = null;

function initializeGemini() {
  if (
    genAI &&
    chatModel &&
    embedModel
  ) {
    return;
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  console.log(
    "API KEY EXISTS:",
    !!apiKey
  );

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing from environment variables."
    );
  }

  log("Initializing Gemini client");

  genAI = new GoogleGenerativeAI(
    apiKey
  );

  log("Creating Gemini chat model");

  chatModel =
    genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
    });

  log(
    "Creating Gemini embedding model"
  );

  embedModel =
    genAI.getGenerativeModel({
      model:
        "gemini-embedding-001",
    });

  log(
    "Gemini models initialized successfully"
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
    initializeGemini();

    log(
      "Embedding request started",
      {
        textLength:
          text?.length || 0,

        preview: text?.slice(
          0,
          120
        ),
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
        vectorLength:
          embedding.length,

        durationMs:
          Date.now() - started,
      }
    );

    return embedding;
  } catch (err) {
    console.error(
      "❌ Gemini embedding error:",
      {
        message: err?.message,
        stack: err?.stack,
      }
    );

    throw err;
  }
}

/* =========================================================
   Generate Answer
========================================================= */

export async function getAnswer(
  query,
  context,
  systemPrompt
) {
  const started = Date.now();

  try {
    initializeGemini();

    log(
      "Gemini answer generation started",
      {
        queryLength:
          query?.length || 0,

        contextLength:
          context?.length || 0,

        systemPromptLength:
          systemPrompt?.length || 0,

        queryPreview:
          query?.slice(0, 120),
      }
    );

    const prompt = `
${systemPrompt}

Query:
${query}

Context:
${context}
`;

    log("Prompt constructed", {
      totalPromptLength:
        prompt.length,
    });

    log(
      "Calling Gemini generateContent"
    );

    const result =
      await chatModel.generateContent(
        prompt
      );

    log(
      "Gemini generateContent completed"
    );

    const response =
      result?.response?.text?.() ||
      "";

    log(
      "✅ Gemini response generated",
      {
        responseLength:
          response.length,

        durationMs:
          Date.now() - started,
      }
    );

    return response;
  } catch (err) {
    console.error(
      "❌ Gemini answer error:",
      {
        message: err?.message,
        stack: err?.stack,
        queryPreview:
          query?.slice(0, 120),
        contextLength:
          context?.length || 0,
      }
    );

    throw err;
  }
}