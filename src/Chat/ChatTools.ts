import type ProjectsApi from '../Projects';
import type { AvailableModel } from '../Projects/types';
import { isSogniToolCall, parseToolCallArguments } from './tools';
import {
  ToolCall,
  ToolExecutionOptions,
  ToolExecutionProgress,
  ToolExecutionResult
} from './types';

/** Default timeout for media generation: 10 minutes. */
const DEFAULT_TIMEOUT = 10 * 60 * 1000;

/**
 * API for executing Sogni platform tool calls (image, video, music generation).
 *
 * Accessed via `sogni.chat.tools`. Provides methods to execute tool calls returned
 * by the LLM, mapping them to `sogni.projects.create()` calls automatically.
 *
 * @example
 * ```typescript
 * // Execute a single tool call
 * const result = await sogni.chat.tools.execute(toolCall, {
 *   tokenType: 'sogni',
 *   onProgress: (p) => console.log(`${p.status}: ${p.percent}%`),
 * });
 *
 * // Execute all tool calls from a completion
 * const results = await sogni.chat.tools.executeAll(result.tool_calls, {
 *   onToolCall: async (tc) => myCustomHandler(tc), // for non-Sogni tools
 * });
 * ```
 */
class ChatToolsApi {
  private projects: ProjectsApi;

  constructor(projects: ProjectsApi) {
    this.projects = projects;
  }

  /**
   * Execute a single Sogni platform tool call.
   *
   * Maps tool call arguments to `sogni.projects.create()`, waits for the media
   * generation to complete, and returns the result URLs.
   *
   * @throws Error if the tool call is not a Sogni tool (use `isSogniToolCall()` to check first)
   */
  async execute(toolCall: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecutionResult> {
    if (!this.projects) {
      throw new Error(
        'ChatToolsApi requires ProjectsApi. Ensure SogniClient was properly initialized via SogniClient.createInstance().'
      );
    }
    if (!isSogniToolCall(toolCall)) {
      throw new Error(
        `Not a Sogni tool call: ${toolCall.function.name}. Use isSogniToolCall() to check first.`
      );
    }

    const args = parseToolCallArguments(toolCall);
    const name = toolCall.function.name;

    try {
      switch (name) {
        case 'sogni_generate_image':
          return await this.executeImageGeneration(toolCall, args, options);
        case 'sogni_generate_video':
          return await this.executeVideoGeneration(toolCall, args, options);
        case 'sogni_generate_music':
          return await this.executeMusicGeneration(toolCall, args, options);
        default:
          return this.makeErrorResult(toolCall, `Unknown Sogni tool: ${name}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return this.makeErrorResult(toolCall, error);
    }
  }

  /**
   * Execute multiple tool calls from a single LLM response.
   *
   * Sogni tool calls (prefixed with `sogni_`) are executed automatically via
   * `projects.create()`. Non-Sogni tool calls are delegated to the `onToolCall`
   * callback if provided, or returned as errors.
   *
   * @param toolCalls - Array of tool calls from `result.tool_calls`
   * @param options - Execution options plus optional handler for non-Sogni tools
   */
  async executeAll(
    toolCalls: ToolCall[],
    options?: ToolExecutionOptions & {
      /** Handler for non-Sogni tool calls. Must return the tool result content string. */
      onToolCall?: (toolCall: ToolCall) => Promise<string>;
      /** Per-tool progress callback (wraps the per-tool onProgress with tool identity). */
      onToolProgress?: (toolCall: ToolCall, progress: ToolExecutionProgress) => void;
    }
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const toolCall of toolCalls) {
      if (isSogniToolCall(toolCall)) {
        const execOptions: ToolExecutionOptions = {
          tokenType: options?.tokenType,
          network: options?.network,
          numberOfMedia: options?.numberOfMedia,
          timeout: options?.timeout,
          onProgress: options?.onToolProgress
            ? (progress: ToolExecutionProgress) => options.onToolProgress!(toolCall, progress)
            : options?.onProgress
        };
        results.push(await this.execute(toolCall, execOptions));
      } else if (options?.onToolCall) {
        try {
          const content = await options.onToolCall(toolCall);
          results.push({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            resultUrls: [],
            content
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          results.push(this.makeErrorResult(toolCall, error));
        }
      } else {
        results.push(
          this.makeErrorResult(
            toolCall,
            `No handler for non-Sogni tool: ${toolCall.function.name}. Provide an onToolCall callback.`
          )
        );
      }
    }

    return results;
  }

  /**
   * Get the default model for a media type. For video, prefers LTX-2.3 t2v models.
   * Falls back to the model with the most available workers.
   */
  private async getDefaultModel(mediaType: 'image' | 'video' | 'audio'): Promise<string> {
    const models: AvailableModel[] = await this.projects.waitForModels(10000);
    const candidates = models.filter((m) => m.media === mediaType);
    if (candidates.length === 0) {
      throw new Error(`No ${mediaType} models currently available on the network`);
    }

    // For video, prefer LTX-2.3 text-to-video models
    if (mediaType === 'video') {
      const ltx2 = candidates.filter((m) => m.id.includes('ltx2') && m.id.includes('t2v'));
      if (ltx2.length > 0) {
        ltx2.sort((a, b) => b.workerCount - a.workerCount);
        return ltx2[0].id;
      }
    }

    // Default: pick the model with most workers (highest availability)
    candidates.sort((a, b) => b.workerCount - a.workerCount);
    return candidates[0].id;
  }

  /**
   * Create a project, wait for completion with timeout, track per-job progress,
   * and clean up on failure or timeout.
   */
  private async executeProject(
    toolCall: ToolCall,
    mediaType: 'image' | 'video' | 'audio',
    modelId: string,
    projectParams: Record<string, unknown>,
    prompt: string,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    options?.onProgress?.({ status: 'creating', percent: 0 });

    const project = await this.projects.create(projectParams as any);
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let jobsCompleted = 0;
    let jobsFailed = 0;
    const totalJobs = (projectParams.numberOfMedia as number) || 1;

    // Track per-job progress via project events
    const onJobCompleted = () => {
      jobsCompleted++;
      const percent = Math.round((jobsCompleted / totalJobs) * 100);
      options?.onProgress?.({ status: 'processing', percent });
    };
    const onJobFailed = () => {
      jobsFailed++;
    };

    // Track step-level progress via project progress event
    const onProgress = (percent: number) => {
      options?.onProgress?.({
        status: 'processing',
        percent: Number.isFinite(percent) ? percent : 0
      });
    };

    project.on('progress', onProgress);
    project.on('jobCompleted', onJobCompleted);
    project.on('jobFailed', onJobFailed);

    options?.onProgress?.({ status: 'queued', percent: 0 });

    try {
      const resultUrls = await Promise.race<string[]>([
        project.waitForCompletion(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `${mediaType} generation timed out after ${Math.round(timeout / 1000)}s ` +
                  `(project: ${project.id}, jobs: ${jobsCompleted}/${totalJobs} completed, ${jobsFailed} failed). ` +
                  `Increase the timeout option or check network worker availability.`
              )
            );
          }, timeout);
        })
      ]);

      options?.onProgress?.({ status: 'completed', percent: 100, resultUrls });

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        resultUrls,
        content: JSON.stringify({
          success: true,
          media_type: mediaType,
          urls: resultUrls,
          model: modelId,
          prompt
        })
      };
    } catch (err) {
      // Attempt to cancel the project on timeout to free worker resources
      try {
        await project.cancel();
      } catch {
        /* best-effort */
      }

      options?.onProgress?.({ status: 'failed', percent: 0 });

      throw err;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      project.off('progress', onProgress);
      project.off('jobCompleted', onJobCompleted);
      project.off('jobFailed', onJobFailed);
    }
  }

  private async executeImageGeneration(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const modelId = (args.model as string) || (await this.getDefaultModel('image'));

    const projectParams: Record<string, unknown> = {
      type: 'image' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: options?.numberOfMedia || 1
    };
    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.width && args.height) {
      projectParams.width = args.width;
      projectParams.height = args.height;
      projectParams.sizePreset = 'custom';
    }
    if (args.steps !== undefined) projectParams.steps = args.steps;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'image',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeVideoGeneration(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const modelId = (args.model as string) || (await this.getDefaultModel('video'));

    // LTX-2.3 defaults: 1920x1088 landscape, 24fps
    const isLtx2 = modelId.includes('ltx2');
    const defaultWidth = isLtx2 ? 1920 : 848;
    const defaultHeight = isLtx2 ? 1088 : 480;
    const defaultFps = isLtx2 ? 24 : 16;

    const projectParams: Record<string, unknown> = {
      type: 'video' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: options?.numberOfMedia || 1,
      width: (args.width as number) || defaultWidth,
      height: (args.height as number) || defaultHeight,
      fps: (args.fps as number) || defaultFps
    };
    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.duration !== undefined) projectParams.duration = args.duration;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'video',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeMusicGeneration(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const modelId = (args.model as string) || (await this.getDefaultModel('audio'));

    const projectParams: Record<string, unknown> = {
      type: 'audio' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: options?.numberOfMedia || 1
    };
    if (args.duration !== undefined) projectParams.duration = args.duration;
    if (args.bpm !== undefined) projectParams.bpm = args.bpm;
    if (args.keyscale) projectParams.keyscale = args.keyscale;
    if (args.timesignature) projectParams.timesignature = args.timesignature;
    if (args.output_format) projectParams.outputFormat = args.output_format;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'audio',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private makeErrorResult(toolCall: ToolCall, error: string): ToolExecutionResult {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: false,
      resultUrls: [],
      content: JSON.stringify({ success: false, error }),
      error
    };
  }
}

export default ChatToolsApi;
