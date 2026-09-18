/**
 * Agent tools for OTK CLI: file and command access, always gated behind an
 * explicit user authorization preview (never auto-executed).
 *
 * Wire protocol (OpenTokens v2): the CLI declares its tools in the request
 * body (`tools` array) and the model invokes them inside the streamed text:
 *
 *   <toolcall>write_file<argkey>path</argkey><argvalue>a.txt</argvalue></toolcall>
 *
 * Results go back as a user message with a `[TOOL RESULT: name]` marker.
 */

import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const MAX_OUTPUT = 6_000;
const MAX_PREVIEW_ROWS = 8;

function resolvePath(p) {
  return path.resolve(process.cwd(), String(p ?? ''));
}

function truncateOutput(text) {
  const clean = String(text ?? '').replace(/\r/g, '');
  if (clean.length <= MAX_OUTPUT) return clean;
  return clean.slice(0, MAX_OUTPUT) + `\n… (truncated, ${clean.length - MAX_OUTPUT} more chars)`;
}

function head(text, rows = MAX_PREVIEW_ROWS) {
  return String(text ?? '').split('\n').slice(0, rows);
}

/** Naive line diff good enough for a confirmation preview. */
function simpleDiff(oldText, newText) {
  const oldLines = String(oldText ?? '').split('\n');
  const newLines = String(newText ?? '').split('\n');
  const removed = oldLines.filter((l) => !newLines.includes(l));
  const added = newLines.filter((l) => !oldLines.includes(l));
  const rows = [];
  for (const line of removed.slice(0, 6)) rows.push('- ' + line);
  for (const line of added.slice(0, 6)) rows.push('+ ' + line);
  if (removed.length > 6) rows.push(`… ${removed.length - 6} more removed`);
  if (added.length > 6) rows.push(`… ${added.length - 6} more added`);
  if (rows.length === 0) rows.push('(no visible changes)');
  return rows;
}

export const TOOLS = {
  write_file: {
    description: "Create or overwrite a file in the user's project",
    parameters: [
      { name: 'path', description: 'Path of the file to write', required: true },
      { name: 'content', description: 'Full file content', required: true },
    ],
    async preview(args) {
      const target = resolvePath(args.path);
      const content = String(args.content ?? '');
      const rows = [`write  ${args.path}`, `${target}`];
      try {
        const old = await fs.readFile(target, 'utf8');
        rows.push(`overwrites an existing file (${old.split('\n').length} lines)`);
        rows.push('');
        rows.push(...simpleDiff(old, content));
      } catch {
        rows.push('creates a new file');
      }
      rows.push('');
      rows.push(...head(content, 6).map((line) => '│ ' + line));
      if (content.split('\n').length > 6) rows.push('│ …');
      return rows;
    },
    async run(args) {
      const target = resolvePath(args.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(args.content ?? ''), 'utf8');
      return { ok: true, output: `OK — ${args.path} created (${String(args.content ?? '').length} bytes).` };
    },
  },

  read_file: {
    description: "Read a file's content",
    parameters: [{ name: 'path', description: 'Path of the file to read', required: true }],
    async preview(args) {
      const target = resolvePath(args.path);
      let sizeNote = '';
      try {
        const stat = await fs.stat(target);
        sizeNote = `${Math.max(1, Math.ceil(stat.size / 1024))} KB`;
        if (stat.isDirectory()) sizeNote = 'directory (will fail)';
      } catch {
        sizeNote = 'does not exist';
      }
      return [`read  ${args.path}`, `${target}`, sizeNote];
    },
    async run(args) {
      const target = resolvePath(args.path);
      const content = await fs.readFile(target, 'utf8');
      return { ok: true, output: truncateOutput(content) };
    },
  },

  edit_file: {
    description: 'Replace the first exact occurrence of `find` with `replace` in a file',
    parameters: [
      { name: 'path', description: 'Path of the file to edit', required: true },
      { name: 'find', description: 'Exact text to find', required: true },
      { name: 'replace', description: 'Replacement text', required: true },
    ],
    async preview(args) {
      const target = resolvePath(args.path);
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      let current = '';
      try {
        current = await fs.readFile(target, 'utf8');
      } catch {
        return [`edit  ${args.path}`, `${target}`, 'file does not exist — edit will fail'];
      }
      if (!current.includes(find)) {
        return [`edit  ${args.path}`, `${target}`, 'find text not present in file — edit will fail'];
      }
      const occurrences = current.split(find).length - 1;
      const rows = [
        `edit  ${args.path}`,
        `${target}`,
        occurrences > 1 ? `replaces the first of ${occurrences} occurrences` : 'replaces 1 occurrence',
        '',
      ];
      rows.push(...head(find).map((line) => '- ' + line));
      rows.push('');
      rows.push(...head(replace).map((line) => '+ ' + line));
      return rows;
    },
    async run(args) {
      const target = resolvePath(args.path);
      const current = await fs.readFile(target, 'utf8');
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      if (!find) return { ok: false, output: "ERROR: missing argument 'find'" };
      if (!current.includes(find)) {
        return { ok: false, output: 'ERROR: find text not present in file.' };
      }
      await fs.writeFile(target, current.replace(find, replace), 'utf8');
      return { ok: true, output: `OK — ${args.path} edited.` };
    },
  },

  run_command: {
    description: 'Run a shell command in the current working directory and return stdout/stderr',
    parameters: [{ name: 'command', description: 'The shell command to run', required: true }],
    async preview(args) {
      return [
        `run  ${args.command}`,
        `cwd  ${process.cwd()}`,
        'executes in your terminal — review the command carefully',
      ];
    },
    async run(args) {
      const command = String(args.command ?? '').trim();
      if (!command) return { ok: false, output: "ERROR: missing argument 'command'" };
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: process.cwd(),
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        const out = [stdout, stderr].filter((part) => part && part.trim()).join('\n');
        return { ok: true, output: truncateOutput(out || '(no output)') };
      } catch (error) {
        const parts = [];
        if (error.stdout) parts.push(error.stdout);
        if (error.stderr) parts.push(error.stderr);
        parts.push(`exit code ${error.code ?? '?'}${error.killed ? ' (timed out)' : ''}`);
        return { ok: false, output: truncateOutput(parts.join('\n')) };
      }
    },
  },
};

export function toolNames() {
  return Object.keys(TOOLS);
}

/** The `tools` array expected by POST /cli/chat/send (OpenTokens v2 format). */
export function toolDeclarations() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

const TOOLCALL_RE = /<toolcall>([\w.-]+)((?:<argkey>[\s\S]*?<\/argkey><argvalue>[\s\S]*?<\/argvalue>)*)<\/toolcall>/g;
const PAIR_RE = /<argkey>([\s\S]*?)<\/argkey><argvalue>([\s\S]*?)<\/argvalue>/g;

/**
 * Pull every finished `<toolcall>` block out of the message.
 * @returns {{ name: string, args: Record<string,string> }[]}
 */
export function extractToolCalls(text) {
  const calls = [];
  TOOLCALL_RE.lastIndex = 0;
  let match;
  while ((match = TOOLCALL_RE.exec(String(text ?? '')))) {
    const args = {};
    PAIR_RE.lastIndex = 0;
    let pair;
    while ((pair = PAIR_RE.exec(match[2]))) {
      args[pair[1].trim()] = pair[2];
    }
    calls.push({ name: match[1], args });
  }
  return calls;
}

/**
 * Hide tool blocks (complete or still streaming) from the live preview and
 * show a tidy `⚙ name(key="value"…)` marker instead of the raw XML.
 */
export function maskToolStream(text) {
  const source = String(text ?? '');
  let out = '';
  let last = 0;
  TOOLCALL_RE.lastIndex = 0;
  let match;
  while ((match = TOOLCALL_RE.exec(source))) {
    out += source.slice(last, match.index);
    const args = {};
    PAIR_RE.lastIndex = 0;
    let pair;
    while ((pair = PAIR_RE.exec(match[2]))) args[pair[1].trim()] = pair[2];
    const summary = Object.entries(args)
      .map(([key, value]) => {
        const single = String(value).replace(/\s+/g, ' ').trim();
        return `${key}=${JSON.stringify(single.length > 40 ? single.slice(0, 40) + '…' : single)}`;
      })
      .join(', ');
    out += `\n⚙ ${match[1]}(${summary})\n`;
    last = match.index + match[0].length;
  }
  // an open (still-streaming) block: stop before it and show a pending marker
  const open = source.indexOf('<toolcall>', last);
  if (open !== -1) {
    out += source.slice(last, open);
    const name = /<toolcall>([\w.-]+)/.exec(source.slice(open));
    out += `\n⚙ ${name ? name[1] : 'tool'} requesting authorization…`;
  } else {
    out += source.slice(last);
  }
  return out;
}

/** Build the confirmation preview rows for a tool call (async: may stat files). */
export async function buildToolPreview(name, args) {
  const tool = TOOLS[name];
  if (!tool) return null;
  try {
    return await tool.preview(args ?? {});
  } catch (error) {
    return [`${name}: preview failed — ${String(error?.message || error)}`];
  }
}

/** Execute an authorized tool call. Never throws: failures come back as output. */
export async function executeTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, output: `ERROR: unknown tool ${name}` };
  try {
    return await tool.run(args ?? {});
  } catch (error) {
    return { ok: false, output: `ERROR: ${String(error?.message || error)}` };
  }
}
