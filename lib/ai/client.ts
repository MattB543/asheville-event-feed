import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { env, isAIEnabled as checkAIEnabled } from "../config/env";

let _genAI: GoogleGenerativeAI | null = null;
let _model: GenerativeModel | null = null;
let _embeddingModel: GenerativeModel | null = null;

// Lazily get or create the model - reads env var at call time, not module load time
export function getModel(): GenerativeModel | null {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(apiKey);
  }

  if (!_model) {
    _model = _genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  }

  return _model;
}

// Lazily get or create the embedding model (gemini-embedding-001)
export function getEmbeddingModel(): GenerativeModel | null {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(apiKey);
  }

  if (!_embeddingModel) {
    _embeddingModel = _genAI.getGenerativeModel({
      model: "gemini-embedding-001",
    });
  }

  return _embeddingModel;
}

export function isAIEnabled(): boolean {
  return checkAIEnabled();
}
