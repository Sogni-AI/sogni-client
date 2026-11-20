/**
 * The server refused to cancel a project. With `code: 'vendorCannotCancel'`, a
 * third-party provider could not stop work it had already started: those jobs
 * (`finishingJobIds`) keep running, deliver and are charged like any completed
 * render, and the project stays tracked.
 */
export default class ProjectCancellationRefusedError extends Error {
  readonly name = 'ProjectCancellationRefusedError';

  constructor(
    message: string,
    public readonly code?: string,
    public readonly finishingJobIds: string[] = []
  ) {
    super(message);
  }
}
