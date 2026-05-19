const fs = require('fs');
const path = require('path');

let workspaceRoot = '';

function setWorkspace(root) {
  workspaceRoot = root;
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
}

function getWorkspace() { return workspaceRoot; }

function resolvePath(relativePath) {
  // Always resolve relative to workspace
  const resolved = path.resolve(workspaceRoot, relativePath);
  // Security: ensure path is within workspace
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error('Path escapes workspace boundary');
  }
  return resolved;
}

function createTicketFolder(ticketId, ticketTitle) {
  const safe = ticketTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
  const folderName = `ticket_${ticketId}_${safe}`;
  const folderPath = path.join(workspaceRoot, folderName);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  return folderPath;
}

function writeFile(relativePath, content) {
  const abs = resolvePath(relativePath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

function readFile(relativePath) {
  const abs = resolvePath(relativePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${relativePath}`);
  return fs.readFileSync(abs, 'utf8');
}

function deleteFile(relativePath) {
  const abs = resolvePath(relativePath);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

function renameFile(oldPath, newPath) {
  const absOld = resolvePath(oldPath);
  const absNew = resolvePath(newPath);
  fs.renameSync(absOld, absNew);
}

function listFiles(relativePath = '') {
  const abs = relativePath ? resolvePath(relativePath) : workspaceRoot;
  if (!fs.existsSync(abs)) return [];
  return buildTree(abs, workspaceRoot);
}

function buildTree(dir, root) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.map(entry => {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      return { name: entry.name, path: relPath, type: 'dir', children: buildTree(fullPath, root) };
    }
    const stat = fs.statSync(fullPath);
    return { name: entry.name, path: relPath, type: 'file', size: stat.size, modified: stat.mtime };
  });
}

function getFileContent(absolutePath) {
  if (!fs.existsSync(absolutePath)) throw new Error('File not found');
  return fs.readFileSync(absolutePath, 'utf8');
}

function saveFileContent(absolutePath, content) {
  fs.writeFileSync(absolutePath, content, 'utf8');
}

// Parse AI command blocks from a response string
function parseAICommands(text) {
  const commands = [];

  // CREATE_FILE or WRITE_FILE blocks
  const writeRegex = /\[(?:CREATE_FILE|WRITE_FILE):([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/g;
  let m;
  while ((m = writeRegex.exec(text)) !== null) {
    commands.push({ type: 'write_file', path: m[1].trim(), content: m[2] });
  }

  // ADD_TICKET
  const ticketRegex = /\[ADD_TICKET:([^|]+)\|([^\]]+)\]/g;
  while ((m = ticketRegex.exec(text)) !== null) {
    commands.push({ type: 'add_ticket', title: m[1].trim(), priority: m[2].trim() });
  }

  // UPDATE_TICKET
  const updateRegex = /\[UPDATE_TICKET:(\d+):([^\]]+)\]/g;
  while ((m = updateRegex.exec(text)) !== null) {
    commands.push({ type: 'update_ticket', id: parseInt(m[1], 10), status: m[2].trim() });
  }

  // LOAD_TICKET
  const loadRegex = /\[LOAD_TICKET:(\d+)\]/g;
  while ((m = loadRegex.exec(text)) !== null) {
    commands.push({ type: 'load_ticket', id: parseInt(m[1], 10) });
  }

  // CLOSE_TICKET
  const closeRegex = /\[CLOSE_TICKET\]/g;
  while ((m = closeRegex.exec(text)) !== null) {
    commands.push({ type: 'close_ticket' });
  }

  return commands;
}

// Strip command blocks from text for display
function cleanAIResponse(text) {
  return text
    .replace(/\[(?:CREATE_FILE|WRITE_FILE):[^\]]+\][\s\S]*?\[\/WRITE_FILE\]/g, '')
    .replace(/\[ADD_TICKET:[^\]]+\]/g, '')
    .replace(/\[UPDATE_TICKET:[^\]]+\]/g, '')
    .replace(/\[LOAD_TICKET:[^\]]+\]/g, '')
    .replace(/\[CLOSE_TICKET\]/g, '')
    .trim();
}

module.exports = {
  setWorkspace, getWorkspace, resolvePath,
  createTicketFolder,
  writeFile, readFile, deleteFile, renameFile,
  listFiles, getFileContent, saveFileContent,
  parseAICommands, cleanAIResponse,
};
