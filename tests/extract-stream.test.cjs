// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExtractionParser, coerceExtraction } = require('../public/assets/extract-stream.js');

const sse = (ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
const toolStart = (index, name = 'record_journey') => sse({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } });
const jsonDelta = (index, partial_json) => sse({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } });
const stop = (reason) => sse({ type: 'message_delta', delta: { stop_reason: reason } }) + sse({ type: 'message_stop' });

const SAMPLE = { patient: { name: 'Test Client' }, report: { summary: 'ok' }, biomarkers: [{ name: 'Vitamin D', value: 32, unit: 'ng/mL', status: 'normal' }], supplements: [{ name: 'Magnesium', dose: '300 mg', timing: ['bedtime'] }], peptides: [] };

function run(chunks){ const p = createExtractionParser(); chunks.forEach(c => p.push(c)); return p.finish(); }

test('parses tool input split across many deltas and arbitrary chunk boundaries', () => {
  const s = JSON.stringify(SAMPLE);
  const stream = sse({ type: 'message_start', message: {} }) + toolStart(0) + jsonDelta(0, s.slice(0, 17)) + jsonDelta(0, s.slice(17, 60)) + jsonDelta(0, s.slice(60)) + sse({ type: 'content_block_stop', index: 0 }) + stop('tool_use');
  const chunks = []; for(let i = 0; i < stream.length; i += 7) chunks.push(stream.slice(i, i + 7));
  const r = run(chunks);
  assert.equal(r.ok, true);
  assert.equal(r.data.patient.name, 'Test Client');
  assert.equal(r.data.biomarkers[0].value, '32');
  assert.deepEqual(r.data.supplements[0].timing, ['bedtime']);
});

test('handles CRLF line endings and a final event without trailing blank line', () => {
  const s = JSON.stringify(SAMPLE);
  const stream = (toolStart(0) + jsonDelta(0, s)).replace(/\n/g, '\r\n') + `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })}`;
  const r = run([stream]);
  assert.equal(r.ok, true);
  assert.equal(r.data.supplements[0].name, 'Magnesium');
});

test('ignores text blocks and other tools, keeps only record_journey', () => {
  const s = JSON.stringify(SAMPLE);
  const stream = sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Here is {"oops"' } })
    + toolStart(1, 'other_tool') + jsonDelta(1, '{"x":1}') + toolStart(2) + jsonDelta(2, s) + stop('tool_use');
  const r = run([stream]);
  assert.equal(r.ok, true);
  assert.equal(r.data.biomarkers.length, 1);
});

test('reports empty when the model answered in prose only', () => {
  const r = run([sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'No data' } }) + stop('end_turn')]);
  assert.deepEqual(r, { ok: false, reason: 'empty' });
});

test('falls back to JSON written as text when no tool call was made', () => {
  const txt = 'Here is the record:\n```json\n' + JSON.stringify(SAMPLE) + '\n```';
  const r = run([sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: txt } }) + stop('end_turn')]);
  assert.equal(r.ok, true);
  assert.equal(r.data.supplements[0].name, 'Magnesium');
  // Unrelated JSON in prose is not accepted as a record.
  const r2 = run([sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sorry {"note":"x"}' } }) + stop('end_turn')]);
  assert.equal(r2.reason, 'empty');
});

test('ignores thinking deltas', () => {
  const s = JSON.stringify(SAMPLE);
  const r = run([sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) + sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '{"biomarkers":' } }) + toolStart(1) + jsonDelta(1, s) + stop('tool_use')]);
  assert.equal(r.ok, true);
  assert.equal(r.data.biomarkers.length, 1);
});

test('reports truncation and stream errors', () => {
  assert.equal(run([toolStart(0) + jsonDelta(0, '{"biomarkers":[') + stop('max_tokens')]).reason, 'truncated');
  assert.equal(run([toolStart(0) + jsonDelta(0, '{"biomarkers":[')]).reason, 'truncated');
  const e = run([sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })]);
  assert.deepEqual(e, { ok: false, reason: 'error', message: 'Overloaded' });
  assert.equal(run([stop('refusal')]).reason, 'refusal');
});

test('coerces stringified arrays, objects and numeric fields', () => {
  const d = coerceExtraction({
    patient: '{"name":"A"}', report: null,
    biomarkers: '[{"name":"TSH","value":2.1}]',
    supplements: [{ name: ' Zinc ', timing: '["breakfast","dinner"]', days_of_week: 'mon, wed', duration_days: '30' }, { dose: 'no name' }, 'junk'],
    peptides: { name: 'BPC-157', start_offset_days: '14', cycle_length_days: '56' },
  });
  assert.equal(d.patient.name, 'A');
  assert.deepEqual(d.report, {});
  assert.deepEqual(d.biomarkers, [{ name: 'TSH', value: '2.1' }]);
  assert.equal(d.supplements.length, 1);
  assert.equal(d.supplements[0].name, 'Zinc');
  assert.deepEqual(d.supplements[0].timing, ['breakfast', 'dinner']);
  assert.deepEqual(d.supplements[0].days_of_week, ['mon', 'wed']);
  assert.equal(d.supplements[0].duration_days, 30);
  assert.equal(d.peptides[0].start_offset_days, 14);
  assert.equal(d.peptides[0].cycle_length_days, 56);
});

test('coerced output feeds mergeExtraction-compatible shape for missing lists', () => {
  const d = coerceExtraction({ patient: { name: 'B' } });
  assert.deepEqual([d.biomarkers, d.supplements, d.peptides], [[], [], []]);
});
