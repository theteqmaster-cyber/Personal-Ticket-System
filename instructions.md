# Project Setup Instructions

To keep your personal API credentials secure and private, `src/ollama.js` is excluded from git tracking via `.gitignore`. 

If you are cloning this repository for the first time, you must create `src/ollama.js` manually.

### Step 1: Create the File
Create a new file at: `src/ollama.js`

### Step 2: Paste the Code Template
Copy and paste the entire code block below into `src/ollama.js`, and replace `'YOUR_GROQ_API_KEY'` with your actual Groq API Key:

```javascript
const http = require('http');
const https = require('https');

const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;

// Paste your actual Groq API Key here
const GROQ_KEY = 'YOUR_GROQ_API_KEY';
const GROQ_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'];

let abortController = null;

function stopCurrentStream() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

const SYSTEM_PROMPT = `You are JARVIS — a highly intelligent, precise, and witty AI assistant. 
You speak in a calm, confident, slightly British-accented tone (like the movie JARVIS). 
You are helpful, proactive, and always address the user as "Sir" or by name if known.

You have the ability to interact with the file system and manage tickets. When performing actions, 
use these exact command blocks in your response:

To create/overwrite a file:
[CREATE_FILE:relative/path/to/file.ext]
[WRITE_FILE:relative/path/to/file.ext]
file content goes here
[/WRITE_FILE]

To create a NEW ticket:
[ADD_TICKET:Title Here|priority]
where priority is: low, medium, or high.
CRITICAL: You MUST use this exact [ADD_TICKET:...] format to create a ticket. Do not just type "[Ticket #...]". If you need to create a new ticket AND write files to it, you must FIRST output [ADD_TICKET] and WAIT for the user to confirm the ticket is loaded before writing any files.

To update a ticket status (e.g. to mark it in progress, or to fully complete/finish it):
[UPDATE_TICKET:id:status]
where status is: backlog, in_progress, or done (To complete/finish a ticket, use status "done").

To deselect, close, or hide the current active ticket editor (e.g. if the user says "close ticket", "close the active ticket", "close the ticket", meaning deselecting it so we can open it later without completing it):
[CLOSE_TICKET]

To select, load, or open a ticket to view its details or work on it (or to switch/open a different ticket):
[LOAD_TICKET:id]
where id is the numeric ticket ID.
CRITICAL: You MUST use this exact [LOAD_TICKET:id] format whenever the user asks to load, show, open, view, or focus a ticket. Do not just speak about loading it; you must output the block so the system actually switches the screen.

To search the internet (use ONLY when the user asks for real-time/current web info, or asks to search the web):
[WEB_SEARCH:your search query here]

To search local/internal workspace files (use ONLY when asked to find code patterns, look for specific content/phrases in files, or search internal code):
[FILE_SEARCH:your search query here]

Always acknowledge commands clearly and confirm actions taken (e.g. "I have loaded ticket #id for you, Sir" or "I have closed/completed ticket #id, Sir").
Keep responses concise for voice mode. In chat mode, you may elaborate.`;

function listModels() {
  return new Promise((resolve) => {
    const options = {
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/tags', method: 'GET',
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const ollamaModels = (parsed.models || []).map(m => m.name);
          resolve([...GROQ_MODELS, ...ollamaModels]);
        } catch { resolve([...GROQ_MODELS]); }
      });
    });
    req.on('error', () => resolve([...GROQ_MODELS]));
    req.end();
  });
}

function chatStream(model, sysPrompt, messages, onChunk) {
  const cleanMessages = messages.map(m => ({
    role: m.role,
    content: m.content
  }));
  if (GROQ_MODELS.includes(model)) {
    return groqChatStream(model, sysPrompt, cleanMessages, onChunk);
  }
  return ollamaChatStream(model, sysPrompt, cleanMessages, onChunk);
}

function ollamaChatStream(model, sysPrompt, messages, onChunk) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: sysPrompt }, ...messages],
      stream: true,
    });

    abortController = new AbortController();
    const options = {
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/chat', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      signal: abortController.signal,
    };

    let fullContent = '';
    const req = http.request(options, (res) => {
      res.setEncoding('utf8');
      if (res.statusCode >= 400) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`Ollama Error ${res.statusCode}: ${errBody}`)));
        return;
      }
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); 
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.message && typeof obj.message.content === 'string') {
              fullContent += obj.message.content;
              onChunk(obj.message.content);
            }
            if (obj.done) resolve(fullContent);
          } catch (e) {
            console.error("Ollama JSON parse error:", e, "Line:", line);
          }
        }
      });
      res.on('end', () => resolve(fullContent));
    });

    req.on('error', (err) => {
      if (err.name === 'AbortError') return resolve(fullContent);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

function groqChatStream(model, sysPrompt, messages, onChunk) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: sysPrompt }, ...messages],
      stream: true,
    });

    abortController = new AbortController();
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
      signal: abortController.signal,
    };

    let fullContent = '';
    const req = https.request(options, (res) => {
      res.setEncoding('utf8');
      if (res.statusCode >= 400) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`Groq Error ${res.statusCode}: ${errBody}`)));
        return;
      }
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); 
        for (let line of lines) {
          line = line.trim();
          if (!line.startsWith('data: ')) continue;
          const message = line.replace(/^data: /, '');
          if (message === '[DONE]') {
            return resolve(fullContent);
          }
          try {
            const parsed = JSON.parse(message);
            const token = parsed.choices[0]?.delta?.content;
            if (token) {
              fullContent += token;
              onChunk(token);
            }
          } catch (e) { /* skip */ }
        }
      });
      res.on('end', () => resolve(fullContent));
    });

    req.on('error', (err) => {
      if (err.name === 'AbortError') return resolve(fullContent);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function chat(model, sysPrompt, messages) {
  return new Promise((resolve, reject) => {
    let full = '';
    chatStream(model, sysPrompt, messages, (c) => full += c)
      .then(() => resolve(full))
      .catch(reject);
  });
}

module.exports = { listModels, chatStream, chat, SYSTEM_PROMPT, stopCurrentStream, GROQ_KEY };
```
