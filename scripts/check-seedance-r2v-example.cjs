'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function urls(kind, count, extension) {
  return Array.from(
    { length: count },
    (_, index) => `https://cdn.example.com/${kind}-${index + 1}.${extension}`
  );
}

function parsed(parseArgs, args) {
  return parseArgs(['Contract check prompt.', ...args]);
}

async function main() {
  const exampleUrl = pathToFileURL(
    path.resolve(__dirname, '../examples/workflow_seedance_2_5_r2v.mjs')
  );
  const { buildCreativeAgentRequest, buildDirectProjectParams, parseArgs, validateOptions } =
    await import(exampleUrl.href);

  const reference = parsed(parseArgs, [
    '--task-type',
    'reference',
    '--audio',
    'https://cdn.example.com/voice.mp3'
  ]);
  validateOptions(reference);
  const referenceUrls = {
    images: [],
    videos: [],
    audios: reference.audios
  };
  const referenceParams = buildDirectProjectParams(reference, referenceUrls);
  assert.equal(referenceParams.seedanceTaskType, 'reference');
  assert.deepEqual(
    { width: referenceParams.width, height: referenceParams.height, fps: referenceParams.fps },
    { width: 1920, height: 1080, fps: 24 }
  );

  for (const taskType of ['edit', 'extend']) {
    const options = parsed(parseArgs, [
      '--task-type',
      taskType,
      ...(taskType === 'edit' ? ['--duration', '5'] : []),
      '--video',
      'https://cdn.example.com/source.mp4'
    ]);
    validateOptions(options);
    const params = buildDirectProjectParams(options, {
      images: [],
      videos: options.videos,
      audios: []
    });
    assert.equal(params.seedanceTaskType, taskType);
  }

  for (const taskType of ['edit', 'extend']) {
    assert.throws(
      () => validateOptions(parsed(parseArgs, ['--task-type', taskType])),
      new RegExp(`${taskType} requires at least one source video`)
    );
  }
  assert.throws(
    () => validateOptions(parsed(parseArgs, ['--task-type', 'reference'])),
    /reference requires at least one loose image, video, or audio reference/
  );
  assert.throws(
    () =>
      validateOptions(
        parsed(parseArgs, ['--task-type', 'edit', '--video', 'https://cdn.example.com/source.mp4'])
      ),
    /Direct edit requires --duration set to @Video1's source duration/
  );
  assert.doesNotThrow(() =>
    validateOptions(
      parsed(parseArgs, [
        '--task-type',
        'reference',
        '--audio',
        'https://cdn.example.com/voice.mp3',
        '--resolution',
        '1080p'
      ])
    )
  );
  assert.throws(
    () => validateOptions(parsed(parseArgs, ['--task-type', 'reference', '--image', 'https://cdn.example.com/frame.jpg', '--resolution', '4k'])),
    /seedance-2-5 supports 480p\/720p\/1080p output/
  );

  const maximum25 = parsed(parseArgs, [
    '--task-type',
    'reference',
    '--duration',
    '30',
    ...urls('image', 30, 'jpg').flatMap((url) => ['--image', url]),
    ...urls('video', 10, 'mp4').flatMap((url) => ['--video', url]),
    ...urls('audio', 10, 'mp3').flatMap((url) => ['--audio', url])
  ]);
  assert.doesNotThrow(() => validateOptions(maximum25));

  const legacy = parsed(parseArgs, [
    '--model',
    'seedance-2-0',
    '--task-type',
    'reference',
    '--image',
    'https://cdn.example.com/image.jpg'
  ]);
  validateOptions(legacy);
  assert.equal(
    buildDirectProjectParams(legacy, {
      images: legacy.images,
      videos: [],
      audios: []
    }).seedanceTaskType,
    undefined
  );
  assert.throws(
    () => validateOptions({ ...legacy, duration: 30 }),
    /seedance-2-0 duration must be between 4 and 15 seconds/
  );
  assert.throws(
    () =>
      validateOptions({
        ...legacy,
        images: [],
        audios: ['https://cdn.example.com/voice.mp3']
      }),
    /audio references require at least one image or video reference/
  );
  assert.throws(
    () => validateOptions({ ...legacy, images: urls('image', 10, 'jpg') }),
    /seedance-2-0 supports at most 9 images/
  );

  const toolByTask = {
    reference: 'generate_video',
    edit: 'video_to_video',
    extend: 'extend_video'
  };
  for (const [taskType, toolName] of Object.entries(toolByTask)) {
    const options = parsed(parseArgs, [
      '--creative-agent',
      '--task-type',
      taskType,
      ...(taskType === 'reference'
        ? ['--audio', 'https://cdn.example.com/voice.mp3']
        : ['--video', 'https://cdn.example.com/source.mp4'])
    ]);
    validateOptions(options);
    const request = buildCreativeAgentRequest(options, {
      images: options.images,
      videos: options.videos,
      audios: options.audios
    });
    assert.equal(request.input.steps[0].toolName, toolName);
    assert.doesNotMatch(JSON.stringify(request), /seedanceTaskType|seedance_task_type/);
  }

  // Seedance 2.5 Uncensored keeps its own model id and hosted selector with
  // every Seedance 2.5 limit.
  const uncensoredArgs = ['--model', 'seedance-2-5-uncensored', '--task-type', 'reference'];
  const uncensored = parsed(parseArgs, [
    ...uncensoredArgs,
    '--audio',
    'https://cdn.example.com/voice.mp3'
  ]);
  validateOptions(uncensored);
  const uncensoredParams = buildDirectProjectParams(uncensored, {
    images: [],
    videos: [],
    audios: uncensored.audios
  });
  assert.equal(uncensoredParams.modelId, 'seedance-2-5-uncensored');
  assert.equal(uncensoredParams.seedanceTaskType, 'reference');
  const uncensoredCreativeAgent = parsed(parseArgs, [
    '--creative-agent',
    ...uncensoredArgs,
    '--audio',
    'https://cdn.example.com/voice.mp3'
  ]);
  validateOptions(uncensoredCreativeAgent);
  const uncensoredRequest = buildCreativeAgentRequest(uncensoredCreativeAgent, {
    images: [],
    videos: [],
    audios: uncensoredCreativeAgent.audios
  });
  assert.equal(uncensoredRequest.input.steps[0].arguments.videoModel, 'seedance2-5-uncensored');
  assert.doesNotThrow(() =>
    validateOptions(
      parsed(parseArgs, [
        ...uncensoredArgs,
        '--duration',
        '30',
        ...urls('image', 30, 'jpg').flatMap((url) => ['--image', url])
      ])
    )
  );
  assert.throws(
    () =>
      validateOptions(
        parsed(parseArgs, [
          ...uncensoredArgs,
          ...urls('image', 31, 'jpg').flatMap((url) => ['--image', url])
        ])
      ),
    /seedance-2-5-uncensored supports at most 30 images/
  );

  const partnerUncensored = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../examples/workflow_partner_seedance_video.mjs'),
      'Contract check prompt.',
      '--model',
      'seedance-2-5-uncensored',
      '--duration',
      '30',
      '--width',
      '1920',
      '--height',
      '1080',
      '--workflow',
      '--no-execute',
      '--no-estimate'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(partnerUncensored.status, 0, partnerUncensored.stderr);
  assert.match(partnerUncensored.stdout, /"videoModel": "seedance2-5-uncensored"/);

  const partner1080Dimension = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../examples/workflow_partner_seedance_video.mjs'),
      'Contract check prompt.',
      '--model',
      'seedance-2-5',
      '--width',
      '1920',
      '--height',
      '1080',
      '--workflow',
      '--no-execute',
      '--no-estimate'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(partner1080Dimension.status, 0, partner1080Dimension.stderr);

  const oversizedPartnerDimension = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../examples/workflow_partner_seedance_video.mjs'),
      'Contract check prompt.',
      '--model',
      'seedance-2-5',
      '--width',
      '3840',
      '--no-execute',
      '--no-estimate'
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(oversizedPartnerDimension.status, 0);
  assert.match(oversizedPartnerDimension.stderr, /capped at the 1080p tier/);

  console.log('Seedance 2.5 R2V example checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
