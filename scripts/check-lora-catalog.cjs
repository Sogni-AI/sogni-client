/**
 * Regression checks for the LoRA catalog surface.
 * Runs against compiled `dist/` output to verify the public SDK mapping.
 */

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const ProjectsApi = require('../dist/Projects/index.js').default;

const SILENT_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

const KREA2_MODEL_IDS = [
  'krea2_turbo_fp8_scaled',
  'krea2_identity_edit_v1_2',
  'dark_beast_krea2_fp8',
  'dark_beast_krea2_identity_edit_v1_2',
  'krea2_identity_edit_sogni_v0_3_alpha'
];

/** Two bipolar Krea 2 sliders, one positive-only community LoRA, one video LoRA. */
const CATALOG = [
  {
    loraId: 'krea2-detail-enhancer',
    slug: 'krea2-detail-enhancer',
    name: 'Detail Enhancer',
    description: 'Adds fine detail.',
    relatedLoraIds: [],
    modelIds: KREA2_MODEL_IDS,
    ui: {
      min: -5,
      max: 5,
      default: 1,
      step: 0.1,
      recommendedMin: -2,
      recommendedMax: 5,
      rangeLabels: { min: 'Less Detailed', max: 'More Detailed' },
      category: 'detail-composition',
      nsfw: false,
      sexual: false,
      creator: 'alcaitiff',
      sourceUrl: 'https://civitai.com/models/1'
    }
  },
  {
    loraId: 'krea2-warm-light',
    slug: 'krea2-warm-light',
    name: 'Warm Light',
    description: 'Warms or cools the grade.',
    relatedLoraIds: [],
    modelIds: KREA2_MODEL_IDS,
    ui: {
      min: -10,
      max: 10,
      default: 1,
      step: 0.1,
      recommendedMin: -3,
      recommendedMax: 3,
      rangeLabels: { min: 'Cooler & Darker', max: 'Warmer & Golden' },
      category: 'lighting',
      nsfw: false,
      sexual: false,
      creator: 'alcaitiff',
      sourceUrl: 'https://civitai.com/models/2'
    }
  },
  {
    loraId: 'krea2-mystic-x',
    slug: 'krea2-mystic-x',
    name: 'Mystic X',
    description: 'Uncensored all-round adult fine-tune.',
    relatedLoraIds: [],
    modelIds: KREA2_MODEL_IDS,
    ui: {
      min: 0,
      max: 2,
      default: 1,
      step: 0.1,
      recommendedMin: 0,
      recommendedMax: 1,
      category: 'popular-community-fine-tunes',
      nsfw: true,
      sexual: true,
      creator: 'alcaitiff',
      sourceUrl: 'https://civitai.com/models/3'
    }
  },
  {
    loraId: 'h3-realism-people',
    slug: 'h3-realism-people',
    name: 'Realism People',
    description: 'Realism pass for MiniMax H3.',
    relatedLoraIds: [],
    modelIds: ['minimax-h3-fl2va-fp8_t2v'],
    ui: {
      min: 0,
      max: 2,
      default: 1,
      step: 0.1,
      recommendedMin: 0.6,
      recommendedMax: 1,
      category: 'popular-community-fine-tunes',
      nsfw: false,
      sexual: false,
      creator: 'fal',
      sourceUrl: 'https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA'
    }
  }
];

const ALL_MODEL_IDS = [...KREA2_MODEL_IDS, 'minimax-h3-fl2va-fp8_t2v'].sort();

class RestStub {
  constructor() {
    this.calls = [];
  }

  async get(path, query) {
    this.calls.push({ path, query });
    if (path !== '/v1/loras/comfy') {
      throw new Error(`Unexpected REST GET ${path}`);
    }
    // The server applies the filter; the SDK must forward it rather than
    // fetching everything and narrowing locally.
    const modelId = query && query.modelId;
    const loras = modelId ? CATALOG.filter((lora) => lora.modelIds.includes(modelId)) : CATALOG;
    return {
      status: 'success',
      data: {
        lastUpdated: '2026-08-19',
        loras,
        // Catalog-level facts: never narrowed by the filter.
        models: ALL_MODEL_IDS,
        constraints: { maxPerRequest: 8, minStrength: -100, maxStrength: 100 }
      }
    };
  }
}

class ClientStub extends EventEmitter {
  constructor() {
    super();
    // The catalog is a plain REST read, but ProjectsApi subscribes to socket
    // events in its constructor, so the stub still needs an event emitter here.
    this.socket = new EventEmitter();
    this.rest = new RestStub();
    this.logger = SILENT_LOGGER;
  }
}

async function main() {
  const client = new ClientStub();
  const projects = new ProjectsApi({ client, eip712: {} });

  // Unfiltered catalog.
  const all = await projects.availableLoras();
  assert.equal(all.lastUpdated, '2026-08-19');
  assert.equal(all.loras.length, 4);
  assert.deepEqual(client.rest.calls[0], { path: '/v1/loras/comfy', query: {} });

  // modelId reaches the server as a query parameter.
  const krea2 = await projects.availableLoras({ modelId: 'krea2_turbo_fp8_scaled' });
  assert.deepEqual(client.rest.calls[1], {
    path: '/v1/loras/comfy',
    query: { modelId: 'krea2_turbo_fp8_scaled' }
  });
  assert.deepEqual(
    krea2.loras.map((lora) => lora.loraId),
    ['krea2-detail-enhancer', 'krea2-warm-light', 'krea2-mystic-x']
  );

  // Every Krea 2 model resolves the same set, and every row keeps the full
  // strength contract a caller needs to bound loraStrengths.
  for (const modelId of KREA2_MODEL_IDS) {
    const { loras } = await projects.availableLoras({ modelId });
    assert.deepEqual(
      loras.map((lora) => lora.loraId),
      ['krea2-detail-enhancer', 'krea2-warm-light', 'krea2-mystic-x'],
      `${modelId} must expose the whole Krea 2 set`
    );
    assert.ok(
      loras.every(
        (lora) =>
          Number.isFinite(lora.ui.min) &&
          Number.isFinite(lora.ui.max) &&
          Number.isFinite(lora.ui.default) &&
          Number.isFinite(lora.ui.recommendedMin) &&
          Number.isFinite(lora.ui.recommendedMax)
      ),
      `${modelId} rows must carry a complete strength contract`
    );
  }

  // Bipolar sliders keep their negative bound and endpoint captions — a caller
  // that clamps these to 0..1 loses half of each LoRA's range.
  const warmLight = krea2.loras.find((lora) => lora.loraId === 'krea2-warm-light');
  assert.equal(warmLight.ui.min, -10);
  assert.deepEqual(warmLight.ui.rangeLabels, {
    min: 'Cooler & Darker',
    max: 'Warmer & Golden'
  });
  assert.equal(warmLight.modelIds.length, 5);

  // Maturity flags survive so a client can gate them.
  const mysticX = krea2.loras.find((lora) => lora.loraId === 'krea2-mystic-x');
  assert.equal(mysticX.ui.nsfw, true);
  assert.equal(mysticX.ui.sexual, true);

  // A video LoRA never leaks into an image model's set.
  assert.equal(
    krea2.loras.some((lora) => lora.loraId === 'h3-realism-people'),
    false
  );

  // Results are cached per filter: the repeated Krea 2 calls above did not
  // re-hit the server, and an unrelated filter still does.
  const callsBefore = client.rest.calls.length;
  await projects.availableLoras({ modelId: 'krea2_turbo_fp8_scaled' });
  assert.equal(client.rest.calls.length, callsBefore, 'cached filter must not refetch');

  await projects.availableLoras({ modelId: 'krea2_turbo_fp8_scaled', forceRefresh: true });
  assert.equal(client.rest.calls.length, callsBefore + 1, 'forceRefresh must refetch');

  // An unknown model is an empty catalog, not a throw.
  const unknown = await projects.availableLoras({ modelId: 'no_such_model' });
  assert.deepEqual(unknown.loras, []);

  // Single-LoRA lookup shares the unfiltered cache.
  const detail = await projects.getLora('krea2-detail-enhancer');
  assert.equal(detail.name, 'Detail Enhancer');
  assert.equal(detail.ui.recommendedMax, 5);
  assert.equal(await projects.getLora('no-such-lora'), undefined);

  // An API deployment that predates the `modelId` parameter ignores it and
  // returns the whole catalog. The SDK must still answer with just that model's
  // LoRAs rather than handing back every video LoRA as image-model compatible.
  class LegacyRestStub extends RestStub {
    async get(path, query) {
      this.calls.push({ path, query });
      return { status: 'success', data: { lastUpdated: '2026-08-19', loras: CATALOG } };
    }
  }
  const legacyClient = new ClientStub();
  legacyClient.rest = new LegacyRestStub();
  const legacyProjects = new ProjectsApi({ client: legacyClient, eip712: {} });
  const legacy = await legacyProjects.availableLoras({
    modelId: 'krea2_turbo_fp8_scaled',
    forceRefresh: true
  });
  assert.deepEqual(
    legacy.loras.map((lora) => lora.loraId),
    ['krea2-detail-enhancer', 'krea2-warm-light', 'krea2-mystic-x'],
    'an unfiltered legacy response must still be narrowed to the requested model'
  );

  // Catalog-level facts survive a filtered request, so a client that only ever
  // asks for one model still learns the cap and the capable-model set.
  assert.deepEqual(krea2.models, ALL_MODEL_IDS);
  assert.deepEqual(krea2.constraints, { maxPerRequest: 8, minStrength: -100, maxStrength: 100 });
  assert.deepEqual(all.models, krea2.models);

  // Capability check replaces a hard-coded model list.
  assert.equal(await projects.supportsLoras('krea2_turbo_fp8_scaled'), true);
  assert.equal(await projects.supportsLoras('dark_beast_krea2_identity_edit_v1_2'), true);
  assert.equal(await projects.supportsLoras('minimax-h3-fl2va-fp8_t2v'), true);
  assert.equal(await projects.supportsLoras('flux1-schnell-fp8'), false);

  const constraints = await projects.loraConstraints();
  assert.equal(constraints.maxPerRequest, 8);

  // An API predating the catalog-level fields still yields usable values: the
  // model set is derived from the rows, and the loader's own limits stand in.
  class SparseRestStub extends RestStub {
    async get(path, query) {
      this.calls.push({ path, query });
      return { status: 'success', data: { loras: CATALOG } };
    }
  }
  const sparseClient = new ClientStub();
  sparseClient.rest = new SparseRestStub();
  const sparseProjects = new ProjectsApi({ client: sparseClient, eip712: {} });
  const sparse = await sparseProjects.availableLoras({ forceRefresh: true });
  assert.deepEqual(sparse.models, ALL_MODEL_IDS, 'model set must fall back to the rows');
  assert.deepEqual(sparse.constraints, {
    maxPerRequest: 8,
    minStrength: -100,
    maxStrength: 100
  });

  console.log('LoRA catalog checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
