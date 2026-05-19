/* ── app.js — PTS Jarvis Renderer ─────────────────────────── */
'use strict';

// ── State ──────────────────────────────────────────────────────
const state = {
  view: 'chat',
  sessions: [],
  activeSession: null,
  messages: [],
  tickets: [],
  activeTicketId: null,
  models: [],
  activeModel: 'qwen2.5',
  settings: {},
  fileTree: [],
  openFile: null,
  fileEditorDirty: false,
  streaming: false,
  ttsEnabled: true,
  ttsRate: 0.95,
  ttsPitch: 1.1,
  ttsVoiceType: 'male3',
  ticketSearchQuery: '',
  columnLimits: { backlog: 10, in_progress: 10, done: 10 },
  sessionLimit: 15,
};

// ── DOM refs ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $q = (sel) => document.querySelector(sel);

// ── Init ───────────────────────────────────────────────────────
async function init() {
  bindTitleBar();
  bindNav();
  bindModals();
  await loadSettings();
  await loadModels();
  await loadSessions();
  await loadTickets();
  await loadFileTree();
  bindChatInput();
  bindTicketActions();
  bindFileActions();
  bindSettingsControls();
  bindMSpace();
  bindVoiceMode();
}

// ── Title Bar ──────────────────────────────────────────────────
function bindTitleBar() {
  $('btn-minimize').addEventListener('click', () => window.pts.minimize());
  $('btn-maximize').addEventListener('click', () => window.pts.maximize());
  $('btn-close').addEventListener('click', () => window.pts.close());
}

// ── Navigation ─────────────────────────────────────────────────
function bindNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'files') loadFileTree();
  if (view === 'tickets') renderTickets();
  if (view === 'mspace') {
    $('mspace-chat-panel').appendChild($('chat-area'));
    renderMSpace();
  } else if (view === 'chat') {
    $('chat-layout').appendChild($('chat-area'));
  }
}

// ── Settings ───────────────────────────────────────────────────
async function loadSettings() {
  state.settings = await window.pts.getSettings();
  state.activeModel = state.settings.active_model || 'qwen2.5';
  state.ttsEnabled = state.settings.voice_enabled !== '0';
  state.ttsRate = parseFloat(state.settings.tts_rate || 0.95);
  state.ttsPitch = parseFloat(state.settings.tts_pitch || 1.1);
  state.ttsVoiceType = state.settings.tts_voice_type || 'male3';
  const wsPath = state.settings.workspace_path || '';
  if (wsPath) $('settings-workspace-path').textContent = wsPath;
}

function bindSettingsControls() {
  const voiceEl = $('settings-voice');
  const rateEl = $('settings-rate');
  const pitchEl = $('settings-pitch');
  const voiceTypeEl = $('settings-voice-type');

  voiceEl.checked = state.ttsEnabled;
  rateEl.value = state.ttsRate;
  pitchEl.value = state.ttsPitch;
  if (voiceTypeEl) voiceTypeEl.value = state.ttsVoiceType;
  $('settings-rate-val').textContent = state.ttsRate;
  $('settings-pitch-val').textContent = state.ttsPitch;

  voiceEl.addEventListener('change', () => {
    state.ttsEnabled = voiceEl.checked;
    window.pts.setSetting('voice_enabled', state.ttsEnabled ? '1' : '0');
  });
  rateEl.addEventListener('input', () => {
    state.ttsRate = parseFloat(rateEl.value);
    $('settings-rate-val').textContent = state.ttsRate.toFixed(2);
    window.pts.setSetting('tts_rate', state.ttsRate);
  });
  pitchEl.addEventListener('input', () => {
    state.ttsPitch = parseFloat(pitchEl.value);
    $('settings-pitch-val').textContent = state.ttsPitch.toFixed(2);
    window.pts.setSetting('tts_pitch', state.ttsPitch);
  });
  if (voiceTypeEl) {
    voiceTypeEl.addEventListener('change', () => {
      state.ttsVoiceType = voiceTypeEl.value;
      window.pts.setSetting('tts_voice_type', state.ttsVoiceType);
    });
  }

  $('btn-change-workspace').addEventListener('click', async () => {
    const res = await window.pts.openFolderDialog();
    if (res.ok) {
      $('settings-workspace-path').textContent = res.path;
      await loadFileTree();
    }
  });

  // Sync settings model select
  const sModel = $('settings-model');
  sModel.addEventListener('change', () => {
    state.activeModel = sModel.value;
    window.pts.setSetting('active_model', state.activeModel);
    syncModelSelects();
  });
}

function syncModelSelects() {
  [$('model-select'), $('settings-model')].forEach(sel => {
    if (sel) sel.value = state.activeModel;
  });
}

function updateLineNumbers(textarea, lineNumbersDiv) {
  if (!textarea || !lineNumbersDiv) return;
  const lines = textarea.value.split('\n');
  const count = lines.length;
  let html = '';
  for (let i = 1; i <= count; i++) {
    html += `<div>${i}</div>`;
  }
  lineNumbersDiv.innerHTML = html;
  lineNumbersDiv.scrollTop = textarea.scrollTop;
}

// ── Models ─────────────────────────────────────────────────────
async function loadModels() {
  try {
    const models = await window.pts.listModels();
    state.models = models.length ? models : ['qwen2.5'];
    const statusDot = $('ollama-status');
    statusDot.classList.toggle('online', models.length > 0);
    statusDot.classList.toggle('offline', models.length === 0);
    populateModelSelects();
  } catch {
    populateModelSelects();
  }
}

function populateModelSelects() {
  const opts = state.models.map(m => `<option value="${m}">${m}</option>`).join('');
  [$('model-select'), $('settings-model')].forEach(sel => {
    if (sel) { sel.innerHTML = opts; sel.value = state.activeModel; }
  });

  $('model-select').addEventListener('change', () => {
    state.activeModel = $('model-select').value;
    window.pts.setSetting('active_model', state.activeModel);
    syncModelSelects();
  });
}

// ── Sessions ───────────────────────────────────────────────────
async function loadSessions() {
  state.sessions = await window.pts.getSessions();
  renderSessionList();
  if (state.sessions.length > 0 && !state.activeSession) {
    await selectSession(state.sessions[0].id);
  } else {
    renderMessages();
  }
}

function renderSessionList() {
  const el = $('session-list');
  if (!state.sessions.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div>No sessions yet</div>`;
    return;
  }
  
  const visibleSessions = state.sessions.slice(0, state.sessionLimit);
  let html = visibleSessions.map(s => `
    <div class="session-item ${s.id === state.activeSession ? 'active' : ''}" data-id="${s.id}">
      <span class="session-name">${escHtml(s.title)}</span>
      <button class="session-del" data-id="${s.id}" title="Delete">✕</button>
    </div>`).join('');

  if (state.sessions.length > state.sessionLimit) {
    html += `<button id="btn-load-more-sessions" style="width: calc(100% - 12px); margin: 6px; padding: 6px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text-faint); font-size: 11px; cursor: pointer; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; transition: background 0.15s, color 0.15s;">Load More History</button>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('session-del')) return;
      selectSession(parseInt(item.dataset.id));
    });
  });
  el.querySelectorAll('.session-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(parseInt(btn.dataset.id));
    });
  });

  const loadMoreBtn = $('btn-load-more-sessions');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      state.sessionLimit += 15;
      renderSessionList();
    });
  }
}

async function selectSession(id) {
  state.activeSession = id;
  state.messages = await window.pts.getMessages(id);
  renderSessionList();
  renderMessages();
}

async function createSession() {
  const sess = await window.pts.createSession('New Chat', state.activeModel);
  state.sessions.unshift(sess);
  await selectSession(sess.id);
}

async function deleteSession(id) {
  await window.pts.deleteSession(id);
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.activeSession === id) {
    state.activeSession = state.sessions[0]?.id || null;
    state.messages = state.activeSession ? await window.pts.getMessages(state.activeSession) : [];
  }
  renderSessionList();
  renderMessages();
}

$('btn-new-session').addEventListener('click', createSession);

// ── Messages ───────────────────────────────────────────────────
function renderMessages() {
  const el = $('messages');
  if (!state.activeSession) {
    el.innerHTML = `<div class="empty-state" style="margin:auto"><div class="empty-icon">🤖</div>Start a new session to chat with Jarvis</div>`;
    return;
  }
  if (!state.messages.length) {
    el.innerHTML = `<div class="empty-state" style="margin:auto"><div class="empty-icon">✨</div>Good evening, Sir. How may I assist you today?</div>`;
    return;
  }
  el.innerHTML = state.messages.map(m => renderMsg(m)).join('');
  el.scrollTop = el.scrollHeight;
}

function renderMsg(m) {
  const initials = m.role === 'assistant' ? 'J' : 'U';
  return `<div class="msg ${m.role}">
    <div class="msg-avatar">${initials}</div>
    <div class="msg-bubble">${formatContent(m.content)}</div>
  </div>`;
}

function formatContent(text) {
  // Simple markdown-lite: code blocks, inline code, bold, newlines
  return text
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function appendTypingIndicator() {
  const el = $('messages');
  const div = document.createElement('div');
  div.className = 'msg assistant'; div.id = 'typing-msg';
  div.innerHTML = `<div class="msg-avatar">J</div>
    <div class="msg-bubble"><div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div></div>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function removeTypingIndicator() {
  const el = $('typing-msg');
  if (el) el.remove();
}

// ── Chat Input ─────────────────────────────────────────────────
function bindChatInput() {
  const input = $('chat-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });
  $('btn-send').addEventListener('click', sendMessage);
  $('btn-stop').addEventListener('click', () => {
    if (state.streaming) window.pts.stopStream();
  });
}

async function sendMessage() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || state.streaming) return;

  if (!state.activeSession) await createSession();

  input.value = ''; input.style.height = 'auto';

  const userMsg = await window.pts.addMessage(state.activeSession, 'user', text);
  state.messages.push(userMsg);
  renderMessages();
  appendTypingIndicator();

  state.streaming = true;
  $('btn-send').classList.add('hidden');
  $('btn-stop').classList.remove('hidden');
  const streamId = `s_${Date.now()}`;
  let fullText = '';

  const offChunk = window.pts.onStreamChunk(streamId, (chunk) => {
    fullText += chunk;
    const typingEl = $('typing-msg');
    if (typingEl) {
      typingEl.querySelector('.msg-bubble').innerHTML = formatContent(fullText);
      $('messages').scrollTop = $('messages').scrollHeight;
    }
  });

  window.pts.onStreamDone(streamId, async (full) => {
    offChunk();
    removeTypingIndicator();
    state.streaming = false;
    $('btn-send').classList.remove('hidden');
    $('btn-stop').classList.add('hidden');

    const result = await window.pts.executeAICommands(full, state.activeTicketId);
    const displayText = result.cleanText || full;

    const aiMsg = await window.pts.addMessage(state.activeSession, 'assistant', displayText);
    state.messages.push(aiMsg);

    // Auto-title session after first exchange
    if (state.messages.length === 2) {
      const short = text.slice(0, 40);
      await window.pts.updateSessionTitle(state.activeSession, short);
      state.sessions = await window.pts.getSessions();
      renderSessionList();
    }

    renderMessages();
    if (result.log.length) {
      await loadTickets();
      for (const entry of result.log) {
        if (entry.type === 'load_ticket' && entry.status === 'ok') {
          openTicketDetail(entry.id);
        } else if (entry.type === 'close_ticket' && entry.status === 'ok') {
          state.activeTicketId = null;
          activeMSpaceFile = null;
          await renderMSpace();
        }
      }
    }
    if (state.ttsEnabled) speak(displayText);
  });

  window.pts.onStreamError(streamId, (err) => {
    offChunk();
    removeTypingIndicator();
    state.streaming = false;
    $('btn-send').classList.remove('hidden');
    $('btn-stop').classList.add('hidden');
    appendErrorMsg(`Jarvis offline: ${err}`);
  });

  await window.pts.chatStream(
    state.activeModel, 
    state.messages.map(m => ({ role: m.role, content: m.content })), 
    streamId,
    state.activeTicketId
  );
}

function appendErrorMsg(text) {
  const el = $('messages');
  el.insertAdjacentHTML('beforeend', `<div class="msg assistant"><div class="msg-avatar">J</div><div class="msg-bubble" style="color:var(--red)">${escHtml(text)}</div></div>`);
  el.scrollTop = el.scrollHeight;
}

// ── TTS ────────────────────────────────────────────────────────
function speak(text) {
  if (!state.ttsEnabled) return;
  const clean = text.replace(/[#*`>_~]/g, '').slice(0, 500);
  if (window.pts && window.pts.speak) {
    window.pts.speak(clean, {
      rate: state.ttsRate,
      pitch: state.ttsPitch,
      voiceType: state.ttsVoiceType
    });
  } else if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(clean);
    utt.rate = state.ttsRate;
    utt.pitch = state.ttsPitch;
    window.speechSynthesis.speak(utt);
  }
}

// ── Tickets ────────────────────────────────────────────────────
async function loadTickets() {
  state.tickets = await window.pts.getTickets();
  renderTickets();
}

function renderTickets() {
  const query = (state.ticketSearchQuery || '').toLowerCase().trim();

  ['backlog', 'in_progress', 'done'].forEach(status => {
    let cards = state.tickets.filter(t => t.status === status);
    
    if (query) {
      cards = cards.filter(t => 
        t.title.toLowerCase().includes(query) || 
        (t.description && t.description.toLowerCase().includes(query)) ||
        String(t.id).includes(query)
      );
    }

    const totalCount = cards.length;
    const limit = state.columnLimits[status] || 10;
    const visibleCards = cards.slice(0, limit);

    let html = visibleCards.length
      ? visibleCards.map(t => ticketCard(t)).join('')
      : `<div class="empty-state">No tickets</div>`;

    if (totalCount > limit) {
      html += `<button class="btn-load-more-tickets" data-status="${status}" style="width: 100%; margin-top: 8px; padding: 8px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text-faint); font-size: 11px; cursor: pointer; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; transition: background 0.15s, color 0.15s;">+ Load More (${totalCount - limit} left)</button>`;
    }

    $(`col-${status}`).innerHTML = html;
    $(`count-${status}`).textContent = totalCount;
  });

  document.querySelectorAll('.ticket-card').forEach(card => {
    card.addEventListener('click', () => openTicketDetail(parseInt(card.dataset.id)));
  });

  document.querySelectorAll('.btn-load-more-tickets').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      state.columnLimits[status] = (state.columnLimits[status] || 10) + 15;
      renderTickets();
    });
  });
}

function ticketCard(t) {
  return `<div class="ticket-card" data-id="${t.id}">
    <div class="ticket-card-title">${escHtml(t.title)}</div>
    <div class="ticket-card-meta">
      <span class="ticket-id">#${t.id}</span>
      <span class="priority-badge ${t.priority}">${t.priority}</span>
      <span class="points-badge" style="background: var(--bg3); border: 1px solid var(--border-strong); color: var(--cyan); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; font-family: var(--mono); margin-left: 6px;">${t.score || 0} pts</span>
    </div>
  </div>`;
}

function bindTicketActions() {
  $('btn-new-ticket').addEventListener('click', () => openModal('modal-ticket'));

  $('ticket-search').addEventListener('input', (e) => {
    state.ticketSearchQuery = e.target.value;
    renderTickets();
  });

  $('btn-save-ticket').addEventListener('click', async () => {
    const title = $('ticket-title-input').value.trim();
    if (!title) return;
    await window.pts.createTicket(title, $('ticket-desc-input').value, $('ticket-priority-input').value);
    closeModal('modal-ticket');
    $('ticket-title-input').value = ''; $('ticket-desc-input').value = '';
    await loadTickets();
  });

  // Detail modal save
  $('btn-update-ticket').addEventListener('click', async () => {
    const id = state._editTicketId;
    await window.pts.updateTicket(id, {
      description: $('detail-description').value,
      status: $('detail-status').value,
      priority: $('detail-priority').value,
    });
    closeModal('modal-ticket-detail');
    await loadTickets();
  });

  $('btn-delete-ticket').addEventListener('click', async () => {
    if (!confirm('Delete this ticket?')) return;
    await window.pts.deleteTicket(state._editTicketId);
    closeModal('modal-ticket-detail');
    await loadTickets();
  });

  $('btn-add-note').addEventListener('click', async () => {
    const content = $('detail-note-input').value.trim();
    if (!content) return;
    await window.pts.addTicketNote(state._editTicketId, content, 'user');
    $('detail-note-input').value = '';
    await renderTicketNotes(state._editTicketId);
  });
}

async function openTicketDetail(id) {
  state._editTicketId = id;
  state.activeTicketId = id;
  openTicketDescription();
  switchView('mspace');
}

async function renderTicketNotes(ticketId) {
  const notes = await window.pts.getTicketNotes(ticketId);
  const el = $('detail-notes-list');
  el.innerHTML = notes.length
    ? notes.map(n => `<div class="note-item"><div class="note-meta">${n.author} · ${new Date(n.created_at).toLocaleString()}</div><div class="note-body">${escHtml(n.content)}</div></div>`).join('')
    : `<div class="empty-state" style="padding:12px">No notes yet</div>`;
}

// ── Files ──────────────────────────────────────────────────────
async function loadFileTree() {
  const res = await window.pts.fsList('');
  state.fileTree = res.ok ? res.tree : [];
  renderFileTree();
}

function renderFileTree() {
  const el = $('file-tree');
  if (!state.fileTree.length) {
    el.innerHTML = `<div class="empty-state">Empty workspace</div>`;
    return;
  }
  el.innerHTML = buildTreeHTML(state.fileTree, 0);
  el.querySelectorAll('.tree-item[data-type=file]').forEach(item => {
    item.addEventListener('click', () => openFile(item.dataset.abspath, item.dataset.name));
  });
  el.querySelectorAll('.tree-item[data-type=dir]').forEach(item => {
    item.addEventListener('click', () => item.nextElementSibling?.classList.toggle('hidden'));
  });
}

function buildTreeHTML(nodes, depth) {
  return nodes.map(n => {
    const pad = `padding-left:${8 + depth * 12}px`;
    if (n.type === 'dir') {
      const children = n.children?.length ? `<div>${buildTreeHTML(n.children, depth + 1)}</div>` : '';
      return `<div class="tree-item tree-dir" data-type="dir" style="${pad}"><span class="tree-icon">📁</span>${escHtml(n.name)}</div>${children}`;
    }
    const ext = n.name.split('.').pop();
    const icon = { js:'📄', ts:'📄', py:'🐍', md:'📝', json:'🔧', html:'🌐', css:'🎨' }[ext] || '📄';
    return `<div class="tree-item" data-type="file" data-abspath="" data-name="${escHtml(n.name)}" data-relpath="${escHtml(n.path)}" style="${pad}"><span class="tree-icon">${icon}</span>${escHtml(n.name)}</div>`;
  }).join('');
}

async function openFile(absPath, name) {
  // Resolve abs path via relpath
  const relPath = event?.currentTarget?.dataset.relpath;
  if (!relPath) return;
  const ws = await window.pts.getWorkspace();
  const abs = ws + '/' + relPath;

  const res = await window.pts.fsRead(abs);
  if (!res.ok) return;
  state.openFile = { abs, name: relPath.split('/').pop() };
  $('file-editor-name').textContent = state.openFile.name;
  $('file-editor').value = res.content;
  $('file-editor').disabled = false;
  $('btn-save-file').disabled = false;
  state.fileEditorDirty = false;

  updateLineNumbers($('file-editor'), $('file-code-line-numbers'));

  document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
  event?.currentTarget?.classList.add('active');

  $('file-editor').oninput = () => {
    state.fileEditorDirty = true;
    updateLineNumbers($('file-editor'), $('file-code-line-numbers'));
  };
}

function bindFileActions() {
  $('file-editor').addEventListener('scroll', () => {
    $('file-code-line-numbers').scrollTop = $('file-editor').scrollTop;
  });

  $('btn-save-file').addEventListener('click', async () => {
    if (!state.openFile) return;
    await window.pts.fsWrite(state.openFile.abs, $('file-editor').value);
    state.fileEditorDirty = false;
  });

  $('btn-open-workspace').addEventListener('click', async () => {
    const res = await window.pts.openFolderDialog();
    if (res.ok) { await loadFileTree(); }
  });

  $('btn-new-file').addEventListener('click', async () => {
    const name = prompt('File name (e.g. notes.md):');
    if (!name) return;
    await window.pts.fsWriteRel(name, '');
    await loadFileTree();
  });
}

// ── Modals ─────────────────────────────────────────────────────
function bindModals() {
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay.id); });
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => e.stopPropagation());
    m.addEventListener('mousedown', (e) => e.stopPropagation());
  });
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { if (id) $(id).classList.add('hidden'); }

// ── Util ───────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── MSpace ───────────────────────────────────────────────────────
let activeMSpaceFile = null;

function bindMSpace() {
  document.querySelectorAll('#mspace-toolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      document.execCommand(cmd, false, val);
      $('mspace-wysiwyg').focus();
    });
  });

  let saveTimer;
  $('mspace-wysiwyg').addEventListener('input', () => {
    if (!state.activeTicketId || activeMSpaceFile) return;
    clearTimeout(saveTimer);
    $('mspace-editor-status').textContent = 'Saving...';
    saveTimer = setTimeout(async () => {
      const html = $('mspace-wysiwyg').innerHTML;
      await window.pts.updateTicket(state.activeTicketId, { description: html });
      const t = state.tickets.find(x => x.id === state.activeTicketId);
      if (t) t.description = html;
      $('mspace-editor-status').textContent = 'Saved';
      setTimeout(() => {
        if ($('mspace-editor-status').textContent === 'Saved') {
          $('mspace-editor-status').textContent = '';
        }
      }, 1500);
    }, 1000);
  });

  $('mspace-code-editor').addEventListener('input', () => {
    updateLineNumbers($('mspace-code-editor'), $('mspace-code-line-numbers'));
  });

  $('mspace-code-editor').addEventListener('scroll', () => {
    $('mspace-code-line-numbers').scrollTop = $('mspace-code-editor').scrollTop;
  });

  $('btn-mspace-save').addEventListener('click', async () => {
    if (activeMSpaceFile) {
      const res = await window.pts.fsWrite(activeMSpaceFile, $('mspace-code-editor').value);
      if (res && res.ok) {
        $('btn-mspace-save').style.background = 'var(--green)';
        setTimeout(() => $('btn-mspace-save').style.background = '', 1000);
        if (state.activeTicketId) {
          await window.pts.recordInteraction(state.activeTicketId);
          await loadTickets();
        }
      } else {
        alert('Failed to save file: ' + (res ? res.error : 'Unknown error'));
      }
    }
  });

  $('btn-mspace-toggle-done').addEventListener('click', async () => {
    if (!state.activeTicketId) return;
    const t = state.tickets.find(x => x.id === state.activeTicketId);
    if (!t) return;
    const nextStatus = t.status === 'done' ? 'in_progress' : 'done';
    await window.pts.updateTicket(state.activeTicketId, { status: nextStatus });
    await loadTickets();
    await renderMSpace();
  });

  $('btn-mspace-new-file').addEventListener('click', async () => {
    if (!state.activeTicketId) return alert('Select a ticket first');
    const t = state.tickets.find(x => x.id === state.activeTicketId);
    if (!t || !t.folder_path) return alert('Ticket has no folder');
    $('file-name-input').value = '';
    openModal('modal-file');
    setTimeout(() => {
      $('file-name-input').focus();
      $('file-name-input').select();
    }, 100);
  });

  const performCreateFile = async () => {
    const name = $('file-name-input').value.trim();
    if (!name) return;

    // File Extension Validation Allowlist
    const allowedExts = ['.txt', '.md', '.json', '.html', '.css', '.js', '.ts', '.py', '.sh', '.yaml', '.yml', '.sql', '.conf', '.ini', '.csv', '.xml'];
    const dotIdx = name.lastIndexOf('.');
    const ext = dotIdx !== -1 ? name.slice(dotIdx).toLowerCase() : '';
    
    if (dotIdx === -1 || !allowedExts.includes(ext)) {
      alert('Forbidden Extension! You can only create files of type:\n' + allowedExts.join(', '));
      return;
    }

    const t = state.tickets.find(x => x.id === state.activeTicketId);
    if (!t || !t.folder_path) return;
    const rel = `${t.folder_path.split(/[\\/]/).pop()}/${name}`; 
    const res = await window.pts.fsWriteRel(rel, '');
    if (res.ok) {
      await window.pts.recordInteraction(state.activeTicketId);
      await loadTickets();
      await renderMSpace();
      openMSpaceFile(res.absPath, name);
      closeModal('modal-file');
    } else {
      alert('Error: ' + res.error);
    }
  };

  $('btn-modal-create-file').addEventListener('click', performCreateFile);
  
  // Programmatically reinforce focus to bypass any Chromium focus theft bugs
  const forceFocusInput = (e) => {
    e.stopPropagation();
    $('file-name-input').focus();
  };
  $('file-name-input').addEventListener('click', forceFocusInput);
  $('file-name-input').addEventListener('mousedown', forceFocusInput);
  
  $('file-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performCreateFile();
    }
  });
}

async function renderMSpace() {
  const titleEl = $('mspace-editor-title');
  const toggleDoneBtn = $('btn-mspace-toggle-done');
  
  if (!state.activeTicketId) {
    titleEl.textContent = 'No Ticket Selected';
    $('mspace-file-tree').innerHTML = '<div class="empty-state">Load a ticket to view files</div>';
    $('mspace-wysiwyg').innerHTML = '';
    toggleDoneBtn.style.display = 'none';
    return;
  }
  const t = state.tickets.find(x => x.id === state.activeTicketId);
  if (!t) return;

  toggleDoneBtn.style.display = '';
  if (t.status === 'done') {
    toggleDoneBtn.textContent = '✓ Completed';
    toggleDoneBtn.style.background = 'var(--green-dim)';
    toggleDoneBtn.style.color = 'var(--green)';
    toggleDoneBtn.style.borderColor = 'var(--green)';
  } else {
    toggleDoneBtn.textContent = 'Mark Done';
    toggleDoneBtn.style.background = 'var(--bg2)';
    toggleDoneBtn.style.color = 'var(--text-dim)';
    toggleDoneBtn.style.borderColor = 'var(--border-strong)';
  }

  if (!activeMSpaceFile) {
    titleEl.textContent = `Ticket #${t.id}: ${t.title}`;
    $('mspace-code-wrapper').style.display = 'none';
    $('mspace-wysiwyg').style.display = 'block';
    $('mspace-wysiwyg').innerHTML = t.description || '';
    $('btn-mspace-save').style.display = 'none';
    document.querySelectorAll('#mspace-toolbar button[data-cmd]').forEach(b => b.style.display = '');
  }

  if (t.folder_path && state.settings.workspace_path) {
    let relFolder = t.folder_path;
    if (relFolder.startsWith(state.settings.workspace_path)) {
      relFolder = relFolder.replace(state.settings.workspace_path, '').replace(/^[\\/]+/, '');
    }
    const res = await window.pts.fsList(relFolder);
    if (res.ok) {
      const html = buildTreeHTML(res.tree, 0);
      $('mspace-file-tree').innerHTML = html || '<div class="empty-state" style="padding:10px">No files</div>';
      $('mspace-file-tree').querySelectorAll('.tree-item[data-type=file]').forEach(el => {
        el.addEventListener('click', async () => {
           const ws = await window.pts.getWorkspace();
           const abs = ws + '/' + el.dataset.relpath;
           openMSpaceFile(abs, el.dataset.name);
        });
      });
      $('mspace-file-tree').querySelectorAll('.tree-item[data-type=dir]').forEach(el => {
        el.addEventListener('click', () => el.nextElementSibling?.classList.toggle('hidden'));
      });
    } else {
      $('mspace-file-tree').innerHTML = `<div class="empty-state">${res.error}</div>`;
    }
  } else {
    $('mspace-file-tree').innerHTML = '<div class="empty-state">Ticket has no folder setup.</div>';
  }
}

function openTicketDescription() {
  activeMSpaceFile = null;
  const t = state.tickets.find(x => x.id === state.activeTicketId);
  if (!t) return;
  $('mspace-editor-title').textContent = `Ticket #${t.id}: ${t.title}`;
  $('mspace-editor-title').style.cursor = 'default';
  $('mspace-editor-title').onclick = null;
  $('mspace-code-wrapper').style.display = 'none';
  $('mspace-wysiwyg').style.display = 'block';
  $('btn-mspace-save').style.display = 'none';
  document.querySelectorAll('#mspace-toolbar button[data-cmd]').forEach(b => b.style.display = '');
}

async function openMSpaceFile(absPath, name) {
  const res = await window.pts.fsRead(absPath);
  if (!res.ok) return alert('Failed to read file');
  activeMSpaceFile = absPath;
  $('mspace-editor-title').textContent = `Editing: ${name} (Click here to return to ticket description)`;
  $('mspace-editor-title').style.cursor = 'pointer';
  $('mspace-editor-title').onclick = openTicketDescription;
  
  $('mspace-wysiwyg').style.display = 'none';
  $('mspace-code-wrapper').style.display = 'flex';
  $('mspace-code-editor').value = res.content;
  updateLineNumbers($('mspace-code-editor'), $('mspace-code-line-numbers'));
  $('btn-mspace-save').style.display = '';
  document.querySelectorAll('#mspace-toolbar button[data-cmd]').forEach(b => b.style.display = 'none');
}

// ── Voice Mode ──────────────────────────────────────────────────
let voiceActive = false;
let currentUtterance = null;

function bindVoiceMode() {
  const btnToggle1 = $('btn-voice-toggle');
  const btnListen1 = $('btn-voice-listen');
  const btnRespond1 = $('btn-voice-respond');
  const btnStopSpeech1 = $('btn-voice-stop-speech');
  const orb1 = $('voice-orb');
  const badge1 = $('voice-status-badge');
  const transcriptBox1 = $('voice-transcript-box');
  const activityBox1 = $('voice-activity-box');

  const btnToggle2 = $('btn-chat-voice-toggle');
  const btnListen2 = $('btn-chat-voice-listen');
  const btnRespond2 = $('btn-chat-voice-respond');
  const btnStopSpeech2 = $('btn-chat-voice-stop-speech');
  const orb2 = $('chat-voice-orb');
  const badge2 = $('chat-voice-status-badge');
  const transcriptBox2 = $('chat-voice-transcript-box');
  const activityBox2 = $('chat-voice-activity-box');

  const micLevelBar = $('mic-level-bar') || document.createElement('span');

  // Hardcode the voiceSensitivity to an ultra-responsive, transparent value
  state.voiceSensitivity = 0.005;

  // WAV/PCM recording variables
  let leftChannel = [];
  let recordingLength = 0;
  let isRecording = false;
  let recorderNode = null;

  let audioCtx = null;
  let analyser = null;
  let micSource = null;
  let audioStream = null;

  const updateOrbState = (status) => {
    [orb1, orb2].filter(Boolean).forEach(orb => orb.className = status);
    [badge1, badge2].filter(Boolean).forEach(badge => {
      badge.className = `status-${status}`;
      if (status === 'idle') {
        badge.textContent = 'System Idle';
      } else if (status === 'listening') {
        badge.textContent = 'JARVIS is listening...';
      } else if (status === 'thinking') {
        badge.textContent = 'JARVIS is thinking...';
      } else if (status === 'speaking') {
        badge.textContent = 'JARVIS is speaking...';
      }
    });

    const show = (el) => { if (el) el.style.display = 'inline-flex'; };
    const hide = (el) => { if (el) el.style.display = 'none'; };

    if (status === 'idle') {
      if (voiceActive) {
        show(btnListen1); show(btnListen2);
        hide(btnRespond1); hide(btnRespond2);
        hide(btnStopSpeech1); hide(btnStopSpeech2);
      } else {
        hide(btnListen1); hide(btnListen2);
        hide(btnRespond1); hide(btnRespond2);
        hide(btnStopSpeech1); hide(btnStopSpeech2);
      }
    } else if (status === 'listening') {
      hide(btnListen1); hide(btnListen2);
      show(btnRespond1); show(btnRespond2);
      hide(btnStopSpeech1); hide(btnStopSpeech2);
    } else if (status === 'thinking') {
      hide(btnListen1); hide(btnListen2);
      hide(btnRespond1); hide(btnRespond2);
      hide(btnStopSpeech1); hide(btnStopSpeech2);
    } else if (status === 'speaking') {
      hide(btnListen1); hide(btnListen2);
      hide(btnRespond1); hide(btnRespond2);
      show(btnStopSpeech1); show(btnStopSpeech2);
    }
  };

  // Pure JS WAV Mono 16-bit Encoder
  function bufferToWav(buffer, sampleRate) {
    const bufferLen = buffer.length;
    const wavBuffer = new ArrayBuffer(44 + bufferLen * 2);
    const view = new DataView(wavBuffer);

    const writeString = (v, offset, string) => {
      for (let i = 0; i < string.length; i++) {
        v.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + bufferLen * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw PCM) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, bufferLen * 2, true);

    // Write PCM audio samples
    let offset = 44;
    for (let i = 0; i < bufferLen; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, buffer[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return wavBuffer;
  }

  const startPCMRecording = () => {
    if (!voiceActive) return;
    leftChannel = [];
    recordingLength = 0;
    isRecording = true;
    updateOrbState('listening');
    console.log("[Voice Mode] Manual recording started.");
  };

  const stopPCMRecording = async () => {
    isRecording = false;
    updateOrbState('thinking');
    [badge1, badge2].filter(Boolean).forEach(b => b.textContent = 'transcribing your voice Sir...');

    if (recordingLength === 0) {
      console.log("[Voice Mode] Silent/empty buffer discarded.");
      updateOrbState('idle');
      return;
    }

    const flattened = new Float32Array(recordingLength);
    let offset = 0;
    for (let i = 0; i < leftChannel.length; i++) {
      flattened.set(leftChannel[i], offset);
      offset += leftChannel[i].length;
    }
    leftChannel = []; // Reset
    recordingLength = 0;

    const wavBuffer = bufferToWav(flattened, audioCtx.sampleRate);

    try {
      console.log(`[Voice Mode] Sending WAV buffer (${wavBuffer.byteLength} bytes) to Groq Whisper...`);
      const res = await window.pts.transcribe(wavBuffer);

      console.log(`[Whisper STT] Raw API response:`, res);
      if (!res.ok) {
        console.error("[Whisper STT] Failed:", res.error);
        addTranscript('ai', `Vocal sync failed: ${res.error}`);
        await speakText(`Vocal sync failed: ${res.error}`);
        updateOrbState('idle');
        return;
      }

      if (res.text && res.text.trim()) {
        const transcribed = res.text.trim();
        console.log(`[Whisper STT] Transcribed successfully: "${transcribed}"`);

        addTranscript('user', transcribed);
        updateOrbState('thinking');
        [badge1, badge2].filter(Boolean).forEach(b => b.textContent = 'JARVIS is processing...');

        if (!state.activeSession) {
          const sess = await window.pts.createSession('Voice Session', state.activeModel);
          state.activeSession = sess.id;
          state.sessions = await window.pts.getSessions();
          renderSessionList();
        }

        const userMsg = await window.pts.addMessage(state.activeSession, 'user', transcribed);
        state.messages.push(userMsg);

        const history = await window.pts.getMessages(state.activeSession);
        const response = await window.pts.chat(state.activeModel, history, state.activeTicketId);

        const result = await window.pts.executeAICommands(response, state.activeTicketId);
        const cleanText = result.cleanText || response;

        if (result.log.length > 0) {
          await loadTickets();
          await renderMSpace();
          for (const entry of result.log) {
            if (entry.status === 'ok') {
              let detail = '';
              if (entry.type === 'write_file') detail = entry.path.split(/[\\/]/).pop();
              if (entry.type === 'add_ticket') detail = entry.ticket.title;
              if (entry.type === 'update_ticket') detail = entry.id;
              if (entry.type === 'load_ticket') {
                detail = entry.id;
                openTicketDetail(entry.id);
              }
              if (entry.type === 'close_ticket') {
                detail = 'closed';
                state.activeTicketId = null;
                activeMSpaceFile = null;
                await renderMSpace();
              }
              logActivity(entry.type, detail, true);
            } else {
              logActivity(entry.type, entry.error, false);
            }
          }
        }

        const webMatch = /\[WEB_SEARCH:([^\]]+)\]/.exec(response);
        const fileMatch = /\[FILE_SEARCH:([^\]]+)\]/.exec(response);
        if (webMatch) logActivity('web_search', webMatch[1].trim(), true);
        if (fileMatch) logActivity('file_search', fileMatch[1].trim(), true);

        const aiMsg = await window.pts.addMessage(state.activeSession, 'assistant', cleanText);
        state.messages.push(aiMsg);
        renderMessages();

        addTranscript('ai', cleanText);
        await speakText(cleanText);

      } else {
        console.log("[Whisper STT] Discarded silent transcript result.");
        updateOrbState('idle');
      }
    } catch (err) {
      console.error("Speech transcription loop error:", err);
      addTranscript('ai', `Vocal sync failed Sir: ${err.message}`);
      await speakText(`Vocal sync failed Sir: ${err.message}`);
      updateOrbState('idle');
    }
  };

  const startVolumeAnalyser = () => {
    console.log("[Voice Engine] Active pipeline: ScriptProcessor manual record trigger.");
    
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        audioStream = stream;

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Explicitly resume AudioContext to guarantee live capture processing!
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        analyser = audioCtx.createAnalyser();
        micSource = audioCtx.createMediaStreamSource(stream);
        
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        micSource.connect(analyser);

        // Raw PCM recorder setup (1 mono channel)
        recorderNode = audioCtx.createScriptProcessor(4096, 1, 1);
        recorderNode.onaudioprocess = (e) => {
          if (!isRecording) return;
          const floatArray = e.inputBuffer.getChannelData(0);
          leftChannel.push(new Float32Array(floatArray));
          recordingLength += floatArray.length;
        };
        micSource.connect(recorderNode);
        recorderNode.connect(audioCtx.destination);
        
        const checkVolume = () => {
          if (!voiceActive) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normalizedVol = average / 255.0; // 0.0 to 1.0

          // Visual Feedback Level indicator
          if (normalizedVol > 0.02) {
            micLevelBar.style.background = 'var(--cyan)';
            micLevelBar.style.boxShadow = '0 0 10px var(--cyan-glow)';
          } else {
            micLevelBar.style.background = '#3a4b6e';
            micLevelBar.style.boxShadow = '0 0 0 rgba(0,212,255,0)';
          }

          // Scaled waves matching voice level only when active listening
          [orb1, orb2].filter(Boolean).forEach(currentOrb => {
            if (voiceActive && currentOrb.className === 'listening') {
              const wave1 = currentOrb.querySelector('.wave-1');
              const wave2 = currentOrb.querySelector('.wave-2');
              const wave3 = currentOrb.querySelector('.wave-3');
              const scale = 1.0 + (normalizedVol * 1.5);
              if (wave1) {
                wave1.style.transform = `scale(${scale})`;
                wave1.style.borderColor = `rgba(0, 212, 255, ${0.1 + normalizedVol * 0.7})`;
              }
              if (wave2) {
                wave2.style.transform = `scale(${scale * 0.8})`;
                wave2.style.borderColor = `rgba(167, 139, 250, ${0.1 + normalizedVol * 0.7})`;
              }
              if (wave3) {
                wave3.style.transform = `scale(${scale * 0.6})`;
                wave3.style.borderColor = `rgba(255, 255, 255, ${0.05 + normalizedVol * 0.3})`;
              }
            } else {
              // Restore standard non-scaled waves
              const waves = currentOrb.querySelectorAll('.orb-wave');
              waves.forEach(w => {
                w.style.transform = '';
                w.style.borderColor = '';
              });
            }
          });

          requestAnimationFrame(checkVolume);
        };
        checkVolume();
      })
      .catch(err => {
        console.error("Audio Context initialization failed:", err);
        alert(`Microphone sync failed Sir: ${err.message}.\n\nPlease ensure your microphone is plugged in, active, and that you have granted permission.`);
      });
  };

  const stopVolumeAnalyser = () => {
    if (audioCtx) {
      if (recorderNode) {
        try { recorderNode.disconnect(); } catch {}
        recorderNode = null;
      }
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      audioStream = null;
    }
    isRecording = false;
  };

  const triggerListen = () => {
    const currentOrbs = [orb1, orb2].filter(Boolean);
    if (voiceActive && currentOrbs.some(o => o.className === 'idle' || o.className === 'speaking')) {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      startPCMRecording();
    }
  };

  const triggerRespond = () => {
    const currentOrbs = [orb1, orb2].filter(Boolean);
    if (voiceActive && currentOrbs.some(o => o.className === 'listening')) {
      stopPCMRecording();
    }
  };

  const triggerStopSpeech = () => {
    if (window.pts && window.pts.stopSpeech) {
      window.pts.stopSpeech();
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    updateOrbState('idle');
  };

  const addTranscript = (sender, text) => {
    const isUser = sender === 'user';
    const cls = isUser ? 'voice-transcript-user' : 'voice-transcript-ai';
    const label = isUser ? 'Sir' : 'JARVIS';
    
    [transcriptBox1, transcriptBox2].filter(Boolean).forEach(box => {
      const ph = box.querySelector('.voice-placeholder');
      if (ph) ph.remove();

      const div = document.createElement('div');
      div.className = cls;
      div.innerHTML = `<strong>${label}:</strong> ${escHtml(text)}`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    });
  };

  const logActivity = (type, details, ok = true) => {
    [activityBox1, activityBox2].filter(Boolean).forEach(box => {
      const ph = box.querySelector('.voice-placeholder');
      if (ph) ph.remove();

      const div = document.createElement('div');
      div.className = `voice-action-item ${ok ? '' : 'error'}`;
      let icon = ok ? '✓' : '✕';
      let text = '';
      if (type === 'write_file') text = `Wrote file: ${details}`;
      if (type === 'add_ticket') text = `Added ticket: "${details}"`;
      if (type === 'update_ticket') text = `Updated ticket status to: ${details}`;
      if (type === 'load_ticket') text = `Focused ticket #${details}`;
      if (type === 'close_ticket') text = `Closed active ticket`;
      if (type === 'web_search') text = `Searched web: "${details}"`;
      if (type === 'file_search') text = `Searched code: "${details}"`;

      div.innerHTML = `<span>${icon}</span> <span>${escHtml(text)}</span>`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    });
  };

  const speakText = (text) => {
    return new Promise((resolve) => {
      let clean = text
        .replace(/\[(?:CREATE_FILE|WRITE_FILE):[^\]]+\][\s\S]*?\[\/WRITE_FILE\]/g, '')
        .replace(/\[ADD_TICKET:[^\]]+\]/g, '')
        .replace(/\[UPDATE_TICKET:[^\]]+\]/g, '')
        .replace(/\[LOAD_TICKET:[^\]]+\]/g, '')
        .replace(/\[CLOSE_TICKET\]/g, '')
        .replace(/\[WEB_SEARCH:[^\]]+\]/g, '')
        .replace(/\[FILE_SEARCH:[^\]]+\]/g, '')
        .replace(/\*+/g, '')
        .trim();

      if (!clean) return resolve();

      // Check if native spd-say tool is available (Linux super-reliability)
      if (window.pts && window.pts.speak) {
        updateOrbState('speaking');
        window.pts.speak(clean, {
          rate: state.ttsRate,
          pitch: state.ttsPitch,
          voiceType: state.ttsVoiceType
        }).then(() => {
          // Dynamic visual pulsation period matching speech length
          const speakDuration = Math.max(1500, clean.split(/\s+/).length * 380);
          setTimeout(() => {
            const currentOrbs = [orb1, orb2].filter(Boolean);
            if (currentOrbs.some(o => o.className === 'speaking')) {
              updateOrbState('idle');
            }
            resolve();
          }, speakDuration);
        });
        return;
      }

      // Standard HTML5 Speech Synthesis Fallback (Win/Mac)
      if (!window.speechSynthesis) return resolve();
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(clean);
      currentUtterance = utter;
      
      utter.pitch = state.ttsPitch !== undefined ? state.ttsPitch : 1.1;
      utter.rate = state.ttsRate !== undefined ? state.ttsRate : 0.95;

      utter.onstart = () => {
        updateOrbState('speaking');
      };

      utter.onend = () => {
        currentUtterance = null;
        updateOrbState('idle');
        resolve();
      };

      utter.onerror = () => {
        currentUtterance = null;
        updateOrbState('idle');
        resolve();
      };

      window.speechSynthesis.speak(utter);
    });
  };

  const startVoiceMode = () => {
    voiceActive = true;
    [btnToggle1, btnToggle2].filter(Boolean).forEach(btn => {
      btn.className = 'btn-voice-stop';
      const sp = btn.querySelector('span');
      if (sp) sp.textContent = 'Disconnect JARVIS';
    });
    
    updateOrbState('speaking');
    
    speakText("Hello Sir. JARVIS vocal synchronization is online. I am ready to assist you.")
      .then(() => {
        if (!voiceActive) return;
        return startVolumeAnalyser();
      })
      .then(() => {
        if (!voiceActive) return;
        updateOrbState('idle');
      })
      .catch(err => {
        console.error("Initialization failed:", err);
      });
  };

  const stopVoiceMode = () => {
    voiceActive = false;
    [btnToggle1, btnToggle2].filter(Boolean).forEach(btn => {
      btn.className = 'btn-voice-start';
      const sp = btn.querySelector('span');
      if (sp) sp.textContent = 'Initialize JARVIS';
    });
    
    updateOrbState('idle');
    stopVolumeAnalyser();
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  [btnToggle1, btnToggle2].filter(Boolean).forEach(btn => {
    btn.addEventListener('click', () => {
      if (voiceActive) stopVoiceMode();
      else startVoiceMode();
    });
  });

  [btnListen1, btnListen2].filter(Boolean).forEach(btn => btn.addEventListener('click', triggerListen));
  [btnRespond1, btnRespond2].filter(Boolean).forEach(btn => btn.addEventListener('click', triggerRespond));
  [btnStopSpeech1, btnStopSpeech2].filter(Boolean).forEach(btn => btn.addEventListener('click', triggerStopSpeech));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceActive) {
      stopVoiceMode();
      speakText("JARVIS standing down Sir.");
      return;
    }

    if (e.altKey && voiceActive) {
      const code = e.code;
      if (code === 'KeyL') {
        e.preventDefault();
        triggerListen();
      }
      if (code === 'KeyR') {
        e.preventDefault();
        triggerRespond();
      }
      if (code === 'KeyS') {
        e.preventDefault();
        triggerStopSpeech();
      }
    }
  });

  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      switchChatMode(mode);
    });
  });
}

function switchChatMode(mode) {
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  
  if (mode === 'chat') {
    $('chat-text-container').style.display = 'flex';
    $('chat-text-container').classList.remove('hidden');
    $('chat-voice-container').style.display = 'none';
    $('chat-voice-container').classList.add('hidden');
  } else {
    $('chat-text-container').style.display = 'none';
    $('chat-text-container').classList.add('hidden');
    $('chat-voice-container').style.display = 'flex';
    $('chat-voice-container').classList.remove('hidden');
  }
}

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
