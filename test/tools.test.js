import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildToolPreview,
  executeTool,
  extractToolCalls,
  firstToolCallIndex,
  maskToolStream,
  resolveToolName,
  toolDeclarations,
} from '../src/tools.js';

// Exactly what the backend/model produces in the wild: mixed `<toolcall>` /
// `<tool_call>` tags, pretty-printed with newlines, and the tool name spelled
// `runcommand` instead of the declared `run_command`.
const REAL_SAMPLE =
  "Voy a revisar los archivos principales del proyecto: " +
  "<toolcall>runcommand<argkey>command</argkey><argvalue>find . -type f -not -path '/node_modules/' -not\n  -path '/.git/' -not -path '/dist/' -not -path '/build/' | head -50</argvalue></toolcall>" +
  '<toolcall>runcommand<argkey>command</argkey><argvalue>ls\n  -la</argvalue></tool_call>';

test('extractToolCalls reads the compact wire form', () => {
  const text =
    'Sure. <toolcall>write_file<argkey>path</argkey><argvalue>a.txt</argvalue></toolcall>';
  assert.deepEqual(extractToolCalls(text), [
    { name: 'write_file', args: { path: 'a.txt' } },
  ]);
});

test('extractToolCalls tolerates pretty-printed tool calls', () => {
  const text = [
    'On it.',
    '<toolcall>',
    '  edit_file',
    '  <argkey>path</argkey>',
    '  <argvalue>src/app.js</argvalue>',
    '  <argkey>find</argkey>',
    '  <argvalue>foo</argvalue>',
    '  <argkey>replace</argkey>',
    '  <argvalue>bar</argvalue>',
    '</toolcall>',
  ].join('\n');
  assert.deepEqual(extractToolCalls(text), [
    { name: 'edit_file', args: { path: 'src/app.js', find: 'foo', replace: 'bar' } },
  ]);
});

test('extractToolCalls accepts <tool_call> and mixed closing tags', () => {
  const sample = extractToolCalls(REAL_SAMPLE);
  assert.equal(sample.length, 2, 'both calls are read, despite the </tool_call> typo');
  assert.deepEqual(
    sample.map((call) => call.name),
    ['runcommand', 'runcommand'],
  );
  assert.equal(sample[1].args.command, 'ls\n  -la');

  assert.deepEqual(
    extractToolCalls('<tool_call>read_file<argkey>path</argkey><argvalue>a.js</argvalue></tool_call>'),
    [{ name: 'read_file', args: { path: 'a.js' } }],
  );
});

test('extractToolCalls accepts <arg_key>/<arg_value> (real backend payload)', () => {
  // Copied verbatim from `~/.otk/toolcall-debug.log` shipped by the backend:
  // `<toolcall>` + `</tool_call>` and underscored argument tags.
  const real =
    '¡Hola! Claro que sí, voy a hacer una llamada a una herramienta para ti.\n\n' +
    '<toolcall>web_search<arg_key>query</arg_key><arg_value>noticias tecnológicas recientes</arg_value></tool_call>';
  assert.deepEqual(extractToolCalls(real), [
    { name: 'web_search', args: { query: 'noticias tecnológicas recientes' } },
  ]);

  assert.deepEqual(
    extractToolCalls(
      '<tool_call>read_file<arg_key>path</arg_key><arg_value>a.js</arg_value></tool_call>',
    ),
    [{ name: 'read_file', args: { path: 'a.js' } }],
  );
});

test('extractToolCalls returns nothing for plain text', () => {
  assert.deepEqual(extractToolCalls('no tools here'), []);
});

test('resolveToolName maps loose names onto declared tools', () => {
  assert.equal(resolveToolName('run_command'), 'run_command');
  assert.equal(resolveToolName('runcommand'), 'run_command');
  assert.equal(resolveToolName('RunCommand'), 'run_command');
  assert.equal(resolveToolName('writefile'), 'write_file');
  assert.equal(resolveToolName('mystery'), null);
  assert.equal(resolveToolName('constructor'), null, 'prototype keys are not tools');
});

test('buildToolPreview always yields rows, even for unknown tools', async () => {
  const known = await buildToolPreview('runcommand', { command: 'ls -la' });
  assert.ok(Array.isArray(known) && known.length > 0);

  const unknown = await buildToolPreview('mystery', {});
  assert.ok(Array.isArray(unknown) && unknown.length > 0);
  assert.match(unknown.join('\n'), /unknown tool/);
});

test('firstToolCallIndex locates the opening tag of either spelling', () => {
  assert.ok(firstToolCallIndex(REAL_SAMPLE) > 0);
  assert.ok(firstToolCallIndex('<tool_call>x</tool_call>') === 0);
  assert.equal(firstToolCallIndex('plain prose'), -1);
});

test('maskToolStream replaces complete blocks and pending ones', () => {
  const done = maskToolStream(
    '<toolcall>write_file<argkey>path</argkey><argvalue>a.txt</argvalue></toolcall>',
  );
  assert.match(done, /⚙ write_file\(path="a\.txt"\)/);
  assert.ok(!done.includes('<toolcall>'));

  const sample = maskToolStream(REAL_SAMPLE);
  assert.equal((sample.match(/⚙/g) ?? []).length, 2, 'both blocks are masked');
  assert.ok(!sample.includes('toolcall'));

  const pending = maskToolStream('<tool_call>\n  read_file\n  <argkey>path</argkey>');
  assert.match(pending, /⚙ read_file requesting authorization…/);
});

test('executeTool writes and reads a file, and refuses unknown tools', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'otk-tools-'));
  try {
    const target = join(dir, 'hello.txt');
    const written = await executeTool('write_file', { path: target, content: 'hi' });
    assert.equal(written.ok, true);
    assert.equal(readFileSync(target, 'utf8'), 'hi');

    const read = await executeTool('read_file', { path: target });
    assert.equal(read.ok, true);
    assert.equal(read.output, 'hi');

    const unknown = await executeTool('nope', {});
    assert.equal(unknown.ok, false);
    assert.match(unknown.output, /unknown tool nope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('web_search resolves from the loose name and describes its cost', async () => {
  assert.equal(resolveToolName('websearch'), 'web_search');
  const preview = await buildToolPreview('web_search', { query: 'react 19' });
  assert.match(preview.join('\n'), /0\.003/);
});

test('web_search formats API results, the charge and the 402 message', async () => {
  const okApi = {
    async search(token, query) {
      assert.equal(token, 'ot_test');
      assert.equal(query, 'react 19');
      return {
        charged: 0.003,
        results: [{ title: 'React 19', url: 'https://react.dev', snippet: 'New hooks\n  here' }],
      };
    },
  };
  const ok = await executeTool('web_search', { query: 'react 19' }, { api: okApi, token: 'ot_test' });
  assert.equal(ok.ok, true);
  assert.match(ok.output, /React 19/);
  assert.match(ok.output, /https:\/\/react\.dev/);
  assert.match(ok.output, /Charged 0\.003 credits/);

  const brokeApi = {
    async search() {
      throw new Error('web_search cost 0.003 credits/search and you human does not have enough credits');
    },
  };
  const broke = await executeTool('web_search', { query: 'x' }, { api: brokeApi, token: 'ot_test' });
  assert.equal(broke.ok, false);
  assert.match(broke.output, /not have enough credits/);
});

test('toolDeclarations describes every tool for the request body', () => {
  const declarations = toolDeclarations();
  assert.deepEqual(
    declarations.map((declaration) => declaration.name),
    ['write_file', 'read_file', 'edit_file', 'run_command', 'web_search'],
  );
  for (const declaration of declarations) {
    assert.equal(typeof declaration.description, 'string');
    assert.ok(Array.isArray(declaration.parameters));
  }
});
