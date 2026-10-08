// Stand-in for the Anthropic Messages API, for testing Claude in boards without a key or network.
//   node scripts/fake-anthropic.mjs 4040 [log.jsonl]
// Run the app with ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4040
//
// Streams a scripted agent: first it reads the board, then adds a group of two idea cards, then
// answers in text. Every request body is appended to the log file so tests can check its shape.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2]) || 4040;
const logFile = process.argv[3] || null;
let n = 0;

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': `req_fake_${n}` });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

function reply(blocks, stop) {
  const id = `msg_fake_${++n}`;
  const events = [{ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 } } }];
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const part of b.text.match(/.{1,12}/gs)) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 300 } });
  events.push({ type: 'message_stop' });
  return events;
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404).end(); return; }
    const params = JSON.parse(body || '{}');
    if (logFile) fs.appendFileSync(logFile, `${JSON.stringify({ headers: { beta: req.headers['anthropic-beta'] || '' }, params })}\n`);
    const system = (params.system || []).map((s) => s.text).join('\n');
    const boardId = /board_id ([\w-]+)/.exec(system)?.[1] || '';
    const last = params.messages[params.messages.length - 1];
    const lastUser = [...params.messages].reverse().find((m) => m.role === 'user');
    const results = Array.isArray(lastUser.content) ? lastUser.content.filter((c) => c.type === 'tool_result') : [];
    const prevAssistant = [...params.messages].reverse().find((m) => m.role === 'assistant');
    const lastTool = prevAssistant?.content?.find?.((c) => c.type === 'tool_use')?.name;
    if (!results.length || last.role === 'system') {
      return sse(res, reply([{ type: 'text', text: 'Let me look at the board first.' }, { type: 'tool_use', id: `toolu_${n}a`, name: 'read_board', input: { board_id: boardId } }], 'tool_use'));
    }
    if (lastTool === 'read_board') {
      return sse(res, reply([{ type: 'tool_use', id: `toolu_${n}b`, name: 'add_cards', input: { board_id: boardId, cards: [{ type: 'group', title: 'Ideas from Claude', cards: [{ type: 'text', text: '**Idea one:** a launch film told by the product.' }, { type: 'text', text: '**Idea two:** a series of short cut-downs.' }] }] } }], 'tool_use'));
    }
    return sse(res, reply([{ type: 'text', text: 'I added a group called **Ideas from Claude** with two ideas, based on the board and its context.' }], 'end_turn'));
  });
}).listen(port, () => console.log(`Fake Anthropic API on http://localhost:${port}`));
