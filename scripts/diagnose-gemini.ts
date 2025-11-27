import { env } from "../lib/config/env";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No API key found in environment!");
    return;
  }
  console.log(`Using API Key: ${apiKey.substring(0, 8)}...`);

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    // There isn't a direct "list models" method exposed easily in the high-level SDK 
    // without using the model manager, but we can try a simple generation with a known stable model.
    // Actually, we can use the model manager if we want, but a simple generation test is better proof of life.
    
    console.log("Attempting to generate content with 'gemini-1.5-flash'...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Hello, are you working?");
    const response = await result.response;
    console.log("Success! Response:", response.text());
  } catch (error: any) {
    console.error("Error with 'gemini-1.5-flash':", error.message);
    
    if (error.message.includes("404")) {
        console.log("Model not found. Trying 'gemini-pro'...");
        try {
            const modelPro = genAI.getGenerativeModel({ model: "gemini-pro" });
            const resultPro = await modelPro.generateContent("Hello?");
            console.log("Success with gemini-pro!", resultPro.response.text());
        } catch (err2: any) {
            console.error("Error with 'gemini-pro':", err2.message);
        }
    }
  }
}

main().catch(console.error);
