import { ProjectParams } from './types';

function createJobRequestMessage(id: string, params: ProjectParams) {
  return {
    keyFrames: [
      {
        scheduler: params.scheduler,
        steps: params.steps,
        guidanceScale: params.guidance,
        modelID: params.modelId,
        negativePrompt: params.negativePrompt,
        seed: params.seed,
        positivePrompt: params.positivePrompt,
        stylePrompt: params.stylePrompt,
        hasStartingImage: !!params.startingImage,
        strengthIsEnabled: !!params.startingImage,
        strength: !!params.startingImage
          ? 1 - (Number(params.startingImageStrength) || 0.5)
          : undefined
      }
    ],
    previews: params.numberOfPreviews || 0,
    numberOfImages: params.numberOfImages,
    jobID: id
  };
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;

/*
Full request sample
const jobRequest = {
  selectedUpscalingModel: 'OFF',
  cnVideoFramesSketch: [],
  cnVideoFramesSegmentedSubject: [],
  cnVideoFramesFace: [],
  doCanvasBlending: false,
  animationIsOn: false,
  cnVideoFramesBoth: [],
  cnVideoFramesDepth: [],
  keyFrames: [
  {
    stepsIsEnabled: true,
    siRotation: 0,
    siDragOffsetIsEnabled: true,
    strength: 0.5,
    siZoomScaleIsEnabled: true,
    isEnabled: true,
    processing: 'CPU, GPU',
    useLastImageAsGuideImageInAnimation: true,
    guidanceScaleIsEnabled: true,
    siImageBackgroundColor: 'black',
    cnDragOffset: [0, 0],
    scheduler: 'DPM Solver Multistep (DPM-Solver++)',
    timeStepSpacing: 'Linear',
    steps: 20,
    cnRotation: 0,
    guidanceScale: 7.5,
    siZoomScale: 1,
    modelID: '',
    cnRotationIsEnabled: true,
    negativePrompt: '',
    startingImageZoomPanIsOn: false,
    seed: '1237846',
    siRotationIsEnabled: true,
    cnImageBackgroundColor: 'clear',
    strengthIsEnabled: true,
    siDragOffset: [0, 0],
    useLastImageAsCNImageInAnimation: false,
    positivePrompt: '',
    controlNetZoomPanIsOn: false,
    cnZoomScaleIsEnabled: true,
    currentControlNets: null,
    stylePrompt: '',
    cnDragOffsetIsEnabled: true,
    frameIndex: 0,
    startingImage: null,
    cnZoomScale: 1
  }
],
  previews: params.numberOfPreviews || 5,
  frameRate: 24,
  generatedVideoSeconds: 10,
  canvasIsOn: false,
  cnVideoFrames: [],
  disableSafety: false,
  cnVideoFramesSegmentedBackground: [],
  cnVideoFramesSegmented: [],
  numberOfImages: params.numberOfImages,
  cnVideoFramesPose: [],
  jobID: id,
  siVideoFrames: []
};

 */
