/**
 * Test GEMINI_API_KEY with gemini-3-pro-preview model
 *
 * Run with: npx tsx scripts/test-gemini-pro.ts
 */

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function testGeminiPro() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in environment');
    process.exit(1);
  }

  // Try to get project info by calling the models list API directly
  console.log('Checking API key project info...\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    // The x-goog-api-client header or error messages might reveal project info
    // But more reliably, check the response headers
    const projectId = response.headers.get('x-goog-api-project-id');

    if (projectId) {
      console.log(`Project ID: ${projectId}`);
    } else {
      console.log('Project ID not exposed in API response headers.');
      console.log('\nTo find your project:');
      console.log('1. Go to https://aistudio.google.com/apikey');
      console.log('2. Find your API key - the project name is shown next to it');
      console.log('\nOr check: https://console.cloud.google.com/apis/credentials');
    }
  } catch (error) {
    console.log('Could not fetch project info from API');
    if (error instanceof Error) {
      console.log(`Reason: ${error.message}`);
    }
  }

  // Also test the model works
  console.log('\nTesting gemini-3-pro-preview...\n');

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: 'gemini-3-pro-preview' });

  try {
    const result = await model.generateContent(
      'Say "Hello from Gemini 3 Pro!" in exactly those words.'
    );
    const response = result.response;
    const text = response.text();

    console.log('Success!\n');
    console.log('Response:', text);
  } catch (error: unknown) {
    console.error('Failed to call gemini-3-pro-preview\n');
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error);
    }
    process.exit(1);
  }
}

testGeminiPro();
