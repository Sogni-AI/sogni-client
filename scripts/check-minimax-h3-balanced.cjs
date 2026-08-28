const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

(async () => {
  const helpers = await import(
    `${pathToFileURL(path.join(repoRoot, 'examples', 'workflow-helpers.mjs')).href}?balanced-test=${Date.now()}`
  );
  const expected = {
    'minimax-h3-t2v-balanced': 'minimax-h3-fl2va-fp8_t2v_balanced',
    'minimax-h3-i2v-balanced': 'minimax-h3-fl2va-fp8_i2v_balanced',
    'minimax-h3-flf2v-balanced': 'minimax-h3-fl2va-fp8_flf2v_balanced',
    'minimax-h3-r2v-balanced': 'minimax-h3-ref2va-fp8_r2v_balanced'
  };

  for (const [key, id] of Object.entries(expected)) {
    const config = helpers.MODELS.h3[key];
    assert.ok(config, `${key} is available in the H3 example catalog`);
    assert.equal(config.id, id);
    assert.equal(config.defaultSteps, 8);
    assert.equal(config.minSteps, 8);
    assert.equal(config.maxSteps, 8);
    assert.equal(config.defaultComfySampler, 'euler');
    assert.deepEqual(config.allowedComfySamplers, ['euler']);
    assert.equal(config.defaultComfyScheduler, 'simple');
    assert.equal(config.acceleration, 'pdd');
    assert.equal(config.accelerationSourceUrl, helpers.MINIMAX_H3_PDD_SOURCE_URL);
  }

  const help = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'examples', 'workflow_minimax_h3_video.mjs'), '--help'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Balanced: fps 24, steps 8, guidance 1, sampler Euler/);
  assert.match(help.stdout, /default: matching -balanced key/);
  assert.match(help.stdout, /https:\/\/huggingface\.co\/alibaba-pai\/MiniMax-H3-Acc-LoRAs/);

  console.log('MiniMax H3 Balanced SDK guard passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
