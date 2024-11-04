import ApiGroup, { ApiConfig } from '../ApiGroup';
import models from './models.json';
import { EstimateRequest, ImageUrlParams, ProjectParams } from './types';
import {
  JobErrorData,
  JobProgressData,
  JobResultData,
  JobStateData,
  SocketEventMap
} from '../ApiClient/WebSocketClient/events';
import AvailableModels, { AvailableModelsData } from './AvailableModels';
import Project from './Project';
import createJobRequestMessage from './createJobRequestMessage';
import { ApiReponse } from '../ApiClient/ApiClient';
import { EstimationResponse } from './types/EstimationResponse';

class Projects extends ApiGroup {
  readonly awailableModels = new AvailableModels({ list: [], index: {} });
  private projects: Project[] = [];

  constructor(config: ApiConfig) {
    super(config);
    this.client.socket.on('swarmModels', this.handleSwarmModels.bind(this));
    this.client.socket.on('jobState', this.handleJobState.bind(this));
    this.client.socket.on('jobProgress', this.handleJobProgress.bind(this));
    this.client.socket.on('jobError', this.handleJobError.bind(this));
    this.client.socket.on('jobResult', this.handleJobResult.bind(this));
    this.client.on('disconnected', this.handleServerDisconnected.bind(this));
  }

  private handleSwarmModels(data: SocketEventMap['swarmModels']) {
    const modelsData = models.reduce(
      (acc: AvailableModelsData, model) => {
        if (data[model.modelId]) {
          const item = { id: model.modelId, name: model.modelShortName };
          acc.index[item.id] = item;
          acc.list.push(item);
        }
        return acc;
      },
      { list: [], index: {} }
    );
    this.awailableModels._update(modelsData);
  }

  private handleJobState(data: JobStateData) {
    const project = this.projects.find((p) => p.id === data.jobID);
    if (!project) {
      return;
    }
    switch (data.type) {
      case 'queued':
        project._update({
          status: 'queued',
          queuePosition: data.queuePosition
        });
        break;
      case 'jobCompleted':
        project._update({ status: 'completed' });
        break;
      case 'initiatingModel':
      case 'jobStarted': {
        const status = data.type === 'initiatingModel' ? 'initiating' : 'started';
        const job = project.job(data.imgID);
        if (job) {
          job._update({ status });
        } else {
          project._addJob({
            id: data.imgID,
            status,
            step: 0,
            stepCount: project.params.steps
          });
        }
        break;
      }
    }
  }

  private handleJobProgress(data: JobProgressData) {
    const project = this.projects.find((p) => p.id === data.jobID);
    if (!project) {
      return;
    }
    let job = project.job(data.imgID);
    if (job) {
      job._update({
        status: 'creating',
        step: data.step,
        stepCount: data.stepCount
      });
    } else {
      job = project._addJob({
        id: data.imgID,
        status: 'creating',
        step: data.step,
        stepCount: data.stepCount
      });
    }
    if (data.hasImage) {
      this.downloadUrl({
        jobId: project.id,
        imageId: job.id,
        type: 'preview'
      }).then((url) => {
        job._update({ previewUrl: url });
      });
    }
  }

  private handleJobResult(data: JobResultData) {
    const project = this.projects.find((p) => p.id === data.jobID);
    if (!project) {
      return;
    }
    let job = project.job(data.imgID);
    if (job) {
      job._update({
        status: 'completed',
        step: data.performedStepCount
      });
    } else {
      job = project._addJob({
        id: data.imgID,
        status: 'completed',
        step: data.performedStepCount,
        stepCount: project.params.steps
      });
    }
    this.downloadUrl({
      jobId: project.id,
      imageId: job.id,
      type: 'complete'
    }).then((url) => {
      job?._update({ resultUrl: url });
    });
  }

  private handleJobError(data: JobErrorData) {
    const project = this.projects.find((p) => p.id === data.jobID);
    if (!project) {
      return;
    }
    if (!data.imgID) {
      project._update({
        status: 'failed',
        error: {
          code: data.error,
          message: data.error_message
        }
      });
      return;
    }
    const job = project.job(data.imgID);
    if (!job) {
      project._addJob({
        id: data.imgID,
        status: 'failed',
        step: 0,
        stepCount: project.params.steps,
        error: {
          code: data.error,
          message: data.error_message
        }
      });
    } else {
      job._update({
        status: 'failed',
        error: {
          code: data.error,
          message: data.error_message
        }
      });
    }
  }

  private handleServerDisconnected() {
    this.awailableModels._update({ list: [], index: {} });
  }

  /**
   * Send new project request to the network. Returns project instance which can be used to track
   * progress and get resulting images.
   * @param data
   */
  async create(data: ProjectParams): Promise<Project> {
    const project = new Project({ ...data });
    const request = createJobRequestMessage(project.id, data);
    await this.client.socket.send('jobRequest', request);
    this.projects.push(project);
    return project;
  }

  /**
   * Estimate project cost
   * @param network - either 'fast' or 'relaxed' network
   * @param model - model id
   * @param imageCount - number of images to generate
   * @param stepCount - number of steps
   * @param previewCount - number of preview images to request
   * @param cnEnabled - control network enabled
   * @param denoiseStrength - denoise strength
   */
  async estimateCost({
    network,
    model,
    imageCount,
    stepCount,
    previewCount,
    cnEnabled,
    denoiseStrength
  }: EstimateRequest) {
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v1/job/estimate/${network}/${model}/${imageCount}/${stepCount}/${previewCount}/${cnEnabled ? 1 : 0}/${denoiseStrength || 0}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD
    };
  }

  async uploadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiReponse<{ uploadUrl: string }>>(
      `/v1/image/uploadUrl`,
      params
    );
    return r.data.uploadUrl;
  }

  async downloadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiReponse<{ downloadUrl: string }>>(
      `/v1/image/downloadUrl`,
      params
    );
    return r.data.downloadUrl;
  }
}

export default Projects;
