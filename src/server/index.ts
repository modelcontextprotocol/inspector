import { Protocol } from "../shared/protocol.js";
import {
  ClientCapabilities,
  ClientRequest,
  Implementation,
  InitializedNotificationSchema,
  InitializeRequest,
  InitializeRequestSchema,
  InitializeResult,
  PROTOCOL_VERSION,
  ServerNotification,
  ServerRequest,
  ServerResult,
  ServerCapabilities,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  SetLevelRequestSchema,
} from "../types.js";

/**
 * An MCP server on top of a pluggable transport.
 *
 * This server will automatically respond to the initialization flow as initiated from the client.
 */
export class Server extends Protocol<
  ServerRequest,
  ServerNotification,
  ServerResult
> {
  private _clientCapabilities?: ClientCapabilities;
  private _clientVersion?: Implementation;

  /**
   * Callback for when initialization has fully completed (i.e., the client has sent an `initialized` notification).
   */
  oninitialized?: () => void;

  /**
   * Initializes this server with the given name and version information.
   */
  constructor(private _serverInfo: Implementation) {
    super();

    this.setRequestHandler(InitializeRequestSchema, (request) =>
      this._oninitialize(request),
    );
    this.setNotificationHandler(InitializedNotificationSchema, () =>
      this.oninitialized?.(),
    );
  }

  private async _oninitialize(
    request: InitializeRequest,
  ): Promise<InitializeResult> {
    if (request.params.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `Client's protocol version is not supported: ${request.params.protocolVersion}`,
      );
    }

    this._clientCapabilities = request.params.capabilities;
    this._clientVersion = request.params.clientInfo;

    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: this.getCapabilities(),
      serverInfo: this._serverInfo,
    };
  }

  /**
   * After initialization has completed, this will be populated with the client's reported capabilities.
   */
  getClientCapabilities(): ClientCapabilities | undefined {
    return this._clientCapabilities;
  }

  /**
   * After initialization has completed, this will be populated with information about the client's name and version.
   */
  getClientVersion(): Implementation | undefined {
    return this._clientVersion;
  }

  private getCapability(
    reqType: ClientRequest["method"],
  ): ServerCapabilities[keyof ServerCapabilities] {
    return this._requestHandlers.has(reqType as string) ? {} : undefined;
  }

  private getCapabilities(): ServerCapabilities {
    return {
      prompts: this.getCapability(ListPromptsRequestSchema.shape.method.value),
      resources: this.getCapability(
        ListResourcesRequestSchema.shape.method.value,
      ),
      tools: this.getCapability(ListToolsRequestSchema.shape.method.value),
      logging: this.getCapability(SetLevelRequestSchema.shape.method.value),
    };
  }
}
