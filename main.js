const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const db = require('./src/database');
const ollama = require('./src/ollama');
const fm = require('./src/fileManager');

let mainWindow;
let workspacePath;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#080b12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Automatically grant permission requests for media/microphone
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(true); // Grant all permissions by default for development simplicity
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Init database
  const userData = app.getPath('userData');
  db.init(userData);

  // Init workspace
  const savedWs = db.getSetting('workspace_path');
  workspacePath = savedWs || path.join(app.getPath('documents'), 'PTS-Workspace');
  fm.setWorkspace(workspacePath);
  db.setSetting('workspace_path', workspacePath);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Window Controls ───────────────────────────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.close());

// ── Ollama ────────────────────────────────────────────────────────────────────
ipcMain.handle('ollama:list-models', () => ollama.listModels());

function buildSystemPrompt(activeTicketId) {
  const allTickets = db.getTickets();
  let sysPrompt = ollama.SYSTEM_PROMPT + `\n\n=== WORKSPACE CONTEXT ===\n`;

  // Prevent context overflow: limit to top 15 most relevant tickets
  const relevantTickets = allTickets
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 15);

  if (activeTicketId && !relevantTickets.find(t => t.id === activeTicketId)) {
    const activeT = allTickets.find(t => t.id === activeTicketId);
    if (activeT) relevantTickets.unshift(activeT);
  }

  if (relevantTickets.length > 0) {
    sysPrompt += `Current Active/Recent Tickets (Showing ${relevantTickets.length} of ${allTickets.length}):\n`;
    relevantTickets.forEach(t => {
      sysPrompt += `- [Ticket #${t.id}] ${t.title} (Status: ${t.status}, Priority: ${t.priority})\n`;
      if (t.description) {
        // Truncate description to 150 chars to save tokens
        const desc = t.description.replace(/<[^>]*>?/gm, '').substring(0, 150);
        sysPrompt += `  Description: ${desc}${t.description.length > 150 ? '...' : ''}\n`;
      }
    });
  } else {
    sysPrompt += `No tickets currently exist.\n`;
  }

  if (activeTicketId) {
    const active = db.getTicket(activeTicketId);
    if (active) {
      sysPrompt += `\nACTIVE TICKET CONTEXT: You are currently focused on Ticket #${active.id} (${active.title}).\n`;
      sysPrompt += `Any files you create using [WRITE_FILE:filename.ext] will automatically be saved into this ticket's dedicated folder.\n`;
      
      const notes = db.getTicketNotes(active.id);
      if (notes && notes.length > 0) {
         // Limit to last 10 notes to avoid overflow
         const recentNotes = notes.slice(-10);
         sysPrompt += `Notes for this ticket (showing last ${recentNotes.length}):\n`;
         recentNotes.forEach(n => sysPrompt += ` - ${n.author}: ${n.content.substring(0, 500)}\n`);
      }
    }
  } else {
    sysPrompt += `\nACTIVE TICKET CONTEXT: No ticket is selected. Any files you write will be saved to the root workspace.\n`;
  }
  return sysPrompt;
}

const https = require('https');

async function performWebSearch(query) {
  return new Promise((resolve) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    };
    https.get(url, options, (res) => {
      let html = '';
      res.on('data', c => html += c);
      res.on('end', () => {
        try {
          const results = [];
          const regex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let mSnippet;
          while ((mSnippet = regex.exec(html)) !== null && results.length < 5) {
            const snippet = mSnippet[1].replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
            results.push(snippet);
          }
          if (results.length === 0) {
            resolve("No relevant results found on the web.");
            return;
          }
          const text = results.map((r, i) => `Result ${i+1}: ${r}`).join('\n\n');
          resolve(text);
        } catch (err) {
          resolve(`Error parsing web search results: ${err.message}`);
        }
      });
    }).on('error', (err) => {
      resolve(`Web search request failed: ${err.message}`);
    });
  });
}

function performFileSearch(query, activeTicketId) {
  try {
    let searchDir = fm.getWorkspace();
    if (activeTicketId) {
      const ticket = db.getTicket(activeTicketId);
      if (ticket && ticket.folder_path && fs.existsSync(ticket.folder_path)) {
        searchDir = ticket.folder_path;
      }
    }

    const results = [];
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const textExts = ['.txt', '.md', '.json', '.html', '.css', '.js', '.ts', '.py', '.sh', '.yaml', '.yml', '.sql', '.conf', '.ini', '.csv', '.xml'];
          if (!textExts.includes(ext)) continue;

          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.toLowerCase().includes(query.toLowerCase())) {
            const rel = path.relative(fm.getWorkspace(), fullPath);
            const lines = content.split('\n');
            const matchingLines = [];
            lines.forEach((line, idx) => {
              if (line.toLowerCase().includes(query.toLowerCase()) && matchingLines.length < 3) {
                matchingLines.push(`Line ${idx+1}: ${line.trim()}`);
              }
            });
            results.push(`File: ${rel}\nMatches:\n${matchingLines.join('\n')}`);
          }
        }
      }
    };
    walk(searchDir);
    if (results.length === 0) return "No matching content found in local files.";
    return results.slice(0, 5).join('\n\n');
  } catch (err) {
    return `Error searching files: ${err.message}`;
  }
}

ipcMain.handle('ollama:chat', async (event, { model, messages, activeTicketId }) => {
  if (activeTicketId) db.recordInteraction(activeTicketId);
  const sysPrompt = buildSystemPrompt(activeTicketId);
  let currentMessages = [...messages];
  let turn = 0;
  let fullResponse = '';

  while (turn < 2) {
    const res = await ollama.chat(model, sysPrompt, currentMessages);
    fullResponse += (fullResponse ? '\n' : '') + res;

    const webMatch = /\[WEB_SEARCH:([^\]]+)\]/.exec(res);
    const fileMatch = /\[FILE_SEARCH:([^\]]+)\]/.exec(res);

    if (webMatch || fileMatch) {
      turn++;
      let searchResults = '';
      if (webMatch) {
        searchResults = await performWebSearch(webMatch[1].trim());
      } else if (fileMatch) {
        searchResults = performFileSearch(fileMatch[1].trim(), activeTicketId);
      }

      const cleanRes = res
        .replace(/\[WEB_SEARCH:[^\]]+\]/g, '')
        .replace(/\[FILE_SEARCH:[^\]]+\]/g, '')
        .trim();

      currentMessages.push({ role: 'assistant', content: cleanRes });
      currentMessages.push({ role: 'user', content: `[SYSTEM: Search results:\n${searchResults}]` });
    } else {
      break;
    }
  }

  return fullResponse;
});

ipcMain.handle('ollama:chat-stream', async (event, { model, messages, streamId, activeTicketId }) => {
  try {
    if (activeTicketId) db.recordInteraction(activeTicketId);
    const sysPrompt = buildSystemPrompt(activeTicketId);
    let currentMessages = [...messages];
    let turn = 0;
    let fullResponse = '';

    while (turn < 2) {
      let accumulated = '';
      const full = await ollama.chatStream(model, sysPrompt, currentMessages, (chunk) => {
        accumulated += chunk;
        mainWindow.webContents.send(`stream:chunk:${streamId}`, chunk);
      });

      fullResponse += (fullResponse ? '\n' : '') + full;

      const webMatch = /\[WEB_SEARCH:([^\]]+)\]/.exec(accumulated);
      const fileMatch = /\[FILE_SEARCH:([^\]]+)\]/.exec(accumulated);

      if (webMatch || fileMatch) {
        turn++;
        let searchResults = '';
        if (webMatch) {
          const query = webMatch[1].trim();
          mainWindow.webContents.send(`stream:chunk:${streamId}`, `\n\n*🔍 JARVIS is searching the web for "${query}" Sir...*\n\n`);
          searchResults = await performWebSearch(query);
        } else if (fileMatch) {
          const query = fileMatch[1].trim();
          mainWindow.webContents.send(`stream:chunk:${streamId}`, `\n\n*📂 JARVIS is searching internal workspace files for "${query}" Sir...*\n\n`);
          searchResults = performFileSearch(query, activeTicketId);
        }

        const cleanAccumulated = accumulated
          .replace(/\[WEB_SEARCH:[^\]]+\]/g, '')
          .replace(/\[FILE_SEARCH:[^\]]+\]/g, '')
          .trim();

        currentMessages.push({ role: 'assistant', content: cleanAccumulated });
        currentMessages.push({ role: 'user', content: `[SYSTEM: Search results:\n${searchResults}]` });
      } else {
        break;
      }
    }

    mainWindow.webContents.send(`stream:done:${streamId}`, fullResponse);
    return { ok: true, full: fullResponse };
  } catch (err) {
    mainWindow.webContents.send(`stream:error:${streamId}`, err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('ollama:stop', () => {
  ollama.stopCurrentStream();
});

ipcMain.handle('groq:transcribe', async (event, arrayBuffer) => {
  try {
    const buffer = Buffer.from(arrayBuffer);
    const formData = new FormData();
    
    // Construct a standard Blob directly in memory
    const blob = new Blob([buffer], { type: 'audio/wav' });
    formData.append('file', blob, 'speech.wav');
    formData.append('model', 'whisper-large-v3');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ollama.GROQ_KEY}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq Whisper error: ${errText}`);
    }

    const data = await res.json();
    return { ok: true, text: data.text || '' };
  } catch (err) {
    console.error("Transcription error in backend:", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('tts:speak', async (event, { text, options = {} }) => {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const escapedText = text.replace(/'/g, "'\\''");
    
    // Map browser rate (0.5 to 2.0) to spd-say rate (-100 to 100)
    // 1.0 rate maps to 0. 0.5 maps to -50. 2.0 maps to +100 (or +50 for stability).
    const rateVal = options.rate !== undefined ? Math.round((options.rate - 1.0) * 100) : -10;
    
    // Map browser pitch (0.5 to 2.0) to spd-say pitch (-100 to 100)
    // 1.0 pitch maps to 0.
    const pitchVal = options.pitch !== undefined ? Math.round((options.pitch - 1.0) * 100) : 10;
    
    // Select the voice type (default to male3)
    const voiceType = options.voiceType || 'male3';
    
    const cmd = `spd-say -p ${pitchVal} -r ${rateVal} -t ${voiceType} '${escapedText}'`;
    exec(cmd, (err) => {
      resolve({ ok: !err });
    });
  });
});

ipcMain.handle('tts:stop', async () => {
  const { exec } = require('child_process');
  exec('spd-say -C');
});

// ── Database: Sessions ─────────────────────────────────────────────────────────
ipcMain.handle('db:sessions:create', (_, { title, model }) => db.createSession(title, model));
ipcMain.handle('db:sessions:list', () => db.getSessions());
ipcMain.handle('db:sessions:get', (_, id) => db.getSession(id));
ipcMain.handle('db:sessions:update-title', (_, { id, title }) => db.updateSessionTitle(id, title));
ipcMain.handle('db:sessions:delete', (_, id) => db.deleteSession(id));

// ── Database: Messages ────────────────────────────────────────────────────────
ipcMain.handle('db:messages:add', (_, { sessionId, role, content }) => db.addMessage(sessionId, role, content));
ipcMain.handle('db:messages:get', (_, sessionId) => db.getMessages(sessionId));

// ── Database: Tickets ─────────────────────────────────────────────────────────
ipcMain.handle('db:tickets:create', (_, { title, description, priority }) => {
  const ticket = db.createTicket(title, description, priority);
  const folderPath = fm.createTicketFolder(ticket.id, ticket.title);
  db.updateTicket(ticket.id, { folder_path: folderPath });
  return { ...ticket, folder_path: folderPath };
});
ipcMain.handle('db:tickets:list', () => db.getTickets());
ipcMain.handle('db:tickets:get', (_, id) => db.getTicket(id));
ipcMain.handle('db:tickets:update', (_, { id, fields }) => {
  db.updateTicket(id, fields);
  return db.getTicket(id);
});
ipcMain.handle('db:tickets:delete', (_, id) => db.deleteTicket(id));
ipcMain.handle('db:tickets:add-note', (_, { ticketId, content, author }) => db.addTicketNote(ticketId, content, author));
ipcMain.handle('db:tickets:get-notes', (_, ticketId) => db.getTicketNotes(ticketId));
ipcMain.handle('db:tickets:interact', (_, ticketId) => {
  db.recordInteraction(ticketId);
  return { ok: true };
});

// ── File Manager ──────────────────────────────────────────────────────────────
ipcMain.handle('fs:list', (_, relPath) => {
  try { return { ok: true, tree: fm.listFiles(relPath) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:read', (_, absPath) => {
  try { return { ok: true, content: fm.getFileContent(absPath) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:write', (_, { absPath, content }) => {
  try { fm.saveFileContent(absPath, content); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:write-rel', (_, { relPath, content }) => {
  try { const abs = fm.writeFile(relPath, content); return { ok: true, absPath: abs }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:delete', (_, relPath) => {
  try { fm.deleteFile(relPath); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:rename', (_, { oldPath, newPath }) => {
  try { fm.renameFile(oldPath, newPath); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:workspace', () => fm.getWorkspace());

ipcMain.handle('fs:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Workspace Folder',
  });
  if (!result.canceled && result.filePaths[0]) {
    workspacePath = result.filePaths[0];
    fm.setWorkspace(workspacePath);
    db.setSetting('workspace_path', workspacePath);
    return { ok: true, path: workspacePath };
  }
  return { ok: false };
});

ipcMain.handle('fs:reveal', (_, absPath) => {
  shell.showItemInFolder(absPath);
});

// ── AI Command Execution ──────────────────────────────────────────────────────
ipcMain.handle('ai:execute-commands', async (event, { text, activeTicketId }) => {
  const commands = fm.parseAICommands(text);
  const log = [];

  for (const cmd of commands) {
    try {
      if (cmd.type === 'write_file') {
        // Resolve relative to active ticket folder or workspace
        let basePath = fm.getWorkspace();
        if (activeTicketId) {
          const ticket = db.getTicket(activeTicketId);
          if (ticket && ticket.folder_path) basePath = ticket.folder_path;
        }
        const relToWorkspace = path.relative(fm.getWorkspace(), path.join(basePath, cmd.path));
        const abs = fm.writeFile(relToWorkspace, cmd.content);
        log.push({ type: 'write_file', path: abs, status: 'ok' });
      } else if (cmd.type === 'add_ticket') {
        const ticket = db.createTicket(cmd.title, '', cmd.priority);
        const folderPath = fm.createTicketFolder(ticket.id, ticket.title);
        db.updateTicket(ticket.id, { folder_path: folderPath });
        log.push({ type: 'add_ticket', ticket: { ...ticket, folder_path: folderPath }, status: 'ok' });
      } else if (cmd.type === 'update_ticket') {
        db.updateTicket(cmd.id, { status: cmd.status });
        log.push({ type: 'update_ticket', id: cmd.id, status: 'ok' });
      } else if (cmd.type === 'load_ticket') {
        log.push({ type: 'load_ticket', id: cmd.id, status: 'ok' });
      } else if (cmd.type === 'close_ticket') {
        log.push({ type: 'close_ticket', status: 'ok' });
      }
    } catch (e) {
      log.push({ type: cmd.type, error: e.message, status: 'error' });
    }
  }

  const cleanText = fm.cleanAIResponse(text);
  return { log, cleanText };
});

// ── Settings ──────────────────────────────────────────────────────────────────
ipcMain.handle('settings:get-all', () => db.getAllSettings());
ipcMain.handle('settings:set', (_, { key, value }) => { db.setSetting(key, value); });
