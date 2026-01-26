/**
 * Shared Helper Functions for Workflow Scripts
 *
 * This module provides common interactive prompts and model configurations
 * for all workflow example scripts.
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import imageSize from 'image-size';
import sharp from 'sharp';
import { SogniClient } from '../dist/index.js';

// ============================================
// Model Configurations
// ============================================

/**
 * Model configurations for all supported workflows.
 * Each model has a display name, internal ID, and workflow-specific settings.
 */
export const MODELS = {
  // Text-to-Image Models (ComfyUI worker)
  image: {
    'z-turbo': {
      id: 'z_image_turbo_bf16',
      name: 'Z-Image Turbo',
      description: 'Fast generation with good quality',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 4,
      maxSteps: 10,
      defaultSteps: 4,
      supportsGuidance: true,
      defaultGuidance: 1.0,
      minGuidance: 0.6,
      maxGuidance: 1.6,
      supportsDenoise: true,
      defaultDenoise: 0.7,
      supportsStartingImage: true,
      isComfyModel: true,
      defaultComfySampler: 'res_multistep',
      defaultComfyScheduler: 'simple'
    },
    'chroma-v46-flash': {
      id: 'chroma-v.46-flash_fp8',
      name: 'Chroma v.46 Flash',
      description: 'Fast high-quality generation',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 10,
      maxSteps: 20,
      defaultSteps: 10,
      supportsGuidance: true,
      defaultGuidance: 1.0,
      minGuidance: 1.0,
      maxGuidance: 2.5,
      supportsDenoise: true,
      defaultDenoise: 0.7,
      supportsStartingImage: true,
      defaultNegativePrompt: 'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple'
    },
    'chroma-v48-detail-svd': {
      id: 'chroma-v48-detail-svd_fp8',
      name: 'Chroma v48 Detail SVD',
      description: 'High detail generation',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 20,
      maxSteps: 40,
      defaultSteps: 25,
      supportsGuidance: true,
      defaultGuidance: 5.0,
      minGuidance: 3.0,
      maxGuidance: 8.0,
      supportsDenoise: true,
      defaultDenoise: 0.7,
      supportsStartingImage: true,
      defaultNegativePrompt: 'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple'
    },
    'flux1-krea-dev': {
      id: 'flux1-krea-dev_fp8_scaled',
      name: 'Flux.1 Krea Dev',
      description: 'Creative generation with detail',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 12,
      maxSteps: 40,
      defaultSteps: 20,
      supportsGuidance: true,
      defaultGuidance: 3.5,
      minGuidance: 1.0,
      maxGuidance: 5.0,
      supportsDenoise: true,
      defaultDenoise: 0.7,
      supportsStartingImage: true,
      defaultNegativePrompt: 'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple'
    },
    'flux1-schnell': {
      id: 'flux1-schnell-fp8',
      name: 'Flux.1 Schnell',
      description: 'Very fast generation (1-5 steps)',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 1536,
      maxHeight: 1536,
      minSteps: 1,
      maxSteps: 5,
      defaultSteps: 4,
      supportsGuidance: true,
      defaultGuidance: 1.0,
      minGuidance: 0.1,
      maxGuidance: 1.0,
      isComfyModel: false,
      defaultSampler: 'Euler',
      defaultScheduler: 'Simple'
    },
    flux2: {
      id: 'flux2_dev_fp8',
      name: 'Flux.2 Dev',
      description: 'Highest quality, supports context images.',
      defaultWidth: 1248,
      defaultHeight: 832,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 20,
      maxSteps: 50,
      defaultSteps: 20,
      supportsGuidance: true,
      defaultGuidance: 4.0,
      minGuidance: 3.0,
      maxGuidance: 6.0,
      supportsContextImages: true,
      maxContextImages: 6,
      isComfyModel: true,
      defaultComfySampler: 'euler'
    },
    'qwen-2512-lightning': {
      id: 'qwen_image_2512_fp8_lightning',
      name: 'Qwen Image 2512 Lightning',
      description: 'Fast 4-step generation (recommended)',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 4,
      maxSteps: 8,
      defaultSteps: 4,
      supportsGuidance: true,
      defaultGuidance: 1.0,
      minGuidance: 0.6,
      maxGuidance: 1.6,
      supportsStartingImage: true,
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple'
    },
    'qwen-2512': {
      id: 'qwen_image_2512_fp8',
      name: 'Qwen Image 2512',
      description: 'High quality generation with native Qwen vision',
      defaultWidth: 1024,
      defaultHeight: 1024,
      maxWidth: 2048,
      maxHeight: 2048,
      minSteps: 20,
      maxSteps: 50,
      defaultSteps: 25,
      supportsGuidance: true,
      defaultGuidance: 4.0,
      minGuidance: 3.0,
      maxGuidance: 6.0,
      supportsStartingImage: true,
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple'
    }
  },

  // Image Edit Models (ComfyUI worker)
  // Note: Optional LoRAs (like Multiple Angles) should be supported through regular workflows
  // by allowing CFG to be specified per-job. Regular editing uses CFG 4.0, LoRA uses CFG 1.0.
  imageEdit: {
    'qwen-lightning': {
      id: 'qwen_image_edit_2511_fp8_lightning',
      name: 'Qwen Image Edit 2511 Lightning',
      description: 'Fast 4-step image editing (recommended)',
      maxWidth: 2560,
      maxHeight: 2560,
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      supportsContextImages: true,
      maxContextImages: 3,
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      defaultGuidance: 1.0,
      minGuidance: 0.6,
      maxGuidance: 1.6
    },
    qwen: {
      id: 'qwen_image_edit_2511_fp8',
      name: 'Qwen Image Edit 2511',
      description: 'High quality image editing, supports context images',
      maxWidth: 2560,
      maxHeight: 2560,
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 50,
      supportsContextImages: true,
      maxContextImages: 3,
      isComfyModel: true,
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      defaultGuidance: 4.0,
      minGuidance: 2.5,
      maxGuidance: 5.0
    },
    flux2: {
      id: 'flux2_dev_fp8',
      name: 'Flux.2 Dev',
      description: 'Highest quality, supports context images.',
      defaultWidth: 1248,
      defaultHeight: 832,
      maxWidth: 2048,
      maxHeight: 2048,
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 50,
      supportsGuidance: true,
      defaultGuidance: 4.0,
      minGuidance: 3.0,
      maxGuidance: 6.0,
      supportsContextImages: true,
      maxContextImages: 6,
      isComfyModel: true,
      defaultComfySampler: 'euler'
    }
  },

  // Text-to-Video Models (ComfyUI workflow)
  t2v: {
    'wan_v2.2-14b-fp8_t2v_lightx2v': {
      id: 'wan_v2.2-14b-fp8_t2v_lightx2v',
      name: 'WAN 2.2 14B FP8 T2V LightX2V',
      description: 'Fast 4-step generation (1-10s video)',
      defaultWidth: 640,
      defaultHeight: 640,
      minWidth: 480,
      maxWidth: 1536,
      minHeight: 480,
      maxHeight: 1536,
      dimensionStep: 16,
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 5.0,
      minShift: 1.0,
      maxShift: 8.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      defaultComfySampler: 'euler',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'heun', 'lms', 'dpm_2', 'dpm_2_ancestral', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'uni_pc', 'lcm'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'ddim_uniform', 'beta'],
      minFrames: 17,
      maxFrames: 161,
      defaultFrames: 81,
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: true,
      isComfyModel: true
    },
    'wan_v2.2-14b-fp8_t2v': {
      id: 'wan_v2.2-14b-fp8_t2v',
      name: 'WAN 2.2 14B FP8 T2V',
      description: 'High quality 20-step generation (1-10s video)',
      defaultWidth: 640,
      defaultHeight: 640,
      minWidth: 480,
      maxWidth: 1536,
      minHeight: 480,
      maxHeight: 1536,
      dimensionStep: 16,
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      minShift: 1.0,
      maxShift: 8.0,
      defaultGuidance: 3.5,
      minGuidance: 1.5,
      maxGuidance: 8.0,
      defaultComfySampler: 'euler',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'heun', 'lms', 'dpm_2', 'dpm_2_ancestral', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'uni_pc', 'lcm'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'ddim_uniform', 'beta'],
      minFrames: 17,
      maxFrames: 161,
      defaultFrames: 81,
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: false,
      isComfyModel: true
    },
    'ltx2-19b-fp8_t2v_distilled': {
      id: 'ltx2-19b-fp8_t2v_distilled',
      name: 'LTX-2 19B FP8 T2V Distilled',
      description: 'Fast 8-step generation with audio (~4-20s video)',
      defaultWidth: 1920,
      defaultHeight: 1088,
      minWidth: 768,
      maxWidth: 1920,
      minHeight: 768,
      maxHeight: 1920,
      dimensionStep: 64,
      defaultSteps: 8,
      minSteps: 4,
      maxSteps: 12,
      defaultGuidance: 1.0,
      minGuidance: 1.0,
      maxGuidance: 2.0,
      defaultComfySampler: 'euler_ancestral',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'sgm_uniform', 'beta'],
      minFrames: 97,
      maxFrames: 505,
      defaultFrames: 97,
      frameStep: 8,
      defaultFps: 25,
      allowedFps: [25, 50],
      isLightning: true,
      isComfyModel: true,
      hasAudio: true
    },
    'ltx2-19b-fp8_t2v': {
      id: 'ltx2-19b-fp8_t2v',
      name: 'LTX-2 19B FP8 T2V',
      description: 'High quality 20-step generation with audio (~4-10s video)',
      defaultWidth: 1920,
      defaultHeight: 1088,
      minWidth: 768,
      maxWidth: 1920,
      minHeight: 768,
      maxHeight: 1920,
      dimensionStep: 64,
      defaultSteps: 20,
      minSteps: 15,
      maxSteps: 30,
      defaultGuidance: 4.0,
      minGuidance: 2.0,
      maxGuidance: 7.0,
      defaultComfySampler: 'euler_ancestral',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'sgm_uniform', 'beta'],
      minFrames: 97,
      maxFrames: 257,
      defaultFrames: 97,
      frameStep: 8,
      defaultFps: 25,
      allowedFps: [25, 50],
      isLightning: false,
      isComfyModel: true,
      hasAudio: true
    }
  },

  // Image-to-Video Models (ComfyUI workflow)
  i2v: {
    'wan_v2.2-14b-fp8_i2v_lightx2v': {
      id: 'wan_v2.2-14b-fp8_i2v_lightx2v',
      name: 'WAN 2.2 14B FP8 I2V LightX2V',
      description: 'Fast 4-step generation (1-10s video)',
      defaultWidth: 640,
      defaultHeight: 640,
      minWidth: 480,
      maxWidth: 1536,
      minHeight: 480,
      maxHeight: 1536,
      dimensionStep: 16,
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 5.0,
      minShift: 1.0,
      maxShift: 8.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      defaultComfySampler: 'euler',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'heun', 'lms', 'dpm_2', 'dpm_2_ancestral', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'uni_pc', 'lcm'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'ddim_uniform', 'beta'],
      minFrames: 17,
      maxFrames: 161,
      defaultFrames: 81,
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: true,
      isComfyModel: true
    },
    'wan_v2.2-14b-fp8_i2v': {
      id: 'wan_v2.2-14b-fp8_i2v',
      name: 'WAN 2.2 14B FP8 I2V',
      description: 'High quality 20-step generation (1-10s video)',
      defaultWidth: 640,
      defaultHeight: 640,
      minWidth: 480,
      maxWidth: 1536,
      minHeight: 480,
      maxHeight: 1536,
      dimensionStep: 16,
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      minShift: 1.0,
      maxShift: 8.0,
      defaultGuidance: 4.0,
      minGuidance: 1.5,
      maxGuidance: 8.0,
      defaultComfySampler: 'euler',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'heun', 'lms', 'dpm_2', 'dpm_2_ancestral', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu', 'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'uni_pc', 'lcm'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'ddim_uniform', 'beta'],
      minFrames: 17,
      maxFrames: 161,
      defaultFrames: 81,
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: false,
      isComfyModel: true
    },
    'ltx2-19b-fp8_i2v_distilled': {
      id: 'ltx2-19b-fp8_i2v_distilled',
      name: 'LTX-2 19B FP8 I2V Distilled',
      description: 'Fast 8-step image animation with audio (~4-20s video)',
      defaultWidth: 1920,
      defaultHeight: 1088,
      minWidth: 768,
      maxWidth: 1920,
      minHeight: 768,
      maxHeight: 1920,
      dimensionStep: 64,
      defaultSteps: 8,
      minSteps: 4,
      maxSteps: 12,
      defaultGuidance: 1.0,
      minGuidance: 1.0,
      maxGuidance: 2.0,
      defaultStrength: 0.85,
      minStrength: 0.5,
      maxStrength: 1.0,
      defaultComfySampler: 'euler',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'sgm_uniform', 'beta'],
      minFrames: 97,
      maxFrames: 505,
      defaultFrames: 97,
      frameStep: 8,
      defaultFps: 25,
      allowedFps: [25, 50],
      isLightning: true,
      isComfyModel: true,
      hasAudio: true
    },
    'ltx2-19b-fp8_i2v': {
      id: 'ltx2-19b-fp8_i2v',
      name: 'LTX-2 19B FP8 I2V',
      description: 'High quality 20-step image animation with audio (~4-10s video)',
      defaultWidth: 1920,
      defaultHeight: 1088,
      minWidth: 768,
      maxWidth: 1920,
      minHeight: 768,
      maxHeight: 1920,
      dimensionStep: 64,
      defaultSteps: 20,
      minSteps: 15,
      maxSteps: 30,
      defaultGuidance: 4.0,
      minGuidance: 2.0,
      maxGuidance: 7.0,
      defaultStrength: 0.85,
      minStrength: 0.5,
      maxStrength: 1.0,
      defaultComfySampler: 'euler',
      allowedComfySamplers: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc'],
      defaultComfyScheduler: 'simple',
      allowedComfySchedulers: ['simple', 'normal', 'sgm_uniform', 'beta'],
      minFrames: 97,
      maxFrames: 257,
      defaultFrames: 97,
      frameStep: 8,
      defaultFps: 25,
      allowedFps: [25, 50],
      isLightning: false,
      isComfyModel: true,
      hasAudio: true
    }
  },

  // Sound-to-Video Models (ComfyUI workflow)
  s2v: {
    lightx2v: {
      id: 'wan_v2.2-14b-fp8_s2v_lightx2v',
      name: 'WAN 2.2 14B FP8 S2V LightX2V',
      description: 'Fast 4-step generation (recommended)',
      defaultSteps: 4,
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 8.0, // S2V uses 8.0 even for lightx2v
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'uni_pc', // S2V uses uni_pc
      defaultComfyScheduler: 'simple',
      maxFrames: 321, // S2V supports longer videos
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: true,
      isComfyModel: true
    },
    quality: {
      id: 'wan_v2.2-14b-fp8_s2v',
      name: 'WAN 2.2 14B FP8 S2V',
      description: 'High quality 20-step generation',
      defaultSteps: 20,
      minSteps: 20,
      maxSteps: 40,
      defaultShift: 8.0,
      defaultGuidance: 6.0, // S2V quality uses higher guidance
      minGuidance: 1.5,
      maxGuidance: 8.0,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'uni_pc', // S2V uses uni_pc
      defaultComfyScheduler: 'simple',
      maxFrames: 321, // S2V supports longer videos
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: false,
      isComfyModel: true
    }
  },

  // Video-to-Video (Animate) Models (ComfyUI workflow)
  animate: {
    'move-lightx2v': {
      id: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
      name: 'WAN 2.2 14B FP8 Animate-Move LightX2V',
      description: 'Fast camera movement animation (recommended)',
      workflowType: 'animate-move',
      defaultSteps: 6, // Animate Lightning uses 6 steps
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 8.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 321,
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: true,
      isComfyModel: true
    },
    // NOTE: No official full quality animate-move exists - only lightx2v version available
    'replace-lightx2v': {
      id: 'wan_v2.2-14b-fp8_animate-replace_lightx2v',
      name: 'WAN 2.2 14B FP8 Animate-Replace LightX2V',
      description: 'Fast subject replacement (recommended)',
      workflowType: 'animate-replace',
      defaultSteps: 6, // Animate Lightning uses 6 steps
      minSteps: 4,
      maxSteps: 8,
      defaultShift: 8.0,
      defaultGuidance: 1.0,
      minGuidance: 0.7,
      maxGuidance: 1.6,
      // ComfyUI format (preferred for video models)
      defaultComfySampler: 'euler',
      defaultComfyScheduler: 'simple',
      maxFrames: 321,
      defaultFps: 16,
      allowedFps: [16, 32],
      isLightning: true,
      supportsSam2Coordinates: true,
      isComfyModel: true
    },
    // NOTE: No official full quality animate-replace exists - only lightx2v version available
  }
};

// ============================================
// Video Parameter Constraints
// ============================================

// Base constraints - note that frames.max may be overridden by model-specific maxFrames
// WAN models use 16/32 fps, LTX-2 uses 25/50 fps (native, not interpolated)
export const VIDEO_CONSTRAINTS = {
  width: { min: 416, max: 1920, default: 832, step: 16 },
  height: { min: 416, max: 1920, default: 480, step: 16 },
  frames: { min: 17, max: 505, default: 81 }, // WAN max: 161/321, LTX-2 max: 257/505
  fps: { allowedValues: [16, 25, 32, 50], default: 25 }, // Model-specific defaults override this
  shift: { min: 1.0, max: 8.0, default: 8.0, step: 0.1 },
  // Guidance ranges differ by model type:
  // WAN Quality: min: 1.5, max: 8.0
  // WAN Lightning: min: 0.7, max: 1.6
  // LTX-2 Quality: min: 2.0, max: 7.0
  // LTX-2 Distilled: min: 1.0, max: 2.0
  guidance: {
    quality: { min: 1.5, max: 8.0, step: 0.01 },
    lightning: { min: 0.7, max: 1.6, step: 0.01 }
  }
};

/**
 * Ensure dimensions are divisible by 16 (video encoder requirement).
 * @param {number} width - Input width
 * @param {number} height - Input height
 * @returns {{width: number, height: number}} Adjusted dimensions
 */
export function ensureDimensionsDivisibleBy16(width, height) {
  return {
    width: Math.floor(width / 16) * 16,
    height: Math.floor(height / 16) * 16
  };
}

/**
 * Process image for video generation - auto-resize if needed.
 * Handles dimension requirements (min/max, divisible by 16).
 *
 * @param {string} imagePath - Path to the image file
 * @param {number} frames - Target number of frames (unused, kept for API compatibility)
 * @param {Object} options - Optional overrides
 * @param {number} options.targetWidth - Target width (optional, auto-detected if not provided)
 * @param {number} options.targetHeight - Target height (optional, auto-detected if not provided)
 * @returns {Promise<{buffer: Buffer, width: number, height: number, wasResized: boolean, originalWidth: number, originalHeight: number}>}
 */
export async function processImageForVideo(imagePath, frames, options = {}) {
  // Get original dimensions
  const dimensions = imageSize(imagePath);
  if (!dimensions.width || !dimensions.height) {
    throw new Error('Could not read image dimensions');
  }

  const originalWidth = dimensions.width;
  const originalHeight = dimensions.height;

  let targetWidth = options.targetWidth || originalWidth;
  let targetHeight = options.targetHeight || originalHeight;
  let needsResize = false;
  let resizeReason = '';

  const maxDimension = VIDEO_CONSTRAINTS.width.max;

  // Check if image exceeds maximum dimensions
  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    needsResize = true;
    resizeReason = 'exceeds max';

    // Calculate scaling factor to fit within max dimensions while maintaining aspect ratio
    const scaleFactor = Math.min(
      maxDimension / targetWidth,
      maxDimension / targetHeight
    );

    targetWidth = Math.floor(targetWidth * scaleFactor);
    targetHeight = Math.floor(targetHeight * scaleFactor);
  }

  // Check if image is below minimum dimensions
  if (targetWidth < VIDEO_CONSTRAINTS.width.min || targetHeight < VIDEO_CONSTRAINTS.height.min) {
    needsResize = true;
    if (!resizeReason) resizeReason = 'below minimum';

    // Calculate scaling factor to meet minimum dimensions while maintaining aspect ratio
    const scaleFactor = Math.max(
      VIDEO_CONSTRAINTS.width.min / targetWidth,
      VIDEO_CONSTRAINTS.height.min / targetHeight
    );

    targetWidth = Math.floor(targetWidth * scaleFactor);
    targetHeight = Math.floor(targetHeight * scaleFactor);

    // Ensure we don't exceed max dimensions after upscaling
    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      const downscaleFactor = Math.min(
        maxDimension / targetWidth,
        maxDimension / targetHeight
      );
      targetWidth = Math.floor(targetWidth * downscaleFactor);
      targetHeight = Math.floor(targetHeight * downscaleFactor);
    }
  }

  // Ensure dimensions are divisible by 16 (video encoder requirement)
  const aligned = ensureDimensionsDivisibleBy16(targetWidth, targetHeight);

  // Check if alignment changed dimensions
  if (aligned.width !== targetWidth || aligned.height !== targetHeight) {
    needsResize = true;
    if (!resizeReason) resizeReason = 'alignment';
  }

  targetWidth = aligned.width;
  targetHeight = aligned.height;

  // Ensure dimensions don't go below minimum after alignment
  if (targetWidth < VIDEO_CONSTRAINTS.width.min) {
    targetWidth = Math.ceil(VIDEO_CONSTRAINTS.width.min / 16) * 16;
    needsResize = true;
  }
  if (targetHeight < VIDEO_CONSTRAINTS.height.min) {
    targetHeight = Math.ceil(VIDEO_CONSTRAINTS.height.min / 16) * 16;
    needsResize = true;
  }

  let imageBuffer;

  if (needsResize || targetWidth !== originalWidth || targetHeight !== originalHeight) {
    log('🔄', `Resizing image from ${originalWidth}x${originalHeight} to ${targetWidth}x${targetHeight}`);

    // Use sharp to resize the image
    imageBuffer = await sharp(imagePath)
      .resize(targetWidth, targetHeight, {
        fit: 'fill', // Fill to exact dimensions
        withoutEnlargement: false // Allow enlargement if needed
      })
      .toBuffer();

    needsResize = true;
  } else {
    // No resize needed, just read the original file
    imageBuffer = fs.readFileSync(imagePath);
  }

  return {
    buffer: imageBuffer,
    width: targetWidth,
    height: targetHeight,
    wasResized: needsResize,
    originalWidth,
    originalHeight
  };
}

// ============================================
// Sampler and Scheduler Options
// ============================================

/**
 * Create a lightweight SDK connection for fetching model options.
 * This can be used early in the workflow before the full SDK is created.
 * @param {string} username - Username for authentication
 * @param {string} password - Password for authentication
 * @returns {Promise<Object>} SDK instance
 */
export async function createSogniConnection(username, password) {
  // Load optional configuration from environment
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const clientConfig = {
    appId: `sogni-workflow-options-${Date.now()}`,
    network: 'fast'
  };

  if (testnet) clientConfig.testnet = testnet;
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;

  const sogni = await SogniClient.createInstance(clientConfig);
  await sogni.account.login(username, password);
  await sogni.projects.waitForModels();

  return sogni;
}

/**
 * Get sampler options from the SDK's model options API
 * @param {Object} sogni - Sogni SDK instance
 * @param {string} modelId - Model ID to get options for
 * @returns {Promise<Object|null>} Sampler options { allowed: string[], default: string } or null
 */
export async function getSamplerOptions(sogni, modelId) {
  try {
    const modelOptions = await sogni.projects.getModelOptions(modelId);
    return modelOptions.sampler;
  } catch (e) {
    console.warn(`Warning: Could not fetch sampler options for ${modelId}: ${e.message}`);
    return null;
  }
}

/**
 * Get scheduler options from the SDK's model options API
 * @param {Object} sogni - Sogni SDK instance
 * @param {string} modelId - Model ID to get options for
 * @returns {Promise<Object|null>} Scheduler options { allowed: string[], default: string } or null
 */
export async function getSchedulerOptions(sogni, modelId) {
  try {
    const modelOptions = await sogni.projects.getModelOptions(modelId);
    return modelOptions.scheduler;
  } catch (e) {
    console.warn(`Warning: Could not fetch scheduler options for ${modelId}: ${e.message}`);
    return null;
  }
}

/**
 * Get default sampler from SDK's model options API
 * @param {Object} sogni - Sogni SDK instance
 * @param {string} modelId - Model ID to get default for
 * @returns {Promise<string|null>} Default sampler ID or null
 */
export async function getDefaultSampler(sogni, modelId) {
  try {
    const modelOptions = await sogni.projects.getModelOptions(modelId);
    return modelOptions.sampler.default;
  } catch (e) {
    return null;
  }
}

/**
 * Get default scheduler from SDK's model options API
 * @param {Object} sogni - Sogni SDK instance
 * @param {string} modelId - Model ID to get default for
 * @returns {Promise<string|null>} Default scheduler ID or null
 */
export async function getDefaultScheduler(sogni, modelId) {
  try {
    const modelOptions = await sogni.projects.getModelOptions(modelId);
    return modelOptions.scheduler.default;
  } catch (e) {
    return null;
  }
}

// ============================================
// Interactive Prompts
// ============================================

/**
 * Ask a single question and return the answer
 */
export async function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(typeof answer === 'string' ? answer.trim() : '');
    });
  });
}

/**
 * Ask for a multi-line prompt. User can paste text with linebreaks.
 * Input ends when user presses Enter on an empty line (double Enter).
 * @param {string} question - The question/instruction to display
 * @param {string} defaultValue - Default value if user enters nothing
 * @returns {Promise<string>} The collected multi-line text
 */
export async function askMultilinePrompt(question, defaultValue = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(question);
  console.log('  (Paste or type your prompt. Press Enter twice to finish, or Enter once for default)');
  if (defaultValue) {
    const preview = defaultValue.length > 60 ? defaultValue.substring(0, 60) + '...' : defaultValue;
    console.log(`  Default: "${preview}"`);
  }
  console.log();

  return new Promise((resolve) => {
    const lines = [];
    let emptyLineCount = 0;

    rl.on('line', (line) => {
      if (line === '') {
        emptyLineCount++;
        // If first line is empty and we have no content, use default
        if (lines.length === 0 && emptyLineCount === 1) {
          rl.close();
          resolve(defaultValue);
          return;
        }
        // Second empty line (or first after content) ends input
        if (emptyLineCount >= 1 && lines.length > 0) {
          rl.close();
          const result = lines.join('\n').trim();
          resolve(result || defaultValue);
          return;
        }
      } else {
        emptyLineCount = 0;
        lines.push(line);
      }
    });

    rl.on('close', () => {
      // Handle Ctrl+D / EOF
      if (lines.length > 0) {
        resolve(lines.join('\n').trim());
      } else {
        resolve(defaultValue);
      }
    });
  });
}

/**
 * Interactively pick an image file from test-assets or images directory
 * @param {string|null} defaultImage - Image path provided via CLI
 * @param {string} label - Label for the image type (e.g., 'input image', 'reference image')
 * @returns {Promise<string>} Selected image path
 */
export async function pickImageFile(defaultImage = null, label = 'input image') {
  // If image was provided via CLI and exists, use it
  if (defaultImage && fs.existsSync(defaultImage)) {
    return defaultImage;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found. Use --image <path> to specify an image or run interactively.`
    );
  }

  // Scan directories for image files
  const scanDirs = ['./test-assets', './images'];
  let allImages = [];

  for (const scanDir of scanDirs) {
    if (fs.existsSync(scanDir)) {
      const files = fs
        .readdirSync(scanDir)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .map((f) => ({ file: f, dir: scanDir, path: path.join(scanDir, f) }));
      allImages = allImages.concat(files);
    }
  }

  if (allImages.length === 0) {
    throw new Error(
      `No image files found in test-assets or images directories. Please place an image file there or use --image <path>.`
    );
  }

  console.log(`\n🖼️  Select ${label}:\n`);
  allImages.forEach((img, i) => {
    console.log(`  ${i + 1}. ${img.path}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${allImages.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > allImages.length) {
    // Default to first image
    console.log(`  → Using ${allImages[0].path}\n`);
    return allImages[0].path;
  }

  const selectedPath = allImages[choice - 1].path;
  console.log(`  → Using ${selectedPath}\n`);
  return selectedPath;
}

/**
 * Interactively pick an audio file from test-assets directory
 * @param {string|null} defaultAudio - Audio path provided via CLI
 * @param {string} label - Label for the audio type
 * @returns {Promise<string>} Selected audio path
 */
export async function pickAudioFile(defaultAudio = null, label = 'audio file') {
  // If audio was provided via CLI and exists, use it
  if (defaultAudio && fs.existsSync(defaultAudio)) {
    return defaultAudio;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found. Use --audio <path> to specify an audio file or run interactively.`
    );
  }

  // Scan test-assets for audio files
  const scanDir = './test-assets';
  if (!fs.existsSync(scanDir)) {
    throw new Error(`Directory ${scanDir} not found. Please create it and add audio files.`);
  }

  const audioFiles = fs
    .readdirSync(scanDir)
    .filter((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f))
    .sort();

  if (audioFiles.length === 0) {
    throw new Error(
      `No audio files found in ${scanDir}. Please add an audio file or use --audio <path>.`
    );
  }

  console.log(`\n🔊 Select ${label}:\n`);
  audioFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${path.join(scanDir, file)}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${audioFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > audioFiles.length) {
    // Default to first audio
    const defaultPath = path.join(scanDir, audioFiles[0]);
    console.log(`  → Using ${defaultPath}\n`);
    return defaultPath;
  }

  const selectedPath = path.join(scanDir, audioFiles[choice - 1]);
  console.log(`  → Using ${selectedPath}\n`);
  return selectedPath;
}

/**
 * Interactively pick a video file from test-assets directory
 * @param {string|null} defaultVideo - Video path provided via CLI
 * @param {string} label - Label for the video type
 * @returns {Promise<string>} Selected video path
 */
export async function pickVideoFile(defaultVideo = null, label = 'video file') {
  // If video was provided via CLI and exists, use it
  if (defaultVideo && fs.existsSync(defaultVideo)) {
    return defaultVideo;
  }

  // If not TTY, error out
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${label} found. Use --video <path> to specify a video file or run interactively.`
    );
  }

  // Scan test-assets for video files
  const scanDir = './test-assets';
  if (!fs.existsSync(scanDir)) {
    throw new Error(`Directory ${scanDir} not found. Please create it and add video files.`);
  }

  const videoFiles = fs
    .readdirSync(scanDir)
    .filter((f) => /\.(mp4|mov|avi|webm|mkv)$/i.test(f))
    .sort();

  if (videoFiles.length === 0) {
    throw new Error(
      `No video files found in ${scanDir}. Please add a video file or use --video <path>.`
    );
  }

  console.log(`\n🎬 Select ${label}:\n`);
  videoFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${path.join(scanDir, file)}`);
  });
  console.log();

  const answer = await askQuestion(`Enter choice [1-${videoFiles.length}]: `);
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > videoFiles.length) {
    // Default to first video
    const defaultPath = path.join(scanDir, videoFiles[0]);
    console.log(`  → Using ${defaultPath}\n`);
    return defaultPath;
  }

  const selectedPath = path.join(scanDir, videoFiles[choice - 1]);
  console.log(`  → Using ${selectedPath}\n`);
  return selectedPath;
}

/**
 * Display a numbered list of models and prompt user to select one
 * @param {Object} models - Object with model keys and model configs
 * @param {string} defaultKey - Default model key if user presses Enter
 * @returns {Promise<{key: string, config: Object}>} Selected model key and config
 */
export async function selectModel(models, defaultKey = null) {
  const modelKeys = Object.keys(models);
  const defaultIndex = defaultKey ? modelKeys.indexOf(defaultKey) + 1 : 1;

  console.log('\n📦 Select Model:\n');
  modelKeys.forEach((key, index) => {
    const model = models[key];
    const marker = defaultKey && key === defaultKey ? ' (default)' : '';
    console.log(`  ${index + 1}. ${model.name}${marker}`);
    if (model.description) {
      console.log(`     ${model.description}`);
    }
  });
  console.log();

  const choice = await askQuestion(
    `Enter choice [1-${modelKeys.length}] (default: ${defaultIndex}): `
  );
  const choiceNum = parseInt(choice.trim(), 10);

  if (choiceNum >= 1 && choiceNum <= modelKeys.length) {
    const key = modelKeys[choiceNum - 1];
    return { key, config: models[key] };
  }

  // Default selection
  const key = defaultKey || modelKeys[0];
  return { key, config: models[key] };
}

/**
 * Prompt for core options common to all workflows
 * @param {Object} options - Current options object
 * @param {Object} modelConfig - Selected model configuration
 * @param {Object} config - Additional configuration (defaultPrompt, isVideo, etc.)
 * @returns {Promise<Object>} Updated options
 */
export async function promptCoreOptions(options, modelConfig, config = {}) {
  const { defaultPrompt = '', isVideo = false } = config;

  // Prompt - use multi-line input to support pasted prompts with linebreaks
  if (!options.prompt) {
    console.log();
    options.prompt = await askMultilinePrompt('📝 Enter your prompt:', defaultPrompt);
  }

  // Width - use model-specific constraints if available
  const defaultWidth =
    modelConfig.defaultWidth || (isVideo ? VIDEO_CONSTRAINTS.width.default : 1024);
  const minWidth = modelConfig.minWidth || VIDEO_CONSTRAINTS.width.min;
  const maxWidth = modelConfig.maxWidth || VIDEO_CONSTRAINTS.width.max;
  const dimensionStep = modelConfig.dimensionStep || VIDEO_CONSTRAINTS.width.step || 16;
  const widthRange = isVideo
    ? ` (${minWidth}-${maxWidth}, step ${dimensionStep})`
    : maxWidth ? ` (max: ${maxWidth})` : '';
  const widthInput = await askQuestion(`Width${widthRange} (default: ${defaultWidth}): `);
  if (widthInput.trim()) {
    const w = parseInt(widthInput.trim(), 10);
    if (!isNaN(w) && w > 0) {
      // Round to nearest step
      let adjustedWidth = Math.round(w / dimensionStep) * dimensionStep;
      adjustedWidth = Math.max(minWidth, Math.min(maxWidth, adjustedWidth));
      options.width = adjustedWidth;
    }
  }
  if (!options.width) options.width = defaultWidth;

  // Height - use model-specific constraints if available
  const defaultHeight =
    modelConfig.defaultHeight || (isVideo ? VIDEO_CONSTRAINTS.height.default : 1024);
  const minHeight = modelConfig.minHeight || VIDEO_CONSTRAINTS.height.min;
  const maxHeight = modelConfig.maxHeight || VIDEO_CONSTRAINTS.height.max;
  const heightRange = isVideo
    ? ` (${minHeight}-${maxHeight}, step ${dimensionStep})`
    : maxHeight ? ` (max: ${maxHeight})` : '';
  const heightInput = await askQuestion(`Height${heightRange} (default: ${defaultHeight}): `);
  if (heightInput.trim()) {
    const h = parseInt(heightInput.trim(), 10);
    if (!isNaN(h) && h > 0) {
      // Round to nearest step
      let adjustedHeight = Math.round(h / dimensionStep) * dimensionStep;
      adjustedHeight = Math.max(minHeight, Math.min(maxHeight, adjustedHeight));
      options.height = adjustedHeight;
    }
  }
  if (!options.height) options.height = defaultHeight;

  return options;
}

/**
 * Prompt for video-specific duration with user-friendly menu
 * @param {Object} options - Current options object
 * @param {Object} modelConfig - Selected model configuration (optional)
 * @returns {Promise<Object>} Updated options with frames calculated
 */
export async function promptVideoDuration(options, modelConfig = {}) {
  const fps = options.fps || modelConfig.defaultFps || VIDEO_CONSTRAINTS.fps.default;

  // Use model-specific frame limits if available
  const maxFrames = modelConfig.maxFrames || VIDEO_CONSTRAINTS.frames.max;
  const minFrames = modelConfig.minFrames || VIDEO_CONSTRAINTS.frames.min;
  const frameStep = modelConfig.frameStep || 1;

  /**
   * Convert duration to valid frame count following n*step+1 rule
   * LTX-2 uses step=8, so valid frames are: 1, 9, 17, ..., 153, 161, 169, ...
   */
  function durationToFrames(durationSec) {
    let frames = Math.round(durationSec * fps) + 1;
    if (frameStep > 1) {
      // Round to nearest n*frameStep + 1
      const n = Math.round((frames - 1) / frameStep);
      frames = n * frameStep + 1;
    }
    return Math.max(minFrames, Math.min(maxFrames, frames));
  }

  // Calculate min/max duration based on valid frame counts
  // For LTX-2 with minFrames=97 at 25fps: (97-1)/25 = 3.84s
  const minDurationExact = (minFrames - 1) / fps;
  const maxDurationExact = (maxFrames - 1) / fps;

  // Generate duration options based on model constraints
  // Build options that map to unique frame counts (no duplicates)
  let durationOptions = [];
  let seenFrames = new Set();

  // Start from actual minimum duration (rounded up) to max duration
  const startDuration = Math.ceil(minDurationExact);
  const endDuration = Math.floor(maxDurationExact);

  // Generate candidates: every second from min to 10s, then every 2s after that
  let candidateDurations = [];
  for (let d = startDuration; d <= Math.min(10, endDuration); d++) {
    candidateDurations.push(d);
  }
  for (let d = 12; d <= endDuration; d += 2) {
    candidateDurations.push(d);
  }

  for (const d of candidateDurations) {
    const frames = durationToFrames(d);
    // Only add if within bounds AND maps to a new frame count
    if (frames >= minFrames && frames <= maxFrames && !seenFrames.has(frames)) {
      seenFrames.add(frames);
      durationOptions.push(d);
    }
  }

  // Default to first option if list is empty
  if (durationOptions.length === 0) {
    durationOptions = [Math.round(minDurationExact)];
  }

  // Find default: use model's defaultFrames if available, otherwise first option
  let defaultDuration;
  if (modelConfig.defaultFrames) {
    defaultDuration = Math.round((modelConfig.defaultFrames - 1) / fps);
  } else {
    defaultDuration = durationOptions[0];
  }
  const defaultIndex = durationOptions.indexOf(defaultDuration) !== -1
    ? durationOptions.indexOf(defaultDuration)
    : 0;

  console.log('\n⏱️  Select video duration:\n');
  durationOptions.forEach((d, i) => {
    const frames = durationToFrames(d);
    const actualDuration = (frames - 1) / fps;
    const marker = i === defaultIndex ? ' (default)' : '';
    console.log(`  ${i + 1}. ${d}s → ${frames} frames (${actualDuration.toFixed(1)}s actual)${marker}`);
  });
  console.log(`  ${durationOptions.length + 1}. Custom duration`);
  console.log();

  const choice = await askQuestion(`Enter choice [1-${durationOptions.length + 1}] (default: ${defaultIndex + 1}): `);
  let duration;

  const choiceNum = parseInt(choice.trim(), 10);

  if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= durationOptions.length) {
    duration = durationOptions[choiceNum - 1];
  } else if (choiceNum === durationOptions.length + 1) {
    // Custom duration
    const minDur = Math.floor(minDurationExact);
    const maxDur = Math.floor(maxDurationExact);
    const customInput = await askQuestion(`Enter duration in seconds (${minDur}-${maxDur}): `);
    duration = Math.min(maxDur, Math.max(minDur, parseFloat(customInput.trim()) || defaultDuration));
  } else {
    // Default selection
    duration = durationOptions[defaultIndex];
  }

  // Convert duration to valid frame count
  const frames = durationToFrames(duration);
  options.frames = frames;
  options.duration = (frames - 1) / fps; // Store actual duration

  console.log(`  → ${options.duration.toFixed(1)} seconds = ${frames} frames at ${fps} FPS\n`);

  return options;
}

/**
 * Prompt for advanced options
 * @param {Object} options - Current options object
 * @param {Object} modelConfig - Selected model configuration
 * @param {Object} config - Additional configuration (isVideo, sogni, etc.)
 * @returns {Promise<Object>} Updated options
 */
export async function promptAdvancedOptions(options, modelConfig, config = {}) {
  const { isVideo = false, sogni = null } = config;

  console.log('\n🔧 Advanced Options\n');

  // Video-specific advanced options
  if (isVideo) {
    // FPS - use model-specific defaults
    const defaultFps = modelConfig.defaultFps || VIDEO_CONSTRAINTS.fps.default;
    const allowedFps = modelConfig.allowedFps || VIDEO_CONSTRAINTS.fps.allowedValues;
    console.log(`  FPS options: ${allowedFps.join(', ')}`);
    const fpsInput = await askQuestion(`  FPS (default: ${defaultFps}): `);
    if (fpsInput.trim()) {
      const f = parseInt(fpsInput.trim(), 10);
      if (allowedFps.includes(f)) {
        options.fps = f;
      }
    }
    if (!options.fps) options.fps = defaultFps;

    // Shift
    const defaultShift = modelConfig.defaultShift || VIDEO_CONSTRAINTS.shift.default;
    const shiftInput = await askQuestion(
      `  Shift (motion intensity, ${VIDEO_CONSTRAINTS.shift.min}-${VIDEO_CONSTRAINTS.shift.max}, default: ${defaultShift}): `
    );
    if (shiftInput.trim()) {
      const s = parseFloat(shiftInput.trim());
      if (s >= VIDEO_CONSTRAINTS.shift.min && s <= VIDEO_CONSTRAINTS.shift.max) {
        options.shift = s;
      }
    }
    if (options.shift === undefined) options.shift = defaultShift;
  }

  // Steps
  const defaultSteps = modelConfig.defaultSteps || 20;
  const minSteps = modelConfig.minSteps || 1;
  const maxSteps = modelConfig.maxSteps || 50;
  const stepsInput = await askQuestion(
    `Steps (${minSteps}-${maxSteps}, default: ${defaultSteps}): `
  );
  if (stepsInput.trim()) {
    const s = parseInt(stepsInput.trim(), 10);
    if (!isNaN(s) && s >= minSteps && s <= maxSteps) {
      options.steps = s;
    } else if (!isNaN(s)) {
      // Clamp to valid range
      options.steps = Math.max(minSteps, Math.min(maxSteps, s));
      console.log(`    (clamped to ${options.steps})`);
    }
  }
  if (options.steps === undefined) options.steps = defaultSteps;

  // Guidance (if supported by model)
  if (modelConfig.supportsGuidance !== false) {
    // Use model-specific guidance ranges
    const defaultGuidance = modelConfig.defaultGuidance || 4.0;
    const minGuidance = modelConfig.minGuidance || 1.5;
    const maxGuidance = modelConfig.maxGuidance || 8.0;
    const guidanceInput = await askQuestion(
      `Guidance scale (${minGuidance}-${maxGuidance}, default: ${defaultGuidance}): `
    );
    if (guidanceInput.trim()) {
      const g = parseFloat(guidanceInput.trim());
      if (!isNaN(g) && g >= minGuidance && g <= maxGuidance) {
        options.guidance = g;
      } else if (!isNaN(g)) {
        // Clamp to valid range
        options.guidance = Math.max(minGuidance, Math.min(maxGuidance, g));
        console.log(`    (clamped to ${options.guidance})`);
      }
    }
    if (options.guidance === undefined) options.guidance = defaultGuidance;
  }

  // Sampler - fetch dynamic options from SDK if available, fall back to model config
  let samplerData = null;
  if (sogni && modelConfig.id) {
    samplerData = await getSamplerOptions(sogni, modelConfig.id);
  }

  // Use dynamic options, then model config, then empty
  const availableSamplers = samplerData?.allowed || modelConfig.allowedComfySamplers || [];
  const defaultSampler =
    samplerData?.default ||
    modelConfig.defaultComfySampler ||
    modelConfig.defaultSampler ||
    'euler';

  if (availableSamplers.length > 0) {
    const defaultSamplerIdx = availableSamplers.indexOf(defaultSampler) + 1;

    console.log('\n  Samplers:');
    availableSamplers.forEach((sampler, i) => {
      const marker = sampler === defaultSampler ? ' (default)' : '';
      console.log(`    ${i + 1}. ${sampler}${marker}`);
    });
    const samplerInput = await askQuestion(
      `  Select sampler (default: ${defaultSamplerIdx || 1} - ${defaultSampler}): `
    );
    if (samplerInput.trim()) {
      const idx = parseInt(samplerInput.trim(), 10) - 1;
      if (idx >= 0 && idx < availableSamplers.length) {
        options.sampler = availableSamplers[idx];
      }
    }
  }
  // Set default if not selected
  if (!options.sampler) {
    options.sampler = defaultSampler;
  }

  // Scheduler - fetch dynamic options from SDK if available, fall back to model config
  let schedulerData = null;
  if (sogni && modelConfig.id) {
    schedulerData = await getSchedulerOptions(sogni, modelConfig.id);
  }

  // Use dynamic options, then model config, then empty
  const availableSchedulers = schedulerData?.allowed || modelConfig.allowedComfySchedulers || [];
  const defaultScheduler =
    schedulerData?.default ||
    modelConfig.defaultComfyScheduler ||
    modelConfig.defaultScheduler ||
    'simple';

  if (availableSchedulers.length > 0) {
    const defaultSchedulerIdx = availableSchedulers.indexOf(defaultScheduler) + 1;

    console.log('\n  Schedulers:');
    availableSchedulers.forEach((scheduler, i) => {
      const marker = scheduler === defaultScheduler ? ' (default)' : '';
      console.log(`    ${i + 1}. ${scheduler}${marker}`);
    });
    const schedulerInput = await askQuestion(
      `  Select scheduler (default: ${defaultSchedulerIdx || 1} - ${defaultScheduler}): `
    );
    if (schedulerInput.trim()) {
      const idx = parseInt(schedulerInput.trim(), 10) - 1;
      if (idx >= 0 && idx < availableSchedulers.length) {
        options.scheduler = availableSchedulers[idx];
      }
    }
  }
  // Set default if not selected
  if (!options.scheduler) {
    options.scheduler = defaultScheduler;
  }

  // Negative prompt
  const negativeInput = await askQuestion('\nNegative prompt (optional): ');
  if (negativeInput.trim()) {
    options.negative = negativeInput.trim();
  }

  // Seed
  console.log('\n  Seed (-1 for random, or specify a number for reproducible results)');
  const seedInput = await askQuestion('  Seed (default: -1): ');
  if (seedInput.trim()) {
    const seed = parseInt(seedInput.trim(), 10);
    if (!isNaN(seed)) {
      options.seed = seed;
    }
  }
  if (options.seed === undefined || options.seed === null) options.seed = -1;

  // Preview thumbnails (image workflows only)
  if (!isVideo) {
    console.log('\n  Preview thumbnails show generation progress (0 to disable)');
    const previewsInput = await askQuestion('  Number of preview thumbnails (default: 0): ');
    if (previewsInput.trim()) {
      const p = parseInt(previewsInput.trim(), 10);
      if (!isNaN(p) && p >= 0 && p <= 20) {
        options.previews = p;
      }
    }
    if (options.previews === undefined) options.previews = 0;
  }

  // Output format (image workflows only)
  if (!isVideo) {
    console.log('\n  Output Format:');
    console.log('    1. JPG - smaller files, lossy (default)');
    console.log('    2. PNG - larger files, lossless');
    const formatInput = await askQuestion('  Select output format (default: 1 - JPG): ');
    if (formatInput.trim() === '2' || formatInput.trim().toLowerCase() === 'png') {
      options.outputFormat = 'png';
    } else {
      options.outputFormat = 'jpg';
    }
  }

  return options;
}

/**
 * Prompt for batch count (number of images/videos to generate)
 * This should be called as the last question before job confirmation.
 * @param {Object} options - Current options object
 * @param {Object} config - Configuration options
 * @param {boolean} config.isVideo - Whether this is for video generation
 * @returns {Promise<Object>} Updated options
 */
export async function promptBatchCount(options, config = {}) {
  const { isVideo = false } = config;
  const maxBatch = 512;
  const mediaType = isVideo ? 'videos' : 'images';

  console.log(`\n📦 Batch Size\n`);
  const batchInput = await askQuestion(
    `  Number of ${mediaType} to generate (1-${maxBatch}, default: 1): `
  );
  if (batchInput.trim()) {
    const b = parseInt(batchInput.trim(), 10);
    if (b >= 1 && b <= maxBatch) {
      options.batch = b;
    }
  }
  if (!options.batch) options.batch = 1;

  return options;
}

/**
 * Prompt for S2V-specific options (audio start, duration)
 * @param {Object} options - Current options object
 * @param {number} audioDuration - Detected audio duration in seconds
 * @returns {Promise<Object>} Updated options
 */
export async function promptS2VOptions(options, audioDuration) {
  console.log('\n🎵 Sound-to-Video Options\n');
  console.log(`  Detected audio duration: ${audioDuration.toFixed(1)}s`);

  // Audio start position
  const audioStartInput = await askQuestion(
    `  Audio start position in seconds (0-${audioDuration.toFixed(1)}s, default: 0): `
  );
  if (audioStartInput.trim()) {
    const s = parseFloat(audioStartInput.trim());
    if (!isNaN(s) && s >= 0 && s < audioDuration) {
      options.audioStart = s;
    }
  }
  if (options.audioStart === undefined) options.audioStart = 0;

  // Audio duration (how much of the audio to use)
  const maxAudioDuration = audioDuration - options.audioStart;
  const audioLengthInput = await askQuestion(
    `  Audio duration to use (0-${maxAudioDuration.toFixed(1)}s, default: auto from video length): `
  );
  if (audioLengthInput.trim()) {
    const d = parseFloat(audioLengthInput.trim());
    if (!isNaN(d) && d > 0 && d <= maxAudioDuration) {
      options.audioDuration = d;
    }
  }

  return options;
}

/**
 * Prompt for animate-replace specific options (SAM2 coordinates)
 * @param {Object} options - Current options object
 * @returns {Promise<Object>} Updated options
 */
export async function promptAnimateReplaceOptions(options) {
  console.log('\n🎯 Subject Selection (SAM2 Coordinates)\n');
  console.log('  Click coordinates tell SAM2 which subject to replace.');
  console.log('  NOTE: Coordinates are in PIXELS at workflow resolution (832x1216).');
  console.log('  Leave empty to use workflow default (center of frame).');

  const coordsInput = await askQuestion('  Subject coordinates in pixels (default: center): ');
  if (coordsInput.trim()) {
    const parts = coordsInput.trim().split(',');
    if (parts.length >= 2) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (!isNaN(x) && !isNaN(y) && x >= 0 && y >= 0) {
        options.sam2Coordinates = JSON.stringify([{ x, y }]);
      }
    }
  }
  // Don't set default - let workflow use its pixel-based center coordinates
  // The workflow template has hardcoded pixel coords (e.g., [416, 608] for 832x1216)

  return options;
}

/**
 * Prompt for context images (Flux.2 Dev, Qwen Image Edit)
 * @param {Object} options - Current options object
 * @param {number} maxImages - Maximum number of context images supported
 * @returns {Promise<Object>} Updated options
 */
export async function promptContextImages(options, maxImages = 3) {
  console.log(`\n📸 Context/Reference Images (up to ${maxImages})\n`);
  console.log('  These provide additional style or content reference for the generation.');

  options.contextImages = options.contextImages || [];

  for (let i = 0; i < maxImages; i++) {
    const ordinal = i === 0 ? '1st' : i === 1 ? '2nd' : '3rd';
    const addMore = await askQuestion(`\n  Add ${ordinal} context image? [y/N]: `);

    if (addMore.toLowerCase() !== 'y' && addMore.toLowerCase() !== 'yes') {
      break;
    }

    try {
      const imagePath = await pickImageFile(null, `context image ${i + 1}`);
      options.contextImages.push(imagePath);
      log('✓', `Added context image ${i + 1}: ${imagePath}`);
    } catch (error) {
      log('⚠️', `Could not add context image: ${error.message}`);
      break;
    }
  }

  return options;
}

/**
 * Log helper function with icon
 */
export function log(icon, message) {
  console.log(`${icon} ${message}`);
}

/**
 * Format duration as mm:ss
 */
export function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Display configuration summary
 */
export function displayConfig(title, config) {
  const boxInnerWidth = 58;
  const labelWidth = 16;
  const valueWidth = boxInnerWidth - labelWidth;

  console.log();
  console.log('┌' + '─'.repeat(boxInnerWidth) + '┐');
  console.log('│ ' + title.padEnd(boxInnerWidth - 2) + ' │');
  console.log('├' + '─'.repeat(boxInnerWidth) + '┤');

  for (const [label, value] of Object.entries(config)) {
    if (value !== undefined && value !== null && value !== '') {
      const labelStr = (label + ':').padEnd(labelWidth);
      const valueStr = String(value);

      // For longer values (like prompts), wrap them
      if (valueStr.length > valueWidth - 2) {
        // First line with label
        const firstChunk = valueStr.substring(0, valueWidth - 2);
        console.log('│ ' + labelStr + ' ' + firstChunk.padEnd(valueWidth - 3) + ' │');
        // Continuation lines
        let remaining = valueStr.substring(valueWidth - 2);
        while (remaining.length > 0) {
          const chunk = remaining.substring(0, valueWidth - 2);
          console.log('│ ' + ' '.repeat(labelWidth) + ' ' + chunk.padEnd(valueWidth - 3) + ' │');
          remaining = remaining.substring(valueWidth - 2);
        }
      } else {
        console.log('│ ' + labelStr + ' ' + valueStr.padEnd(valueWidth - 3) + ' │');
      }
    }
  }

  console.log('└' + '─'.repeat(boxInnerWidth) + '┘');
}

/**
 * Display prompts summary
 */
export function displayPrompts(prompts) {
  console.log();
  console.log('📝 Prompts:');
  if (prompts.positive) {
    const truncated =
      prompts.positive.length > 100 ? prompts.positive.substring(0, 100) + '...' : prompts.positive;
    console.log(`   Positive: ${truncated}`);
  }
  if (prompts.negative) {
    console.log(`   Negative: ${prompts.negative}`);
  }
  if (prompts.style) {
    console.log(`   Style: ${prompts.style}`);
  }
  console.log();
}

// ============================================
// File Reading for SDK Upload
// ============================================

/**
 * Read a file from disk as a Blob for SDK upload.
 * The SDK requires File/Buffer/Blob objects, NOT string paths.
 * Passing a string path will silently fail and corrupt the upload.
 *
 * NOTE: We return a Blob because the SDK's toFetchBody() function
 * explicitly handles File, Buffer, and Blob types. Uint8Array is NOT
 * handled and will fail silently.
 *
 * @param {string} filePath - Path to the file
 * @returns {Blob} File contents as a Blob
 */
export function readFileAsBuffer(filePath) {
  if (!filePath) {
    throw new Error('File path is required');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  // Read file as Buffer
  const buffer = fs.readFileSync(filePath);

  // CRITICAL: Node.js Buffer may be backed by a pooled ArrayBuffer.
  // We must slice to get ONLY our file's data, not the entire pool.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  // Return as Blob - this is what the SDK's toFetchBody() expects
  return new Blob([arrayBuffer]);
}

/**
 * Read multiple files from disk as Uint8Arrays for SDK upload.
 *
 * @param {string[]} filePaths - Array of file paths
 * @returns {Uint8Array[]} Array of file contents as Uint8Arrays
 */
export function readFilesAsBuffers(filePaths) {
  return filePaths.filter(Boolean).map(readFileAsBuffer);
}

/**
 * Convert text to kebab-case, keeping only alphanumeric characters and hyphens.
 * @param {string} text - Text to convert
 * @param {number} maxLength - Maximum length of output (default: 30)
 * @returns {string} Kebab-case string
 */
export function toKebabCase(text, maxLength = 30) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    .substring(0, maxLength) // Limit length
    .replace(/-$/, ''); // Remove trailing hyphen after truncation
}

/**
 * Generate a random seed for reproducible generation.
 * @returns {number} Random seed between 0 and 2147483647 (max 32-bit signed int)
 */
export function generateRandomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

/**
 * Generate a descriptive video filename based on generation parameters.
 * Format: ${modelId}-${seconds}s-${width}x${height}-${fps}fps-${seed}-${genTime}s-${prompt}.mp4
 *
 * @param {Object} params - Generation parameters
 * @param {string} params.modelId - Model identifier (will be kebab-cased)
 * @param {number} params.frames - Number of frames
 * @param {number} params.fps - Frames per second
 * @param {number} params.width - Video width
 * @param {number} params.height - Video height
 * @param {number} params.seed - Random seed (should be actual seed, not -1)
 * @param {string} params.prompt - Generation prompt
 * @param {number} [params.generationTime] - Generation time in seconds
 * @param {string} [params.outputDir] - Output directory (default: './output')
 * @returns {string} Generated filename path
 *
 * @example
 * generateVideoFilename({
 *   modelId: 'ltx2-19b-fp8_t2v_distilled',
 *   frames: 505,
 *   fps: 25,
 *   width: 1920,
 *   height: 1088,
 *   seed: 12345,
 *   prompt: 'A futuristic city at night with neon lights',
 *   generationTime: 45.2,
 *   outputDir: './output'
 * })
 * // => './output/ltx2-19b-fp8-t2v-distilled-20s-1920x1088-25fps-12345-45s-a-futuristic-city-at-night-with-neon-lights.mp4'
 */
export function generateVideoFilename(params) {
  const {
    modelId,
    frames,
    fps,
    width,
    height,
    seed,
    prompt,
    generationTime,
    outputDir = './output'
  } = params;

  // Convert model ID to kebab-case (replace underscores with hyphens)
  const modelSlug = modelId
    .replace(/_/g, '-')
    .replace(/\./g, '-')
    .toLowerCase();

  // Calculate duration in seconds from frames and fps
  const durationSeconds = Math.round((frames - 1) / fps);

  // Format seed (use actual value)
  const seedStr = seed !== undefined && seed !== null ? String(seed) : 'unknown';

  // Format generation time if provided
  const genTimeStr = generationTime !== undefined ? `${Math.round(generationTime)}s` : null;

  // Convert prompt to kebab-case (first 54 chars)
  const promptSlug = toKebabCase(prompt, 72);

  // Build filename with optional generation time
  const parts = [
    modelSlug,
    `${durationSeconds}s`,
    `${width}x${height}`,
    `${fps}fps`,
    seedStr
  ];
  if (genTimeStr) {
    parts.push(genTimeStr);
  }
  parts.push(promptSlug);

  const filename = `${parts.join('-')}.mp4`;

  return path.join(outputDir, filename);
}

/**
 * Generate a descriptive image filename based on generation parameters.
 * Format: ${modelId}-${width}x${height}-${seed}-${genTime}s-${prompt}.${ext}
 *
 * @param {Object} params - Generation parameters
 * @param {string} params.modelId - Model identifier (will be kebab-cased)
 * @param {number} params.width - Image width
 * @param {number} params.height - Image height
 * @param {number} params.seed - Random seed (should be actual seed, not -1)
 * @param {string} params.prompt - Generation prompt
 * @param {number} [params.generationTime] - Generation time in seconds
 * @param {string} [params.outputFormat] - Output format (default: 'jpg')
 * @param {string} [params.outputDir] - Output directory (default: './output')
 * @returns {string} Generated filename path
 *
 * @example
 * generateImageFilename({
 *   modelId: 'chroma-v46-flash',
 *   width: 1024,
 *   height: 1024,
 *   seed: 12345,
 *   prompt: 'A beautiful sunset over mountains',
 *   generationTime: 3.5,
 *   outputDir: './output'
 * })
 * // => './output/chroma-v46-flash-1024x1024-12345-4s-a-beautiful-sunset-over-mountains.jpg'
 */
export function generateImageFilename(params) {
  const {
    modelId,
    width,
    height,
    seed,
    prompt,
    generationTime,
    outputFormat = 'jpg',
    outputDir = './output'
  } = params;

  // Convert model ID to kebab-case (replace underscores with hyphens)
  const modelSlug = modelId
    .replace(/_/g, '-')
    .replace(/\./g, '-')
    .toLowerCase();

  // Format seed (use actual value)
  const seedStr = seed !== undefined && seed !== null ? String(seed) : 'unknown';

  // Format generation time if provided
  const genTimeStr = generationTime !== undefined ? `${Math.round(generationTime)}s` : null;

  // Convert prompt to kebab-case (first 54 chars)
  const promptSlug = toKebabCase(prompt, 72);

  // Build filename with optional generation time
  const parts = [
    modelSlug,
    `${width}x${height}`,
    seedStr
  ];
  if (genTimeStr) {
    parts.push(genTimeStr);
  }
  parts.push(promptSlug);

  const ext = outputFormat === 'png' ? 'png' : 'jpg';
  const filename = `${parts.join('-')}.${ext}`;

  return path.join(outputDir, filename);
}

/**
 * Generate a unique filename by incrementing a counter if the file already exists.
 * If the file doesn't exist, returns the original path.
 * If it does exist, appends _1, _2, _3, etc. before the extension.
 *
 * @param {string} outputPath - Desired output path (e.g., "./output/myfile.jpg")
 * @returns {string} Unique output path that doesn't conflict with existing files
 *
 * @example
 * // If output/test.jpg doesn't exist:
 * getUniqueFilename('./output/test.jpg') // => './output/test.jpg'
 *
 * // If output/test.jpg exists but output/test_1.jpg doesn't:
 * getUniqueFilename('./output/test.jpg') // => './output/test_1.jpg'
 *
 * // If output/test.jpg and output/test_1.jpg exist:
 * getUniqueFilename('./output/test.jpg') // => './output/test_2.jpg'
 */
export function getUniqueFilename(outputPath) {
  if (!fs.existsSync(outputPath)) {
    return outputPath;
  }

  const parsedPath = path.parse(outputPath);
  let counter = 1;
  let uniquePath;

  do {
    const newName = `${parsedPath.name}_${counter}${parsedPath.ext}`;
    uniquePath = path.join(parsedPath.dir, newName);
    counter++;
  } while (fs.existsSync(uniquePath));

  return uniquePath;
}
