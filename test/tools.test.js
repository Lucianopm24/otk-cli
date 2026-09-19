import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  executeTool,
  extractToolCalls,
  maskToolStream,
  toolDeclarations,
} from '../src/tools.js';

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

test('extractToolCalls returns every call and nothing for plain text', () => {
  const text =
    '<toolcall>read_file<argkey>path</argkey><argvalue>a.js</argvalue></toolcall>' +
    '<toolcall>read_file<argkey>path</argkey><argvalue>b.js</argvalue></toolcall>';
  assert.equal(extractToolCalls(text).length, 2);
  assert.deepEqual(extractToolCalls('no tools here'), []);
});

test('maskToolStream replaces complete blocks and pending ones', () => {
  const done = maskToolStream(
    '<toolcall>write_file<argkey>path</argkey><argvalue>a.txt</argvalue></toolcall>',
  );
  assert.match(done, /⚙ write_file\(path="a\.txt"\)/);
  assert.ok(!done.includes('<toolcall>'));

  const pending = maskToolStream('<toolcall>\n  read_file\n  <argkey>path</argkey>');
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

test('toolDeclarations describes every tool for the request body', () => {
  const declarations = toolDeclarations();
  assert.deepEqual(
    declarations.map((declaration) => declaration.name),
    ['write_file', 'read_file', 'edit_file', 'run_command'],
  );
  for (const declaration of declarations) {
    assert.equal(typeof declaration.description, 'string');
    assert.ok(Array.isArray(declaration.parameters));
  }
});
