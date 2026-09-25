'use strict';
/**
 * MiniMax H3 intermediate keyframes: still images pinned at chosen frames
 * between the first and last frame on every H3 workflow except text-to-video.
 * Runs against compiled output so it also checks the published API shape.
 *
 * - exactly 21 ids accept keyframes (i2v and flf2v on every tier, the six Sound
 *   to Video ids and the five Ref2VA ids); t2v and every other model refuse a
 *   non-empty list, and an empty list is no keyframes;
 * - keyframes[i].image rides in its own keyframeImage<i+1> slot (caller order)
 *   with hasKeyframeImage<i+1>, keyframeFrameIndices keeps the same order, and
 *   Ref2VA references keep their contextImage slots in the same request;
 * - frame indices are checked against the frame count resolved from frames or
 *   duration (calculateVideoFrames, exported from the package root, tells a
 *   caller that count), the edge-frame hint matches each workflow's inputs, and
 *   every validation error matches the Python SDK word for word;
 * - projects.create uploads each keyframe image to its slot, and a refused
 *   request uploads and sends nothing;
 * - the H3 example's help tells keyframe users to set --frames and to cut to a
 *   new shot where a keyframe changes framing or light.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
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
  flf2v: 'minimax-h3-fl2va-fp8_flf2v',
  ia2v: 'minimax-h3-fastvideo-int8_ia2v_turbo',
  flfa2v: 'minimax-h3-fastvideo-int8_flfa2v_turbo',
  a2v: 'minimax-h3-fastvideo-int8_a2v_turbo',
  r2v: 'minimax-h3-ref2va-fp8_r2v'
};
const minimaxH3FastVideoModelIds = { flf2v: 'minimax-h3-fastvideo-int8_flf2v_turbo' };
const minimaxH3TwoStageModelIds = { flf2v: 'minimax-h3-fastvideo-int8_flf2v_turbo_2stage' };
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
  scheduler: 'simple'
};
const keyframeOptions = {
  type: 'video',
  steps: { min: 4, max: 4, step: 1, default: 4 },
  guidance: { min: 1, max: 1, step: 1, default: 1 },
  fps: { allowed: [24], default: 24 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: ['simple'], default: 'simple' }
};

// The 21 keyframe ids, by workflow, and the five t2v ids that refuse keyframes.
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
  'minimax-h3-fastvideo-int8_flf2v_turbo_2stage',
  'minimax-h3-fastvideo-int8_ia2v_turbo',
  'minimax-h3-fastvideo-int8_ia2v_turbo_2stage',
  'minimax-h3-fastvideo-int8_flfa2v_turbo',
  'minimax-h3-fastvideo-int8_flfa2v_turbo_2stage',
  'minimax-h3-fastvideo-int8_a2v_turbo',
  'minimax-h3-fastvideo-int8_a2v_turbo_2stage',
  'minimax-h3-ref2va-fp8_r2v',
  'minimax-h3-ref2va-fp8_r2v_turbo',
  'minimax-h3-ref2va-fp8_r2v_balanced',
  'minimax-h3-ref2va-fp8_r2v_2stage',
  'minimax-h3-ref2va-fp8_r2v_balanced_2stage'
];
const minimaxH3NonKeyframeModelIds = [
  'minimax-h3-fl2va-fp8_t2v',
  'minimax-h3-fl2va-fp8_t2v_turbo',
  'minimax-h3-fl2va-fp8_t2v_balanced',
  'minimax-h3-fastvideo-int8_t2v_turbo',
  'minimax-h3-fastvideo-int8_t2v_turbo_2stage'
];
assert.equal(MINIMAX_H3_MAX_KEYFRAMES, 8);
assert.equal(minimaxH3KeyframeModelIds.length, 21);
assert.equal(minimaxH3KeyframeModelIds.length + minimaxH3NonKeyframeModelIds.length, 26);
for (const modelId of [...minimaxH3KeyframeModelIds, ...minimaxH3NonKeyframeModelIds]) {
  assert.equal(isMinimaxH3Model(modelId), true, `${modelId} is an H3 id`);
}
assert.deepEqual(
  [...minimaxH3KeyframeModelIds, ...minimaxH3NonKeyframeModelIds].filter(isMinimaxH3KeyframeModel),
  minimaxH3KeyframeModelIds
);
assert.equal(sdk.isMinimaxH3KeyframeModel, isMinimaxH3KeyframeModel);
for (const modelId of [
  // Audio-guide workflow names on the wrong checkpoint are not audio-guide ids.
  'minimax-h3-fl2va-fp8_ia2v_turbo',
  'minimax-h3-fastvideo-int8_flfa2v_balanced',
  'ltx23-22b-fp8_i2v_distilled',
  'ltx23-22b-fp8_ia2v_distilled',
  'wan_v2.2-14b-fp8_i2v_lightx2v',
  'happyhorse-1.1-i2v',
  'happyhorse-1.1-r2v',
  'seedance-2-5',
  'not-a-model'
]) {
  assert.equal(isMinimaxH3KeyframeModel(modelId), false, modelId);
}

// Each workflow's own uploads, as boolean placeholders.
const workflowUploads = {
  t2v: {},
  i2v: { referenceImage: true },
  flf2v: { referenceImage: true, referenceImageEnd: true },
  ia2v: { referenceImage: true, referenceAudio: true },
  flfa2v: { referenceImage: true, referenceImageEnd: true, referenceAudio: true },
  a2v: { referenceAudio: true },
  r2v: { referenceImage: true }
};
const keyframeSteps = (modelId) =>
  isMinimaxH3TurboModel(modelId) ? 4 : isMinimaxH3BalancedModel(modelId) ? 8 : 20;
const keyframeParams = (modelId, overrides = {}) => ({
  ...minimaxH3Params,
  modelId,
  steps: keyframeSteps(modelId),
  ...workflowUploads[getVideoWorkflowType(modelId)],
  ...overrides
});
const keyframeRequest = (params) =>
  createJobRequestMessage('h3-keyframes', params, keyframeOptions).keyFrames[0];
const flags = (keyFrame, prefix) => Object.keys(keyFrame).filter((key) => key.startsWith(prefix));
const keyframeImageFlags = (keyFrame) => flags(keyFrame, 'hasKeyframeImage');
const contextImageFlags = (keyFrame) => flags(keyFrame, 'hasContextImage');
const slotFlags = (count) =>
  Array.from({ length: count }, (_, index) => `hasKeyframeImage${index + 1}`);
const keyframeError = (params, message) =>
  assert.throws(() => keyframeRequest(params), { message }, message);

// What the frame error adds for frame 0 or the last frame, by workflow inputs.
const edgeHint = (workflow, frames) =>
  ({
    i2v: 'use referenceImage and referenceImageEnd for the first and last frames',
    flf2v: 'use referenceImage and referenceImageEnd for the first and last frames',
    flfa2v: 'use referenceImage and referenceImageEnd for the first and last frames',
    ia2v: `use referenceImage for the first frame, and the last frame (${frames - 1}) cannot be pinned`,
    a2v: `frames 0 and ${frames - 1} cannot be pinned`,
    r2v: `frames 0 and ${frames - 1} cannot be pinned`
  })[workflow];
// The frame error names the count a duration resolved to, and explains the
// edge frames only for frame 0 or the last frame.
const frameIndexError = (index, frames, got, { duration, hint } = {}) => {
  const video =
    duration === undefined
      ? `a ${frames}-frame video`
      : `the ${frames}-frame video that duration ${duration} resolves to`;
  return `keyframes[${index}].frameIndex must be an integer between 1 and ${frames - 2} for ${video} (got ${got})${hint ? `; ${hint}` : ''}.`;
};

// i2v with only a first frame and one keyframe (duration 10 resolves 243 frames).
const i2vKeyframes = keyframeRequest(
  keyframeParams(minimaxH3ModelIds.i2v, { keyframes: [{ image: true, frameIndex: 96 }] })
);
assert.equal(i2vKeyframes.frames, 243);
assert.equal(i2vKeyframes.hasReferenceImage, true);
assert.equal('hasReferenceImageEnd' in i2vKeyframes, false);
assert.deepEqual(keyframeImageFlags(i2vKeyframes), ['hasKeyframeImage1']);
assert.equal(i2vKeyframes.hasKeyframeImage1, true);
assert.deepEqual(contextImageFlags(i2vKeyframes), []);
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
assert.deepEqual(keyframeImageFlags(flf2vKeyframes), slotFlags(2));
assert.deepEqual(contextImageFlags(flf2vKeyframes), []);
assert.deepEqual(flf2vKeyframes.keyframeFrameIndices, [180, 60]);

// Sound to Video keeps its audio and anchors; keyframes add their own slots.
for (const workflow of ['ia2v', 'flfa2v', 'a2v']) {
  const keyFrame = keyframeRequest(
    keyframeParams(minimaxH3ModelIds[workflow], {
      frames: 192,
      duration: undefined,
      keyframes: [
        { image: true, frameIndex: 48 },
        { image: true, frameIndex: 144 }
      ]
    })
  );
  assert.equal(keyFrame.hasReferenceAudio, true, workflow);
  assert.equal(keyFrame.hasReferenceImage, workflow === 'a2v' ? undefined : true, workflow);
  assert.equal(keyFrame.hasReferenceImageEnd, workflow === 'flfa2v' ? true : undefined, workflow);
  assert.deepEqual(keyframeImageFlags(keyFrame), slotFlags(2), workflow);
  assert.deepEqual(contextImageFlags(keyFrame), [], workflow);
  assert.deepEqual(keyFrame.keyframeFrameIndices, [48, 144], workflow);
}

// Ref2VA sends references and keyframes together: references keep their
// contextImage slots (offset past referenceImage), keyframes take keyframeImage.
const r2vKeyframes = keyframeRequest(
  keyframeParams(minimaxH3ModelIds.r2v, {
    contextImages: [true, true],
    keyframes: [
      { image: true, frameIndex: 60 },
      { image: true, frameIndex: 150 }
    ]
  })
);
assert.equal(r2vKeyframes.hasReferenceImage, true);
assert.deepEqual(contextImageFlags(r2vKeyframes), ['hasContextImage2', 'hasContextImage3']);
assert.deepEqual(keyframeImageFlags(r2vKeyframes), slotFlags(2));
assert.deepEqual(r2vKeyframes.keyframeFrameIndices, [60, 150]);

// The two-stage id takes the FastH3 request unchanged, keyframes included.
const twoStageKeyframeParams = keyframeParams(minimaxH3TwoStageModelIds.flf2v, {
  width: 672,
  height: 384,
  keyframes: [{ image: true, frameIndex: 120 }]
});
const twoStageKeyframes = keyframeRequest(twoStageKeyframeParams);
assert.equal(twoStageKeyframes.modelID, minimaxH3TwoStageModelIds.flf2v);
assert.deepEqual(twoStageKeyframes.keyframeFrameIndices, [120]);
assert.equal(twoStageKeyframes.hasKeyframeImage1, true);
assert.deepEqual(
  { ...twoStageKeyframes, modelID: minimaxH3FastVideoModelIds.flf2v },
  keyframeRequest({ ...twoStageKeyframeParams, modelId: minimaxH3FastVideoModelIds.flf2v })
);

// Every keyframe id accepts the full eight, in keyframeImage1..8, plus the
// first and last pinnable frames (1 and frames - 2).
const eightKeyframes = Array.from({ length: 8 }, (_, index) => ({
  image: true,
  frameIndex: 10 + index * 20
}));
for (const modelId of minimaxH3KeyframeModelIds) {
  const keyFrame = keyframeRequest(keyframeParams(modelId, { keyframes: eightKeyframes }));
  assert.deepEqual(keyframeImageFlags(keyFrame), slotFlags(8), modelId);
  assert.deepEqual(keyFrame.keyframeFrameIndices, [10, 30, 50, 70, 90, 110, 130, 150], modelId);
  const edges = keyframeRequest(
    keyframeParams(modelId, {
      keyframes: [
        { image: true, frameIndex: 241 },
        { image: true, frameIndex: 1 }
      ]
    })
  );
  assert.deepEqual(edges.keyframeFrameIndices, [241, 1], modelId);
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
  frameIndexError(0, 192, '191', { duration: 8, hint: edgeHint('i2v', 192) })
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

// The edge-frame hint follows each workflow's inputs, word for word.
const edgeMessages = {
  i2v: 'keyframes[0].frameIndex must be an integer between 1 and 139 for a 141-frame video (got 140); use referenceImage and referenceImageEnd for the first and last frames.',
  ia2v: 'keyframes[0].frameIndex must be an integer between 1 and 139 for a 141-frame video (got 140); use referenceImage for the first frame, and the last frame (140) cannot be pinned.',
  a2v: 'keyframes[0].frameIndex must be an integer between 1 and 139 for a 141-frame video (got 140); frames 0 and 140 cannot be pinned.',
  r2v: 'keyframes[0].frameIndex must be an integer between 1 and 139 for a 141-frame video (got 140); frames 0 and 140 cannot be pinned.'
};
for (const [workflow, message] of Object.entries(edgeMessages)) {
  keyframeError(
    keyframeParams(minimaxH3ModelIds[workflow], {
      duration: undefined,
      frames: 141,
      keyframes: [{ image: true, frameIndex: 140 }]
    }),
    message
  );
}
// Frame 0 and the last frame carry the hint on every workflow; any other
// out-of-range frame does not.
for (const workflow of ['i2v', 'flf2v', 'ia2v', 'flfa2v', 'a2v', 'r2v']) {
  for (const [frameIndex, edge] of [
    [0, true],
    [140, true],
    [141, false],
    [-1, false],
    [150, false]
  ]) {
    keyframeError(
      keyframeParams(minimaxH3ModelIds[workflow], {
        duration: undefined,
        frames: 141,
        keyframes: [{ image: true, frameIndex }]
      }),
      frameIndexError(0, 141, String(frameIndex), {
        hint: edge ? edgeHint(workflow, 141) : undefined
      })
    );
  }
}

// An empty list is no keyframes, on any model: no flags and no indices.
for (const modelId of [
  minimaxH3ModelIds.i2v,
  minimaxH3ModelIds.t2v,
  minimaxH3ModelIds.a2v,
  minimaxH3TwoStageModelIds.flf2v
]) {
  const keyFrame = keyframeRequest(keyframeParams(modelId, { keyframes: [] }));
  assert.deepEqual(keyframeImageFlags(keyFrame), [], modelId);
  assert.equal('keyframeFrameIndices' in keyFrame, false, modelId);
}

// t2v and every other model refuse keyframes, vendor families included, and the
// error names the model it refused.
const keyframesWrongModel = (modelId) =>
  `keyframes is supported only by the MiniMax H3 image-to-video, first/last-frame, Sound to Video and Reference to Video workflows (i2v, flf2v, ia2v, flfa2v, a2v and r2v model ids); ${modelId} does not accept keyframes.`;
assert.equal(
  keyframesWrongModel('minimax-h3-fl2va-fp8_t2v'),
  'keyframes is supported only by the MiniMax H3 image-to-video, first/last-frame, Sound to Video and Reference to Video workflows (i2v, flf2v, ia2v, flfa2v, a2v and r2v model ids); minimax-h3-fl2va-fp8_t2v does not accept keyframes.'
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
  keyframeParams(minimaxH3ModelIds.r2v, {
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
for (const [frameIndex, got, edge = false] of [
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
    frameIndexError(0, 243, got, { duration: 10, hint: edge ? edgeHint('i2v', 243) : undefined })
  );
}
keyframeError(
  keyframeParams(minimaxH3ModelIds.a2v, {
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

// Each workflow keeps its own input rules, and contextImages stays r2v-only.
for (const [workflow, overrides, pattern] of [
  [
    'i2v',
    { referenceImage: undefined },
    /i2v workflow requires at least one of referenceImage or referenceImageEnd/
  ],
  ['flf2v', { referenceImageEnd: undefined }, /flf2v workflow requires referenceImageEnd/],
  [
    'i2v',
    { contextImages: [true] },
    /contextImages is supported only by the MiniMax H3 r2v workflow/
  ],
  [
    'ia2v',
    { contextImages: [true] },
    /contextImages is supported only by the MiniMax H3 r2v workflow/
  ],
  ['a2v', { referenceAudio: undefined }, /referenceAudio/],
  ['r2v', { referenceImageEnd: true }, /referenceImageEnd/]
]) {
  assert.throws(
    () =>
      keyframeRequest(
        keyframeParams(minimaxH3ModelIds[workflow], {
          ...overrides,
          keyframes: [{ image: true, frameIndex: 30 }]
        })
      ),
    pattern,
    `${workflow} ${JSON.stringify(Object.keys(overrides))}`
  );
}

// projects.create uploads each keyframe to keyframeImage<n> in the caller's
// order, next to the workflow's own uploads, and a boolean placeholder uploads
// nothing.
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
    projects.getModelOptions = async () => keyframeOptions;
    const uploads = [];
    projects.uploadReferenceImage = async (_projectId, file) => {
      uploads.push(['referenceImage', file.toString()]);
    };
    projects.uploadReferenceImageEnd = async (_projectId, file) => {
      uploads.push(['referenceImageEnd', file.toString()]);
    };
    projects.uploadReferenceAudio = async (_projectId, file) => {
      uploads.push(['referenceAudio', file.toString()]);
    };
    projects.uploadContextImage = async (_projectId, index, file) => {
      uploads.push([`contextImage${index + 1}`, file.toString()]);
    };
    projects.uploadKeyframeImage = async (_projectId, slot, file) => {
      uploads.push([`keyframeImage${slot}`, file.toString()]);
    };
    return { client, projects, uploads };
  };
  const createAndInspect = async (params, check) => {
    const { client, projects, uploads } = newProjects();
    const project = await projects.create(params);
    try {
      check(uploads, client.socket.sent[0].data.keyFrames[0]);
    } finally {
      // Settle the tracked project so its timers cannot keep the process alive.
      project._update({ status: 'failed', error: { code: 0, message: 'test cleanup' } });
    }
  };

  // i2v: a placeholder keyframe keeps its slot and flag but uploads nothing.
  await createAndInspect(
    keyframeParams(minimaxH3ModelIds.i2v, {
      referenceImage: Buffer.from('first'),
      keyframes: [
        { image: Buffer.from('keyframe-at-180'), frameIndex: 180 },
        { image: true, frameIndex: 90 },
        { image: Buffer.from('keyframe-at-30'), frameIndex: 30 }
      ]
    }),
    (uploads, keyFrame) => {
      assert.deepEqual(uploads, [
        ['referenceImage', 'first'],
        ['keyframeImage1', 'keyframe-at-180'],
        ['keyframeImage3', 'keyframe-at-30']
      ]);
      assert.deepEqual(keyframeImageFlags(keyFrame), slotFlags(3));
      assert.deepEqual(contextImageFlags(keyFrame), []);
      assert.deepEqual(keyFrame.keyframeFrameIndices, [180, 90, 30]);
    }
  );

  // ia2v: the first frame and the driving audio upload as before.
  await createAndInspect(
    keyframeParams(minimaxH3ModelIds.ia2v, {
      referenceImage: Buffer.from('first'),
      referenceAudio: Buffer.from('song'),
      keyframes: [
        { image: Buffer.from('keyframe-at-72'), frameIndex: 72 },
        { image: Buffer.from('keyframe-at-168'), frameIndex: 168 }
      ]
    }),
    (uploads, keyFrame) => {
      assert.deepEqual(uploads, [
        ['referenceImage', 'first'],
        ['keyframeImage1', 'keyframe-at-72'],
        ['keyframeImage2', 'keyframe-at-168'],
        ['referenceAudio', 'song']
      ]);
      assert.equal(keyFrame.hasReferenceImage, true);
      assert.equal(keyFrame.hasReferenceAudio, true);
      assert.deepEqual(keyframeImageFlags(keyFrame), slotFlags(2));
      assert.deepEqual(keyFrame.keyframeFrameIndices, [72, 168]);
    }
  );

  // r2v: references in referenceImage + contextImage2..3, keyframes in
  // keyframeImage1..2, in one request.
  await createAndInspect(
    keyframeParams(minimaxH3ModelIds.r2v, {
      referenceImage: Buffer.from('reference-1'),
      contextImages: [Buffer.from('reference-2'), Buffer.from('reference-3')],
      keyframes: [
        { image: Buffer.from('keyframe-at-60'), frameIndex: 60 },
        { image: Buffer.from('keyframe-at-150'), frameIndex: 150 }
      ]
    }),
    (uploads, keyFrame) => {
      assert.deepEqual(uploads, [
        ['referenceImage', 'reference-1'],
        ['contextImage2', 'reference-2'],
        ['contextImage3', 'reference-3'],
        ['keyframeImage1', 'keyframe-at-60'],
        ['keyframeImage2', 'keyframe-at-150']
      ]);
      assert.equal(keyFrame.hasReferenceImage, true);
      assert.deepEqual(contextImageFlags(keyFrame), ['hasContextImage2', 'hasContextImage3']);
      assert.deepEqual(keyframeImageFlags(keyFrame), slotFlags(2));
      assert.deepEqual(keyFrame.keyframeFrameIndices, [60, 150]);
    }
  );

  // A refused request uploads nothing and sends nothing: t2v, and a bad frame.
  for (const [params, message] of [
    [
      keyframeParams(minimaxH3ModelIds.t2v, {
        keyframes: [{ image: Buffer.from('still'), frameIndex: 60 }]
      }),
      keyframesWrongModel(minimaxH3ModelIds.t2v)
    ],
    [
      keyframeParams(minimaxH3ModelIds.i2v, {
        referenceImage: Buffer.from('first'),
        keyframes: [{ image: Buffer.from('late'), frameIndex: 243 }]
      }),
      frameIndexError(0, 243, '243', { duration: 10 })
    ]
  ]) {
    const refused = newProjects();
    await assert.rejects(() => refused.projects.create(params), { message });
    assert.deepEqual(refused.uploads, []);
    assert.equal(refused.client.socket.sent.length, 0);
  }
}

// The example's help carries the prompt rules users need: H3 never sees the
// keyframe images, and a framing or lighting change needs a hard cut.
const help = spawnSync(
  process.execPath,
  [path.join(__dirname, '..', 'examples', 'workflow_minimax_h3_video.mjs'), '--help'],
  { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
);
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /--mode i2v, flf2v or r2v/);
assert.match(help.stdout, /Use --frames to set the length exactly/);
assert.match(help.stdout, /6s is 141 frames/);
assert.match(help.stdout, /H3 never sees the keyframe images as references/);
assert.match(
  help.stdout,
  /changes the framing, camera angle, location or light, start a new\s+shot/
);
assert.match(help.stdout, /r2v <Picture N> and <Subject N> refer to the --ref-\* references only/);

checkMinimaxH3KeyframeUploads()
  .then(() => console.log('MiniMax H3 keyframe checks passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
