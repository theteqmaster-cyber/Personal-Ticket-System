const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pts', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Ollama
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  chat: (model, messages, activeTicketId) => ipcRenderer.invoke('ollama:chat', { model, messages, activeTicketId }),
  chatStream: (model, messages, streamId, activeTicketId) => ipcRenderer.invoke('ollama:chat-stream', { model, messages, streamId, activeTicketId }),
  stopStream: () => ipcRenderer.invoke('ollama:stop'),
  onStreamChunk: (streamId, cb) => {
    const key = `stream:chunk:${streamId}`;
    const handler = (_, chunk) => cb(chunk);
    ipcRenderer.on(key, handler);
    return () => ipcRenderer.removeListener(key, handler);
  },
  onStreamDone: (streamId, cb) => {
    const key = `stream:done:${streamId}`;
    const handler = (_, full) => cb(full);
    ipcRenderer.once(key, handler);
  },
  onStreamError: (streamId, cb) => {
    const key = `stream:error:${streamId}`;
    const handler = (_, err) => cb(err);
    ipcRenderer.once(key, handler);
  },

  // Sessions
  createSession: (title, model) => ipcRenderer.invoke('db:sessions:create', { title, model }),
  getSessions: () => ipcRenderer.invoke('db:sessions:list'),
  getSession: (id) => ipcRenderer.invoke('db:sessions:get', id),
  updateSessionTitle: (id, title) => ipcRenderer.invoke('db:sessions:update-title', { id, title }),
  deleteSession: (id) => ipcRenderer.invoke('db:sessions:delete', id),

  // Messages
  addMessage: (sessionId, role, content) => ipcRenderer.invoke('db:messages:add', { sessionId, role, content }),
  getMessages: (sessionId) => ipcRenderer.invoke('db:messages:get', sessionId),

  // Tickets
  createTicket: (title, description, priority) => ipcRenderer.invoke('db:tickets:create', { title, description, priority }),
  getTickets: () => ipcRenderer.invoke('db:tickets:list'),
  getTicket: (id) => ipcRenderer.invoke('db:tickets:get', id),
  updateTicket: (id, fields) => ipcRenderer.invoke('db:tickets:update', { id, fields }),
  deleteTicket: (id) => ipcRenderer.invoke('db:tickets:delete', id),
  addTicketNote: (ticketId, content, author) => ipcRenderer.invoke('db:tickets:add-note', { ticketId, content, author }),
  getTicketNotes: (ticketId) => ipcRenderer.invoke('db:tickets:get-notes', ticketId),
  recordInteraction: (ticketId) => ipcRenderer.invoke('db:tickets:interact', ticketId),

  // File system
  fsList: (relPath) => ipcRenderer.invoke('fs:list', relPath),
  fsRead: (absPath) => ipcRenderer.invoke('fs:read', absPath),
  fsWrite: (absPath, content) => ipcRenderer.invoke('fs:write', { absPath, content }),
  fsWriteRel: (relPath, content) => ipcRenderer.invoke('fs:write-rel', { relPath, content }),
  fsDelete: (relPath) => ipcRenderer.invoke('fs:delete', relPath),
  fsRename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
  getWorkspace: () => ipcRenderer.invoke('fs:workspace'),
  openFolderDialog: () => ipcRenderer.invoke('fs:open-folder'),
  revealInExplorer: (absPath) => ipcRenderer.invoke('fs:reveal', absPath),

  // AI commands
  executeAICommands: (text, activeTicketId) => ipcRenderer.invoke('ai:execute-commands', { text, activeTicketId }),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get-all'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),

  // Whisper Speech-to-Text
  transcribe: (arrayBuffer) => ipcRenderer.invoke('groq:transcribe', arrayBuffer),

  // Native Linux speech tools (spd-say)
  speak: (text, options) => ipcRenderer.invoke('tts:speak', { text, options }),
  stopSpeech: () => ipcRenderer.invoke('tts:stop'),
});
