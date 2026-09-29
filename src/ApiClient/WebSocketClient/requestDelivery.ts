/** Shared by direct socket sends and requests forwarded by another browser tab. */
export const SEND_READY_TIMEOUT_MS = 30_000;

// Give the socket's readiness failure time to reach the requesting tab. An ACK
// timeout is ambiguous: the socket may already have sent the request.
export const REQUEST_ACK_TIMEOUT_MS = SEND_READY_TIMEOUT_MS + 5_000;

export class MessageDeliveryUncertainError extends Error {
  constructor() {
    // Keeps the message of the plain Error it replaces: consumers match on it.
    super('Message delivery timeout');
    this.name = 'MessageDeliveryUncertainError';
  }
}
