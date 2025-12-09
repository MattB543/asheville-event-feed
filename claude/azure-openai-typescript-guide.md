# Azure OpenAI TypeScript Implementation Guide

This guide explains how to use Azure OpenAI in TypeScript, mirroring the Python implementation in `analyze_screenshot_azure.py`.

## Package Installation

```bash
npm install openai dotenv
# or
pnpm add openai dotenv
```

The `openai` npm package includes the `AzureOpenAI` class for Azure OpenAI integration.

## Environment Variables

Map your existing `.env` variables:

| Python Variable | TypeScript Variable | Description |
|-----------------|---------------------|-------------|
| `AZURE_KEY_1` | `AZURE_OPENAI_API_KEY` | Your Azure API key |
| `AZURE_ENDPOINT` | `AZURE_OPENAI_ENDPOINT` | e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | `AZURE_OPENAI_DEPLOYMENT` | e.g. `gpt-5-mini` |
| `AZURE_OPENAI_API_VERSION` | `AZURE_OPENAI_API_VERSION` | e.g. `2024-12-01-preview` |

## Basic TypeScript Implementation

### Client Initialization

```typescript
import { AzureOpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,        // Your Azure API key
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,     // https://<resource>.openai.azure.com
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
});
```

### Simple Text Chat Completion

```typescript
async function chatCompletion(prompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
    messages: [
      { role: "user", content: prompt }
    ],
    max_tokens: 2000,
  });

  return response.choices[0]?.message?.content || "";
}
```

### With Token Usage Tracking

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputDetails?: {
    cachedTokens?: number;
    audioTokens?: number;
  };
  outputDetails?: {
    reasoningTokens?: number;
    audioTokens?: number;
  };
}

interface ChatResult {
  content: string;
  tokenUsage: TokenUsage;
}

async function chatCompletionWithUsage(prompt: string): Promise<ChatResult> {
  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
    messages: [
      { role: "user", content: prompt }
    ],
    max_tokens: 2000,
  });

  const usage = response.usage;

  const tokenUsage: TokenUsage = {
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
  };

  // Add detailed breakdowns if available
  if (usage?.prompt_tokens_details) {
    tokenUsage.inputDetails = {
      cachedTokens: (usage.prompt_tokens_details as any).cached_tokens || 0,
      audioTokens: (usage.prompt_tokens_details as any).audio_tokens || 0,
    };
  }

  if (usage?.completion_tokens_details) {
    tokenUsage.outputDetails = {
      reasoningTokens: (usage.completion_tokens_details as any).reasoning_tokens || 0,
      audioTokens: (usage.completion_tokens_details as any).audio_tokens || 0,
    };
  }

  return {
    content: response.choices[0]?.message?.content || "",
    tokenUsage,
  };
}
```

## Complete Example

```typescript
import { AzureOpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

// Initialize client
const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
});

async function main() {
  const prompt = "Explain the concept of async/await in TypeScript in 2-3 sentences.";

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt }
      ],
      max_tokens: 500,
    });

    console.log("Response:", response.choices[0]?.message?.content);
    console.log("\nToken Usage:");
    console.log(`  Input tokens: ${response.usage?.prompt_tokens}`);
    console.log(`  Output tokens: ${response.usage?.completion_tokens}`);
    console.log(`  Total tokens: ${response.usage?.total_tokens}`);

  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

main();
```

## Key Differences from Python

| Aspect | Python | TypeScript |
|--------|--------|------------|
| Package | `openai` | `openai` (same name) |
| Class | `AzureOpenAI` | `AzureOpenAI` |
| Config | `azure_endpoint` | `endpoint` |
| Config | `api_key` | `apiKey` |
| Config | `api_version` | `apiVersion` |
| Async | Optional (`async/await`) | Always async |
| Response | `response.choices[0].message.content` | `response.choices[0]?.message?.content` |

## Environment File Example

```env
# .env file
AZURE_OPENAI_API_KEY=your-api-key-here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
```

## Notes

1. **API Version**: Use `2024-10-21` for latest GA, or `2024-12-01-preview` for preview features like reasoning models.

2. **Model Parameter**: Even though you specify `deployment` in the client config, you still need to pass `model` in the `create()` call. Use the same deployment name.

3. **Error Handling**: The SDK automatically retries on 408, 409, 429, and 5xx errors.

4. **Types**: Azure API shape differs slightly from OpenAI's core API. Some types may not be perfectly accurate.

5. **Alternative: Azure AD Auth** (more secure for production):
   ```typescript
   import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

   const credential = new DefaultAzureCredential();
   const azureADTokenProvider = getBearerTokenProvider(
     credential,
     "https://cognitiveservices.azure.com/.default"
   );

   const client = new AzureOpenAI({
     azureADTokenProvider,
     apiVersion: "2024-10-21"
   });
   ```

## Sources

- [OpenAI Node.js SDK - GitHub](https://github.com/openai/openai-node)
- [Azure OpenAI TypeScript Library - Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/overview/azure/openai-readme)
- [openai - npm](https://www.npmjs.com/package/openai)
- [Azure OpenAI REST API Reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference)
