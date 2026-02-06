# Azure OpenAI - Quick Start for Any Project

Minimal guide to using Azure OpenAI for text completion, based on the pattern used in AVL GO.

## 1. Install the SDK

```bash
npm install openai
```

The `openai` package includes the `AzureOpenAI` client — no separate Azure SDK needed.

## 2. Environment Variables

```env
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
```

Get these from **Azure Portal > your OpenAI resource > Keys and Endpoint**.

The deployment name is whatever you named your model deployment in Azure AI Studio.

## 3. Basic Usage

```typescript
import { AzureOpenAI } from "openai";

const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
});

async function complete(systemPrompt: string, userPrompt: string) {
  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 2000,
  });

  return response.choices[0]?.message?.content || "";
}
```

## 4. Streaming

```typescript
async function streamComplete(systemPrompt: string, userPrompt: string) {
  const stream = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 4000,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) process.stdout.write(text);
  }
}
```

## 5. Notes

- **`model` param is required** in the `.create()` call even though you set `deployment` on the client. Pass the same deployment name.
- **`max_completion_tokens`** is used instead of the older `max_tokens`. Both work, but `max_completion_tokens` is the current standard.
- **gpt-5-mini does not support the `temperature` parameter** — it only uses the default (1). If you use a different deployment (e.g. gpt-4o), you can set temperature normally.
- The `openai` package handles the Azure-specific auth headers and URL routing automatically via the `AzureOpenAI` class.
