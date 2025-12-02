// First API call with reasoning
let response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
method: "POST",
headers: {
"Authorization": `Bearer ${<OPENROUTER_API_KEY>}`,
"Content-Type": "application/json"
},
body: JSON.stringify({
"model": "x-ai/grok-4.1-fast:free",
"messages": [
{
"role": "user",
"content": "How many r's are in the word 'strawberry'?"
}
],
"reasoning": {"enabled": true}
})
});

// Extract the assistant message with reasoning_details and save it to the response variable
const result = await response.json();
response = result.choices[0].message;

// Preserve the assistant message with reasoning_details
const messages = [
{
role: 'user',
content: "How many r's are in the word 'strawberry'?",
},
{
role: 'assistant',
content: response.content,
reasoning_details: response.reasoning_details, // Pass back unmodified
},
{
role: 'user',
content: "Are you sure? Think carefully.",
},
];

// Second API call - model continues reasoning from where it left off
const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
method: "POST",
headers: {
"Authorization": `Bearer ${<OPENROUTER_API_KEY>}`,
"Content-Type": "application/json",
},
body: JSON.stringify({
"model": "x-ai/grok-4.1-fast:free",
"messages": messages // Includes preserved reasoning_details
})
});
