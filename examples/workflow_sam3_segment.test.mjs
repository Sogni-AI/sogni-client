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
