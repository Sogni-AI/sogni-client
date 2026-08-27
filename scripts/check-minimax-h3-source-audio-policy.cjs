const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const workflow = path.join(repoRoot, 'examples', 'workflow_minimax_h3_video.mjs');
const missingVideo = path.join(os.tmpdir(), 'sogni-h3-policy-soundtracked-reference.mp4');

function run(args) {
  return spawnSync(process.execPath, [workflow, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

const baseArgs = [
  '--mode', 'r2v',
  '--ref-video', missingVideo,
  '--duration', '15',
  '--print-prompt',
  '--no-interactive',
];

const missingPolicy = run(baseArgs);
assert.equal(missingPolicy.status, 1);
assert.match(
  `${missingPolicy.stdout}${missingPolicy.stderr}`,
  /source audio is attached.*--source-audio-policy/is,
);

const generatedReuse = run([...baseArgs, '--source-audio-policy', 'reuse']);
assert.equal(generatedReuse.status, 0, generatedReuse.stderr);
assert.match(generatedReuse.stdout, /\[reference generation \+ audio reuse\]/);
assert.match(generatedReuse.stdout, /<Audio 1>:\s*fully_copy/);
assert.match(generatedReuse.stdout, /non_diegetic_music:[\s\S]*Directly reuse/i);

const ambiguousReuse = run([
  ...baseArgs,
  '--ref-video', path.join(os.tmpdir(), 'sogni-h3-policy-second-soundtracked-reference.mp4'),
  '--source-audio-policy', 'reuse',
]);
assert.equal(ambiguousReuse.status, 1);
assert.match(
  `${ambiguousReuse.stdout}${ambiguousReuse.stderr}`,
  /reuse requires exactly one source soundtrack; found 2/i,
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sogni-h3-policy-test-'));
try {
  const badPromptPath = path.join(tempDir, 'bad-reference-prompt.txt');
  fs.writeFileSync(
    badPromptPath,
    `subject_definitions:\n<Video 1> supplies motion. <Audio 1> supplies rhythm.\n\nsummary:\n[reference generation + audio reference] Generate a new dance.\n\nretention_analysis:\n<Video 1>: weak_reference - motion only.\n<Audio 1>: reference - tempo only.\n\ndetailed_description:\n[Shot 1] One continuous dance shot.\n\noverall_soundscape:\nGenerated movement sounds.\n\nnon_diegetic_music:\nGenerate a new song from <Audio 1>.\n`,
  );
  const rejectedReplacement = run([
    ...baseArgs,
    '--prompt-file', badPromptPath,
    '--source-audio-policy', 'reuse',
  ]);
  assert.equal(rejectedReplacement.status, 1);
  const output = `${rejectedReplacement.stdout}${rejectedReplacement.stderr}`;
  assert.match(output, /requires the official "audio reuse" summary task/);
  assert.match(output, /requires <Audio 1>: fully_copy/);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('MiniMax H3 source-audio policy guard passed.');
