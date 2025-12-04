import getUUID from '../../../lib/getUUID';
import { Logger } from '../../../lib/DefaultLogger';

const PRIMARY_HEARTBEAT_INTERVAL = 2000;
const PRIMARY_TIMEOUT = 4000;
const ACK_TIMEOUT = 5000;

enum MessageType {
  ELECTION = 'election',
  ELECTION_RESPONSE = 'election_response',
  PRIMARY_ANNOUNCE = 'primary_announce',
  PRIMARY_HEARTBEAT = 'primary_heartbeat',
  BROADCAST = 'broadcast',
  REQUEST = 'request',
  REQUEST_ACK = 'request_ack'
}

interface Election {
  type: MessageType.ELECTION;
  payload: { priority: number };
}

interface ElectionResponse {
  type: MessageType.ELECTION_RESPONSE;
  payload: { id: string; priority: number };
}

interface PrimaryAnnounce {
  type: MessageType.PRIMARY_ANNOUNCE;
  payload: { id: string; priority: number };
}

interface PrimaryHeartbeat {
  type: MessageType.PRIMARY_HEARTBEAT;
  payload: { id: string; priority: number };
}

interface BroadcastMessage {
  type: MessageType.BROADCAST;
  payload: any;
}

interface RequestMessage {
  type: MessageType.REQUEST;
  payload: any;
}

interface RequestAckMessage {
  type: MessageType.REQUEST_ACK;
  payload: { id: string; error?: any };
}

type Message =
  | Election
  | ElectionResponse
  | PrimaryAnnounce
  | PrimaryHeartbeat
  | BroadcastMessage
  | RequestMessage
  | RequestAckMessage;

interface Envelope {
  id: string;
  senderId: string;
  recipientId?: string;
  timestamp: number;
  message: Message;
}

const CHANNEL_NAME = 'sogni-websocket-channel';

let isActiveTab = false;
if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
  isActiveTab = window.document.visibilityState === 'visible';
  window.addEventListener(
    'visibilitychange',
    () => (isActiveTab = window.document.visibilityState === 'visible')
  );
}

interface Callbacks<M, N> {
  onRoleChange: (isPrimary: boolean) => void;
  onMessage: (message: M) => Promise<void>;
  onNotification: (notification: N) => void;
}

interface Options<M, N> {
  callbacks: Callbacks<M, N>;
  logger: Logger;
}

/**
 * A class responsible for coordinating communication across browser tabs or windows via BroadcastChannel API.
 * It handles the role election of the primary (leader) tab, message broadcasting, heartbeats for primary tab monitoring,
 * and message acknowledgment for reliable communication.
 *
 * The `ChannelCoordinator` ensures that one tab per session is assigned as the primary, while allowing others to act as secondaries,
 * utilizing various message types for communication and coordination.
 *
 * Message is sent by secondary tabs to the primary tab via the `sendMessage` method. By sending message
 * tab can tell primary to connect, disconnect, send message to socket etc.
 *
 * Notification is type of message broadcasted by primary to secondary tabs. This is mostly used to
 * broadcast socket events from primary to secondary tabs.
 *
 * @template M - The type of messages being broadcast to other tabs/windows.
 * @template N - The type of notifications being handled within the coordinator.
 */
class ChannelCoordinator<M, N> {
  private readonly id: string = getUUID();
  private priority = Date.now();
  private readonly channel = new BroadcastChannel(CHANNEL_NAME);

  private _isPrimary = false;
  private callbacks: Callbacks<M, N>;
  private logger: Logger;

  private ackCallbacks: Record<string, (error?: any) => void> = {};

  // User to handle election of primary tab
  private electionInProgress: boolean = false;
  private electionResponses: Map<string, number> = new Map();

  // Heartbeat to detect primary tab death
  private lastPrimaryHeartbeat: number = Date.now();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private primaryCheckTimer: NodeJS.Timeout | null = null;
  private readyCallback: () => void | null = () => {};
  private readonly readyPromise: Promise<void>;

  constructor({ callbacks, logger }: Options<M, N>) {
    this.readyPromise = new Promise((resolve) => {
      let called = false;
      this.readyCallback = () => {
        if (!called) {
          called = true;
          resolve();
        }
      };
    });
    this.callbacks = callbacks;
    this.logger = logger;
    this.channel.addEventListener('message', (event) => this.handleMessage(event.data));
    this.startElections();
    this.startPrimaryMonitor();
    // Listen for tab closing to gracefully release primary role
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.priority = 0;
        this.startElections();
      });
    }
  }

  get isPrimary() {
    return this._isPrimary;
  }

  private get currentPriority() {
    return isActiveTab ? this.priority * 10 : this.priority;
  }

  isReady() {
    return this.readyPromise;
  }

  private startElections() {
    this.logger.debug(
      `Start primary elections, my priority is ${this.currentPriority}, tab visibility is ${isActiveTab}`
    );
    this.electionInProgress = true;
    this.electionResponses.clear();
    this.electionResponses.set(this.id, this.currentPriority);
    this.broadcast({
      type: MessageType.ELECTION,
      payload: { priority: this.currentPriority }
    });
    setTimeout(() => {
      this.finishElections();
    }, 500);
  }

  private finishElections() {
    if (!this.electionInProgress) {
      return;
    }
    // Find highest priority
    let highestPriority = -Infinity;
    let winnerId: string | null = null;

    for (const [id, priority] of this.electionResponses) {
      if (priority > highestPriority || (priority === highestPriority && id > (winnerId || ''))) {
        highestPriority = priority;
        winnerId = id;
      }
    }

    if (winnerId === this.id) {
      this.becomePrimary();
      this.logger.debug(`Won elections! ${winnerId}`);
    } else {
      this.logger.debug(`Lost elections! Winner is ${winnerId}`);
    }

    this.electionInProgress = false;
    this.electionResponses.clear();
  }

  private becomePrimary() {
    this._isPrimary = true;
    this.lastPrimaryHeartbeat = Date.now();
    this.broadcast({
      type: MessageType.PRIMARY_ANNOUNCE,
      payload: { id: this.id, priority: this.currentPriority }
    });
    this.startHeartbeat();
    this.callbacks.onRoleChange(true);
    this.readyCallback();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this._isPrimary) {
        this.broadcast({
          type: MessageType.PRIMARY_HEARTBEAT,
          payload: { id: this.id, priority: this.currentPriority }
        });
      } else {
        this.stopHeartbeat();
      }
    }, PRIMARY_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startPrimaryMonitor(): void {
    if (this.primaryCheckTimer) {
      clearInterval(this.primaryCheckTimer);
    }
    this.primaryCheckTimer = setInterval(() => {
      if (!this._isPrimary) {
        const timeSinceLastHeartbeat = Date.now() - this.lastPrimaryHeartbeat;
        if (timeSinceLastHeartbeat > PRIMARY_TIMEOUT) {
          this.startElections();
        }
      } else {
        this.lastPrimaryHeartbeat = Date.now();
      }
    }, PRIMARY_HEARTBEAT_INTERVAL);
  }

  private handleMessage(envelope: Envelope) {
    const { senderId, recipientId, message } = envelope;
    const isForOtherClient = recipientId && recipientId !== this.id;
    if (senderId === this.id || isForOtherClient) {
      return;
    }
    switch (message.type) {
      case MessageType.ELECTION:
        return this.handleElection(message);
      case MessageType.ELECTION_RESPONSE:
        return this.handleElectionResponse(message);
      case MessageType.PRIMARY_ANNOUNCE:
        return this.handlePrimaryAnnounce(message);
      case MessageType.PRIMARY_HEARTBEAT:
        return this.handlePrimaryHeartbeat(message);
      case MessageType.BROADCAST:
        return this.handleBroadcast(message);
      case MessageType.REQUEST:
        return this.handleRequest(message, envelope);
      case MessageType.REQUEST_ACK:
        return this.handleRequestAck(message);
    }
  }

  private handleElection(message: Election) {
    this.broadcast({
      type: MessageType.ELECTION_RESPONSE,
      payload: { id: this.id, priority: this.currentPriority }
    });
    if (this.currentPriority > message.payload.priority && !this.electionInProgress) {
      this.startElections();
    }
  }

  private handleElectionResponse(message: ElectionResponse) {
    if (this.electionInProgress) {
      this.electionResponses.set(message.payload.id, message.payload.priority);
    }
  }

  private handlePrimaryAnnounce(message: PrimaryAnnounce) {
    this.logger.debug(`Primary announced: ${message.payload.id}`);
    const wasPrimary = this._isPrimary;
    this._isPrimary = false;
    this.lastPrimaryHeartbeat = Date.now();
    this.electionInProgress = false;
    this.electionResponses.clear();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (wasPrimary) {
      this.callbacks.onRoleChange(false);
    }
    this.readyCallback();
  }

  private handlePrimaryHeartbeat(message: PrimaryHeartbeat) {
    this.lastPrimaryHeartbeat = Date.now();
  }

  private handleBroadcast(message: BroadcastMessage) {
    this.logger.debug(`Received broadcast from primary`, message.payload);
    this.callbacks.onNotification(message.payload);
  }

  private handleRequest(message: RequestMessage, envelope: Envelope) {
    if (!this.isPrimary) {
      return;
    }
    this.logger.debug(`Received request from secondary`, message.payload);
    this.callbacks
      .onMessage(message.payload)
      .then(() => {
        this.send(
          {
            type: MessageType.REQUEST_ACK,
            payload: { id: envelope.id }
          },
          envelope.senderId
        );
      })
      .catch((error) => {
        this.send(
          {
            type: MessageType.REQUEST_ACK,
            payload: { id: envelope.id, error }
          },
          envelope.senderId
        );
      });
  }

  private handleRequestAck(message: RequestAckMessage) {
    const ackCallback = this.ackCallbacks[message.payload.id];
    if (ackCallback) {
      ackCallback(message.payload.error);
      delete this.ackCallbacks[message.payload.id];
    }
  }

  private async send(
    message: RequestMessage | RequestAckMessage,
    recipientId?: string
  ): Promise<void> {
    const envelope: Envelope = {
      id: getUUID(),
      senderId: this.id,
      recipientId,
      timestamp: Date.now(),
      message: message
    };
    if (message.type !== MessageType.REQUEST) {
      this.channel.postMessage(envelope);
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const ackTimeout = setTimeout(() => {
        if (this.ackCallbacks[envelope.id]) {
          this.ackCallbacks[envelope.id](new Error('Message delivery timeout'));
          delete this.ackCallbacks[envelope.id];
        }
      }, ACK_TIMEOUT);
      this.ackCallbacks[envelope.id] = (error?: any) => {
        clearTimeout(ackTimeout);
        delete this.ackCallbacks[envelope.id];
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      this.channel.postMessage(envelope);
    });
  }

  private broadcast(message: Message) {
    const envelope: Envelope = {
      id: getUUID(),
      senderId: this.id,
      timestamp: Date.now(),
      message: message
    };
    this.channel.postMessage(envelope);
    return envelope.id;
  }

  public async sendMessage(message: M): Promise<any> {
    this.logger.debug(`Sending message to primary`, message);
    return this.send({
      type: MessageType.REQUEST,
      payload: message
    });
  }

  public notify(message: N) {
    this.logger.debug(`Sending notification to secondary tabs`, message);
    this.broadcast({
      type: MessageType.BROADCAST,
      payload: message
    });
  }
}

export default ChannelCoordinator;
