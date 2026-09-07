import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from './workflow_sam3_segment.mjs';

test('segmentation defaults to estimate only and preserves point polarity', () => {
  const result = parseOptions(['--source', 'original.png', '--point', '0,1', '--exclude', '1,0']);
  assert.equal(result.run, false);
  assert.deepEqual(result.points, [{ x: 0, y: 1, label: 'positive' }, { x: 1, y: 0, label: 'negative' }]);
});
test('invalid or missing selection coordinates never reach generation', () => {
  for (const value of ['NaN,0', '1.1,0', ',0', '0,', '0,0,1', 'Infinity,0']) assert.throws(() => parseOptions(['--source', 'image.png', '--point', value]));
  assert.throws(() => parseOptions(['--source', 'image.png', '--exclude', '0.2,0.3']));
  assert.throws(() => parseOptions(['--source', 'image.png', '--point']));
});

test('whole-object text and native boxes are accepted without points', () => {
  const result = parseOptions(['--source', 'original.png', '--text', 'lantern', '--box', '0.2,0.6,0.3,0.8']);
  assert.equal(result.text, 'lantern');
  assert.deepEqual(result.points, []);
  assert.deepEqual(result.boxes, [{ x0: 0.2, y0: 0.6, x1: 0.3, y1: 0.8 }]);
  assert.equal(parseOptions(['--source', 'original.png', '--box', '0,0,1,1']).boxes.length, 1);
});
test('invalid boxes and unsupported prompt combinations stop before a paid request', () => {
  for (const value of ['0,0,0,1', '0,1,1,0', '0,0,1', ',0,1,1', '0,0,NaN,1', '0,0,2,1']) assert.throws(() => parseOptions(['--source', 'original.png', '--box', value]));
  assert.throws(() => parseOptions(['--source', 'original.png', '--text', 'lantern', '--point', '0.5,0.5']));
  assert.throws(() => parseOptions(['--source', 'original.png', '--text', 'x'.repeat(241)]));
  assert.throws(() => parseOptions(['--source', 'original.png', ...Array(17).fill(['--box', '0,0,1,1']).flat()]));
  assert.throws(() => parseOptions(['--source', 'original.png', '--point', '0.5,0.5', '--box', '0,0,1,1', '--box', '0,0,0.5,0.5']));
});
