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
    const isReference = key === 'minimax-h3-r2v-balanced';
    assert.equal(
      config.acceleration,
      isReference ? 'larry-v4-step600-ema' : 'lightx2v-v1.0-8step-768p'
    );
    assert.equal(
      config.accelerationSourceUrl,
      isReference
        ? helpers.MINIMAX_H3_LARRY_BALANCED_SOURCE_URL
        : helpers.MINIMAX_H3_LIGHTX2V_BALANCED_SOURCE_URL
    );
  }

  const help = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'examples', 'workflow_minimax_h3_video.mjs'), '--help'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Balanced: fps 24, steps 8, guidance 1, sampler Euler/);
  assert.match(help.stdout, /default: matching -balanced key/);
  assert.match(help.stdout, /https:\/\/huggingface\.co\/lightx2v\/Minimax-h3-Turbo\/tree\//);
  assert.match(help.stdout, /https:\/\/huggingface\.co\/larryvrh\/MiniMax-H3-Turbo-Lora\/tree\//);

  console.log('MiniMax H3 Balanced SDK guard passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
