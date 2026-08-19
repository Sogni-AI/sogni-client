/**
 * Artist-facing presentation and strength contract for one LoRA.
 *
 * Served by `GET /v1/loras/comfy`. Download URLs, byte sizes, and hashes stay
 * on the worker-facing endpoint and never reach a client.
 */
export interface LoraUi {
  /** Hard lower bound the slider allows. Negative for a bipolar LoRA. */
  min: number;
  /** Hard upper bound the slider allows. */
  max: number;
  /**
   * The LoRA's own default strength. Note this is not always 1.0 — several
   * sliders default to 0 (no effect until the artist moves them) and several
   * community fine-tunes default below 1.
   */
  default: number;
  /** Slider increment. */
  step: number;
  /** Lower end of the band the LoRA's author calls usable. */
  recommendedMin: number;
  /** Upper end of the band the LoRA's author calls usable. */
  recommendedMax: number;
  /**
   * Captions for the semantic effect at each endpoint, present on bipolar
   * LoRAs — e.g. `{ min: 'Cooler & Darker', max: 'Warmer & Golden' }`.
   */
  rangeLabels?: {
    min: string;
    max: string;
  };
  /** Grouping for a LoRA browser, e.g. `character`, `lighting`, `art-direction`. */
  category: string;
  /** Set when several independent LoRAs present as one row, e.g. the Chest sliders. */
  section?: {
    id: string;
    label: string;
    order: number;
  };
  /** Requires the artist to have the Sensitive Content Filter off (gore, horror, or sexual). */
  nsfw: boolean;
  /** Specifically sexual content. Narrower than `nsfw` — body horror is nsfw but not sexual. */
  sexual: boolean;
  creator: string;
  sourceUrl: string;
  license?: string;
  licenseUrl?: string;
  examples?: Array<{
    url: string;
    caption?: string;
    isMature?: boolean;
    prompt?: string;
    negativePrompt?: string;
  }>;
  exampleGroups?: Array<{
    title: string;
    examples: Array<{ url: string; caption?: string; isMature?: boolean }>;
    prompt?: string;
    negativePrompt?: string;
  }>;
  examplePrompt?: string;
  exampleNegativePrompt?: string;
}

/** One row of the LoRA catalog, joined to the models that accept it. */
export interface LoraCatalogEntry {
  /** The value to pass in `ProjectParams.loras`. */
  loraId: string;
  slug: string;
  name: string;
  description: string;
  /** Sibling LoRAs worth surfacing alongside this one. */
  relatedLoraIds: string[];
  ui: LoraUi;
  /** Every model id that accepts this LoRA. */
  modelIds: string[];
}

export interface AvailableLorasParams {
  /**
   * Restrict the catalog to the LoRAs one model accepts, e.g.
   * `krea2_turbo_fp8_scaled`. Omit for the whole catalog.
   *
   * A model with no LoRAs — or an unrecognized id — returns an empty array.
   */
  modelId?: string;
  /** Bypass the 5-minute cache and re-read the catalog. */
  forceRefresh?: boolean;
}

/**
 * Limits that apply to every LoRA request, advertised by the server so clients
 * do not hard-code them. Enforced by the render pipeline: a request over
 * `maxPerRequest` is rejected at submit, and a strength outside a LoRA's own
 * `ui.min`/`ui.max` is clamped.
 */
export interface LoraConstraints {
  /** Maximum LoRAs stackable on one render. */
  maxPerRequest: number;
  /**
   * Hard bounds of the underlying loader, and the fallback range for a LoRA
   * with no catalog entry. A LoRA's own `ui.min`/`ui.max` is always narrower
   * and is what a slider should bind to.
   */
  minStrength: number;
  maxStrength: number;
}

export interface LoraCatalog {
  /** When the catalog data was last edited, if the server reports it. */
  lastUpdated?: string;
  loras: LoraCatalogEntry[];
  /**
   * Every model id that accepts at least one LoRA, sorted, regardless of any
   * `modelId` filter applied to `loras`. Use it to decide whether to offer a
   * LoRA control for a model at all.
   */
  models: string[];
  constraints: LoraConstraints;
}
