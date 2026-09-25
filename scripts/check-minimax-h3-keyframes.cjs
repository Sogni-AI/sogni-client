'use strict';
/**
 * MiniMax H3 intermediate keyframes: still images pinned at chosen frames
 * between the first and last frame on the H3 i2v and flf2v ids of every tier.
 * Runs against compiled output so it also checks the published API shape.
 *
 * - exactly the ten i2v/flf2v ids accept keyframes; every other model refuses a
 *   non-empty list, and an empty list is no keyframes;
 * - keyframes[i].image rides in contextImage<i+1> (caller order, no
 *   referenceImage offset) and keyframeFrameIndices keeps the same order;
 * - frame indices are checked against the frame count resolved from frames or
 *   duration (calculateVideoFrames, exported from the package root, tells a
 *   caller that count), and every validation error matches the Python SDK word
 *   for word;
 * - projects.create uploads each keyframe image to its slot, and a refused
 *   request uploads and sends nothing.
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createJobRequestMessage = require('../dist/Projects/createJobRequestMessage.js').default;
const sdk = require('../dist/index.js');
const {
  calculateVideoFrames,
  getMinimaxH3KeyframeSlots,
  getVideoWorkflowType,
  isMinimaxH3BalancedModel,
  isMinimaxH3KeyframeModel,
  isMinimaxH3Model,
  isMinimaxH3TurboModel,
  MINIMAX_H3_MAX_KEYFRAMES
} = require('../dist/Projects/utils/index.js');
const ProjectsApi = require('../dist/Projects/index.js').default;

const minimaxH3ModelIds = {
  t2v: 'minimax-h3-fl2va-fp8_t2v',
  i2v: 'minimax-h3-fl2va-fp8_i2v',
  flf2v: 'minimax-h3-fl2va-fp8_flf2v'
};
const minimaxH3FastVideoModelIds = { flf2v: 'minimax-h3-fastvideo-int8_flf2v_turbo' };
const minimaxH3TwoStageModelIds = { flf2v: 'minimax-h3-fastvideo-int8_flf2v_turbo_2stage' };
// MiniMax H3 FastH3 audio guide: [base id, two-stage id] per workflow.
const minimaxH3AudioGuideModelIds = {
  ia2v: ['minimax-h3-fastvideo-int8_ia2v_turbo', 'minimax-h3-fastvideo-int8_ia2v_turbo_2stage'],
  flfa2v: [
    'minimax-h3-fastvideo-int8_flfa2v_turbo',
    'minimax-h3-fastvideo-int8_flfa2v_turbo_2stage'
  ],
  a2v: ['minimax-h3-fastvideo-int8_a2v_turbo', 'minimax-h3-fastvideo-int8_a2v_turbo_2stage']
};
const minimaxH3Options = {
  type: 'video',
  steps: { min: 20, max: 20, step: 1, default: 20 },
  guidance: { min: 1, max: 1, step: 1, default: 1 },
  fps: { allowed: [24], default: 24 },
  sampler: { allowed: ['res_multistep'], default: 'res_multistep' },
  scheduler: { allowed: ['simple'], default: 'simple' }
};
const minimaxH3TurboOptions = {
  ...minimaxH3Options,
  steps: { min: 4, max: 4, step: 1, default: 4 },
  sampler: { allowed: [], default: 'er_sde' }
};
// duration 10 resolves 243 frames on the 124 + n*17 grid.
const minimaxH3Params = {
  type: 'video',
  modelId: minimaxH3ModelIds.t2v,
  numberOfMedia: 1,
  positivePrompt: 'A continuous cinematic shot with synchronized location sound.',
  duration: 10,
  width: 1344,
  height: 768,
  steps: 20,
  guidance: 1,
  sampler: 'res_multistep',
  scheduler: 'simple'
};

// MiniMax H3 intermediate keyframes. The i2v and flf2v ids of every tier pin
// still images between the first and last frame: keyframes[i].image rides in
// contextImage<i+1> (caller order, no referenceImage offset) and the frame
// indices travel as keyframeFrameIndices in the same order.
const minimaxH3KeyframeModelIds = [
  'minimax-h3-fl2va-fp8_i2v',
  'minimax-h3-fl2va-fp8_i2v_turbo',
  'minimax-h3-fl2va-fp8_i2v_balanced',
  'minimax-h3-fl2va-fp8_flf2v',
  'minimax-h3-fl2va-fp8_flf2v_turbo',
  'minimax-h3-fl2va-fp8_flf2v_balanced',
  'minimax-h3-fastvideo-int8_i2v_turbo',
  'minimax-h3-fastvideo-int8_flf2v_turbo',
  'minimax-h3-fastvideo-int8_i2v_turbo_2stage',
  'minimax-h3-fastvideo-int8_flf2v_turbo_2stage'
];
// Every H3 id without keyframe support; flfa2v/ia2v must not match i2v/flf2v.
const minimaxH3NonKeyframeModelIds = [
  'minimax-h3-fl2va-fp8_t2v',
  'minimax-h3-fl2va-fp8_t2v_turbo',
  'minimax-h3-fl2va-fp8_t2v_balanced',
  'minimax-h3-fastvideo-int8_t2v_turbo',
  'minimax-h3-fastvideo-int8_t2v_turbo_2stage',
  'minimax-h3-ref2va-fp8_r2v',
  'minimax-h3-ref2va-fp8_r2v_turbo',
  'minimax-h3-ref2va-fp8_r2v_balanced',
  'minimax-h3-ref2va-fp8_r2v_2stage',
  'minimax-h3-ref2va-fp8_r2v_balanced_2stage',
  ...Object.values(minimaxH3AudioGuideModelIds).flat()
];
assert.equal(MINIMAX_H3_MAX_KEYFRAMES, 8);
assert.equal(minimaxH3KeyframeModelIds.length + minimaxH3NonKeyframeModelIds.length, 26);
for (const modelId of [...minimaxH3KeyframeModelIds, ...minimaxH3NonKeyframeModelIds]) {
  assert.equal(isMinimaxH3Model(modelId), true, `${modelId} is an H3 id`);
}
assert.deepEqual(
  [...minimaxH3KeyframeModelIds, ...minimaxH3NonKeyframeModelIds].filter(isMinimaxH3KeyframeModel),
  minimaxH3KeyframeModelIds
);
for (const modelId of [
  'ltx23-22b-fp8_i2v_distilled',
  'wan_v2.2-14b-fp8_i2v_lightx2v',
  'happyhorse-1.1-i2v',
  'seedance-2-5',
  'not-a-model'
]) {
  assert.equal(isMinimaxH3KeyframeModel(modelId), false, modelId);
}

const keyframeOptions = { ...minimaxH3TurboOptions, sampler: { allowed: [], default: null } };
const keyframeSteps = (modelId) =>
  isMinimaxH3TurboModel(modelId) ? 4 : isMinimaxH3BalancedModel(modelId) ? 8 : 20;
const keyframeParams = (modelId, overrides = {}) => ({
  ...minimaxH3Params,
  modelId,
  steps: keyframeSteps(modelId),
  sampler: undefined,
  referenceImage: true,
  ...(getVideoWorkflowType(modelId) === 'flf2v' ? { referenceImageEnd: true } : {}),
  ...overrides
});
const keyframeRequest = (params) =>
  createJobRequestMessage('h3-keyframes', params, keyframeOptions).keyFrames[0];
const contextImageFlags = (keyFrame) =>
  Object.keys(keyFrame).filter((key) => key.startsWith('hasContextImage'));
const keyframeError = (params, message) =>
  assert.throws(() => keyframeRequest(params), { message }, message);
// The frame error names the count a duration resolved to, and points at
// referenceImage / referenceImageEnd only for frame 0 or the last frame.
const frameIndexError = (index, frames, got, { duration, anchor = false } = {}) => {
  const video =
    duration === undefined
      ? `a ${frames}-frame video`
      : `the ${frames}-frame video that duration ${duration} resolves to`;
  const hint = anchor
    ? '; use referenceImage and referenceImageEnd for the first and last frames'
    : '';
  return `keyframes[${index}].frameIndex must be an integer between 1 and ${frames - 2} for ${video} (got ${got})${hint}.`;
};

// i2v with only a first frame and one keyframe (duration 10 resolves 243 frames).
const i2vKeyframes = keyframeRequest(
  keyframeParams(minimaxH3ModelIds.i2v, { keyframes: [{ image: true, frameIndex: 96 }] })
);
assert.equal(i2vKeyframes.frames, 243);
assert.equal(i2vKeyframes.hasReferenceImage, true);
assert.equal('hasReferenceImageEnd' in i2vKeyframes, false);
assert.deepEqual(contextImageFlags(i2vKeyframes), ['hasContextImage1']);
assert.equal(i2vKeyframes.hasContextImage1, true);
assert.deepEqual(i2vKeyframes.keyframeFrameIndices, [96]);

// flf2v with two keyframes: slots and indices keep the caller's order.
const flf2vKeyframes = keyframeRequest(
  keyframeParams(minimaxH3ModelIds.flf2v, {
    keyframes: [
      { image: Buffer.from('late'), frameIndex: 180 },
      { image: Buffer.from('early'), frameIndex: 60 }
    ]
  })
);
assert.equal(flf2vKeyframes.hasReferenceImage, true);
assert.equal(flf2vKeyframes.hasReferenceImageEnd, true);
assert.deepEqual(contextImageFlags(flf2vKeyframes), ['hasContextImage1', 'hasContextImage2']);
assert.deepEqual(flf2vKeyframes.keyframeFrameIndices, [180, 60]);

// The two-stage id takes the FastH3 request unchanged, keyframes included.
const twoStageKeyframeParams = keyframeParams(minimaxH3TwoStageModelIds.flf2v, {
  width: 672,
  height: 384,
  keyframes: [{ image: true, frameIndex: 120 }]
});
const twoStageKeyframes = keyframeRequest(twoStageKeyframeParams);
assert.equal(twoStageKeyframes.modelID, minimaxH3TwoStageModelIds.flf2v);
assert.deepEqual(twoStageKeyframes.keyframeFrameIndices, [120]);
assert.equal(twoStageKeyframes.hasContextImage1, true);
assert.deepEqual(
  { ...twoStageKeyframes, modelID: minimaxH3FastVideoModelIds.flf2v },
  keyframeRequest({ ...twoStageKeyframeParams, modelId: minimaxH3FastVideoModelIds.flf2v })
);

// Every keyframe id accepts the full eight, in contextImage1..8.
const eightKeyframes = Array.from({ length: 8 }, (_, index) => ({
  image: true,
  frameIndex: 10 + index * 20
}));
for (const modelId of minimaxH3KeyframeModelIds) {
  const keyFrame = keyframeRequest(keyframeParams(modelId, { keyframes: eightKeyframes }));
  assert.deepEqual(
    contextImageFlags(keyFrame),
    Array.from({ length: 8 }, (_, index) => `hasContextImage${index + 1}`),
    modelId
  );
  assert.deepEqual(keyFrame.keyframeFrameIndices, [10, 30, 50, 70, 90, 110, 130, 150], modelId);
}

// Frames resolve from duration (8 s is 192 frames) or from an explicit frames.
const durationKeyframes = keyframeRequest(
  keyframeParams(minimaxH3ModelIds.i2v, {
    duration: 8,
    keyframes: [{ image: true, frameIndex: 190 }]
  })
);
assert.equal(durationKeyframes.frames, 192);
assert.deepEqual(durationKeyframes.keyframeFrameIndices, [190]);
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    duration: 8,
    keyframes: [{ image: true, frameIndex: 191 }]
  }),
  frameIndexError(0, 192, '191', { duration: 8, anchor: true })
);
const framesKeyframes = keyframeRequest(
  keyframeParams(minimaxH3ModelIds.flf2v, {
    duration: undefined,
    frames: 124,
    keyframes: [{ image: true, frameIndex: 122 }]
  })
);
assert.equal(framesKeyframes.frames, 124);
assert.deepEqual(framesKeyframes.keyframeFrameIndices, [122]);

// A duration snaps to the 124 + n*17 grid, so 6 s is 141 frames, not 144, and
// the error says so. calculateVideoFrames is the public way to see that count.
assert.equal(sdk.calculateVideoFrames, calculateVideoFrames);
for (const [seconds, frames] of [
  [124 / 24, 124],
  [6, 141],
  [6.5, 158],
  [8, 192],
  [10, 243],
  [362 / 24, 362]
]) {
  assert.equal(sdk.calculateVideoFrames(minimaxH3ModelIds.i2v, seconds, 24), frames, `${seconds}s`);
  assert.equal(
    keyframeRequest(
      keyframeParams(minimaxH3ModelIds.i2v, {
        duration: seconds,
        keyframes: [{ image: true, frameIndex: frames - 2 }]
      })
    ).frames,
    frames,
    `${seconds}s`
  );
}
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    duration: 6,
    keyframes: [{ image: true, frameIndex: 144 }]
  }),
  'keyframes[0].frameIndex must be an integer between 1 and 139 for the 141-frame video that duration 6 resolves to (got 144).'
);
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    duration: 6.5,
    keyframes: [{ image: true, frameIndex: 158 }]
  }),
  frameIndexError(0, 158, '158', { duration: '6.5' })
);
// With frames, the error names the count directly; frame 0 and the last frame
// point at the anchors, and any other out-of-range frame does not.
keyframeError(
  keyframeParams(minimaxH3ModelIds.flf2v, {
    duration: undefined,
    frames: 141,
    keyframes: [{ image: true, frameIndex: 140 }]
  }),
  'keyframes[0].frameIndex must be an integer between 1 and 139 for a 141-frame video (got 140); use referenceImage and referenceImageEnd for the first and last frames.'
);
for (const [frameIndex, anchor] of [
  [0, true],
  [140, true],
  [141, false],
  [-1, false],
  [150, false]
]) {
  keyframeError(
    keyframeParams(minimaxH3ModelIds.flf2v, {
      duration: undefined,
      frames: 141,
      keyframes: [{ image: true, frameIndex }]
    }),
    frameIndexError(0, 141, String(frameIndex), { anchor })
  );
}

// An empty list is no keyframes, on any model: no flags and no indices.
for (const modelId of [
  minimaxH3ModelIds.i2v,
  minimaxH3ModelIds.t2v,
  minimaxH3TwoStageModelIds.flf2v
]) {
  const keyFrame = keyframeRequest(
    keyframeParams(modelId, {
      keyframes: [],
      ...(modelId === minimaxH3ModelIds.t2v ? { referenceImage: undefined } : {})
    })
  );
  assert.deepEqual(contextImageFlags(keyFrame), [], modelId);
  assert.equal('keyframeFrameIndices' in keyFrame, false, modelId);
}

// Every other model refuses keyframes, vendor families included, and the error
// names the model it refused.
const keyframesWrongModel = (modelId) =>
  `keyframes is supported only by the MiniMax H3 image-to-video and first/last-frame workflows (i2v and flf2v model ids); ${modelId} does not accept keyframes.`;
assert.equal(
  keyframesWrongModel('ltx23-22b-fp8_i2v_distilled'),
  'keyframes is supported only by the MiniMax H3 image-to-video and first/last-frame workflows (i2v and flf2v model ids); ltx23-22b-fp8_i2v_distilled does not accept keyframes.'
);
for (const modelId of [
  ...minimaxH3NonKeyframeModelIds,
  'ltx23-22b-fp8_i2v_distilled',
  'wan_v2.2-14b-fp8_i2v_lightx2v',
  'happyhorse-1.1-i2v',
  'seedance-2-5',
  'wan3.0-video'
]) {
  keyframeError(
    {
      ...minimaxH3Params,
      modelId,
      referenceImage: true,
      keyframes: [{ image: true, frameIndex: 60 }]
    },
    keyframesWrongModel(modelId)
  );
}
// The model check comes first, even for a malformed list.
keyframeError(
  { ...minimaxH3Params, keyframes: { image: true, frameIndex: 60 } },
  keyframesWrongModel(minimaxH3ModelIds.t2v)
);

// Each shape and frame error, word for word (the Python SDK matches them).
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, { keyframes: { image: true, frameIndex: 60 } }),
  'keyframes must be an array of { image, frameIndex } entries.'
);
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    keyframes: [...eightKeyframes, { image: true, frameIndex: 200 }]
  }),
  'keyframes accepts at most 8 entries (got 9).'
);
for (const [keyframes, message] of [
  [[{ frameIndex: 60 }], 'keyframes[0].image is required.'],
  [[null], 'keyframes[0].image is required.'],
  [[true], 'keyframes[0].image is required.'],
  [
    [
      { image: true, frameIndex: 60 },
      { image: false, frameIndex: 61 }
    ],
    'keyframes[1].image is required.'
  ],
  // A missing image is reported before any frame problem.
  [
    [
      { image: true, frameIndex: 0 },
      { image: undefined, frameIndex: 61 }
    ],
    'keyframes[1].image is required.'
  ],
  // A hole in a sparse array is an entry without an image, not a skipped one.
  [[, { image: true, frameIndex: 60 }], 'keyframes[0].image is required.'],
  [
    [{ image: true, frameIndex: 60 }, , { image: true, frameIndex: 90 }],
    'keyframes[1].image is required.'
  ],
  [new Array(2), 'keyframes[0].image is required.']
]) {
  keyframeError(keyframeParams(minimaxH3ModelIds.flf2v, { keyframes }), message);
}
// Slot resolution visits holes too, so no later slot number shifts.
assert.deepEqual(getMinimaxH3KeyframeSlots({ keyframes: [, { image: true, frameIndex: 60 }] }), [
  { slot: 1, media: undefined, frameIndex: undefined },
  { slot: 2, media: true, frameIndex: 60 }
]);
// minimaxH3Params asks for duration 10, which resolves 243 frames.
for (const [frameIndex, got, anchor = false] of [
  [0, '0', true],
  [242, '242', true],
  [243, '243'],
  [-5, '-5'],
  [2.5, '2.5'],
  [Number.NaN, 'NaN'],
  ['60', '"60"'],
  ['0', '"0"'],
  [undefined, 'nothing'],
  [null, 'nothing'],
  [true, 'true'],
  [false, 'false'],
  [[60], 'an array'],
  [{ at: 60 }, 'an object']
]) {
  keyframeError(
    keyframeParams(minimaxH3ModelIds.i2v, { keyframes: [{ image: true, frameIndex }] }),
    frameIndexError(0, 243, got, { duration: 10, anchor })
  );
}
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    keyframes: [
      { image: true, frameIndex: 30 },
      { image: true, frameIndex: 241 },
      { image: true, frameIndex: 30 }
    ]
  }),
  'keyframes must use different frames; frame 30 is used twice.'
);
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    keyframes: [
      { image: true, frameIndex: 30 },
      { image: true, frameIndex: 300 }
    ]
  }),
  frameIndexError(1, 243, '300', { duration: 10 })
);
keyframeError(
  keyframeParams(minimaxH3ModelIds.i2v, {
    duration: undefined,
    keyframes: [{ image: true, frameIndex: 30 }]
  }),
  'keyframes need the video length: pass frames or duration.'
);

// First and last frames keep their own rules, and contextImages stays r2v-only.
assert.throws(
  () =>
    keyframeRequest(
      keyframeParams(minimaxH3ModelIds.i2v, {
        referenceImage: undefined,
        keyframes: [{ image: true, frameIndex: 30 }]
      })
    ),
  /i2v workflow requires at least one of referenceImage or referenceImageEnd/
);
assert.throws(
  () =>
    keyframeRequest(
      keyframeParams(minimaxH3ModelIds.flf2v, {
        referenceImageEnd: undefined,
        keyframes: [{ image: true, frameIndex: 30 }]
      })
    ),
  /flf2v workflow requires referenceImageEnd/
);
assert.throws(
  () =>
    keyframeRequest(
      keyframeParams(minimaxH3ModelIds.i2v, {
        contextImages: [true],
        keyframes: [{ image: true, frameIndex: 30 }]
      })
    ),
  /contextImages is supported only by the MiniMax H3 r2v workflow/
);

// MiniMax H3 keyframe uploads land in contextImage1..N in the caller's order,
// never offset past referenceImage, and a boolean placeholder uploads nothing.
async function checkMinimaxH3KeyframeUploads() {
  class SocketStub extends EventEmitter {
    constructor() {
      super();
      this.sent = [];
    }
    async send(type, data) {
      this.sent.push({ type, data });
    }
  }
  class ClientStub extends EventEmitter {
    constructor() {
      super();
      this.socket = new SocketStub();
      this.logger = { debug() {}, info() {}, warn() {}, error() {} };
    }
    resolveWorkloadAttribution() {
      return undefined;
    }
  }
  const newProjects = () => {
    const client = new ClientStub();
    const projects = new ProjectsApi({ client, eip712: {} });
    projects.getModelOptions = async () => minimaxH3Options;
    const uploads = [];
    projects.uploadReferenceImage = async (_projectId, file) => {
      uploads.push(['referenceImage', file.toString()]);
    };
    projects.uploadReferenceImageEnd = async (_projectId, file) => {
      uploads.push(['referenceImageEnd', file.toString()]);
    };
    projects.uploadContextImage = async (_projectId, index, file) => {
      uploads.push([`contextImage${index + 1}`, file.toString()]);
    };
    return { client, projects, uploads };
  };

  const { client, projects, uploads } = newProjects();
  const project = await projects.create({
    ...minimaxH3Params,
    modelId: minimaxH3ModelIds.flf2v,
    referenceImage: Buffer.from('first'),
    referenceImageEnd: Buffer.from('last'),
    keyframes: [
      { image: Buffer.from('keyframe-at-180'), frameIndex: 180 },
      { image: true, frameIndex: 90 },
      { image: Buffer.from('keyframe-at-30'), frameIndex: 30 }
    ]
  });
  try {
    assert.deepEqual(uploads, [
      ['referenceImage', 'first'],
      ['contextImage1', 'keyframe-at-180'],
      ['contextImage3', 'keyframe-at-30'],
      ['referenceImageEnd', 'last']
    ]);
    const keyFrame = client.socket.sent[0].data.keyFrames[0];
    assert.equal(keyFrame.hasReferenceImage, true);
    assert.equal(keyFrame.hasReferenceImageEnd, true);
    assert.equal(keyFrame.hasContextImage1, true);
    assert.equal(keyFrame.hasContextImage2, true);
    assert.equal(keyFrame.hasContextImage3, true);
    assert.equal(keyFrame.hasContextImage4, undefined);
    assert.deepEqual(keyFrame.keyframeFrameIndices, [180, 90, 30]);
  } finally {
    // Settle the tracked project so its timers cannot keep the process alive.
    project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
  }

  // A refused request uploads nothing and sends nothing.
  const refused = newProjects();
  await assert.rejects(
    () =>
      refused.projects.create({
        ...minimaxH3Params,
        modelId: minimaxH3ModelIds.i2v,
        referenceImage: Buffer.from('first'),
        keyframes: [{ image: Buffer.from('late'), frameIndex: 243 }]
      }),
    { message: frameIndexError(0, 243, '243', { duration: 10 }) }
  );
  assert.deepEqual(refused.uploads, []);
  assert.equal(refused.client.socket.sent.length, 0);
}

checkMinimaxH3KeyframeUploads()
  .then(() => console.log('MiniMax H3 keyframe checks passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
