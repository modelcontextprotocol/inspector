/**
 * Type-safe EventTarget for InspectorClient events
 *
 * This module provides a base class with overloaded addEventListener/removeEventListener
 * methods and a dispatchTypedEvent method that give compile-time type safety for event
 * names and event detail types.
 */

import type {
  ConnectionStatus,
  MessageEntry,
  StderrLogEntry,
  FetchRequestEntry,
  PromptGetInvocation,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
} from "./types.js";
import type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  ServerCapabilities,
  Implementation,
  Root,
  Progress,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { SamplingCreateMessage } from "./samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "./elicitationCreateMessage.js";

/**
 * Maps event names to their detail types for CustomEvents
 */
export interface InspectorClientEventMap {
  statusChange: ConnectionStatus;
  toolsChange: Tool[];
  resourcesChange: Resource[];
  resourceTemplatesChange: ResourceTemplate[];
  promptsChange: Prompt[];
  capabilitiesChange: ServerCapabilities | undefined;
  serverInfoChange: Implementation | undefined;
  instructionsChange: string | undefined;
  message: MessageEntry;
  stderrLog: StderrLogEntry;
  fetchRequest: FetchRequestEntry;
  error: Error;
  resourceUpdated: { uri: string };
  progressNotification: Progress;
  toolCallResultChange: {
    toolName: string;
    params: Record<string, any>;
    result: any;
    timestamp: Date;
    success: boolean;
    error?: string;
    metadata?: Record<string, string>;
  };
  resourceContentChange: {
    uri: string;
    content: ResourceReadInvocation;
    timestamp: Date;
  };
  resourceTemplateContentChange: {
    uriTemplate: string;
    content: ResourceTemplateReadInvocation;
    params: Record<string, string>;
    timestamp: Date;
  };
  promptContentChange: {
    name: string;
    content: PromptGetInvocation;
    timestamp: Date;
  };
  pendingSamplesChange: SamplingCreateMessage[];
  newPendingSample: SamplingCreateMessage;
  pendingElicitationsChange: ElicitationCreateMessage[];
  newPendingElicitation: ElicitationCreateMessage;
  rootsChange: Root[];
  resourceSubscriptionsChange: string[];
  // Signal events (no payload)
  connect: void;
  disconnect: void;
  messagesChange: void;
  stderrLogsChange: void;
  fetchRequestsChange: void;
}

/**
 * Typed event class that extends CustomEvent with type-safe detail
 */
export class TypedEvent<
  K extends keyof InspectorClientEventMap,
> extends CustomEvent<InspectorClientEventMap[K]> {
  constructor(type: K, detail: InspectorClientEventMap[K]) {
    super(type, { detail });
  }
}

/**
 * Type-safe EventTarget for InspectorClient events
 *
 * Provides overloaded addEventListener/removeEventListener methods that
 * give compile-time type safety for event names and event detail types.
 * Extends the standard EventTarget, so all standard EventTarget functionality
 * is still available.
 */
export class InspectorClientEventTarget extends EventTarget {
  /**
   * Dispatch a type-safe event
   * For void events, no detail parameter is required (or allowed)
   * For events with payloads, the detail parameter is required
   */
  dispatchTypedEvent<K extends keyof InspectorClientEventMap>(
    type: K,
    ...args: InspectorClientEventMap[K] extends void
      ? []
      : [detail: InspectorClientEventMap[K]]
  ): void {
    const detail = args[0] as InspectorClientEventMap[K];
    this.dispatchEvent(new TypedEvent(type, detail));
  }

  // Overload 1: All typed events
  addEventListener<K extends keyof InspectorClientEventMap>(
    type: K,
    listener: (event: TypedEvent<K>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;

  // Overload 2: Fallback for any string (for compatibility)
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;

  // Implementation - must be compatible with all overloads
  addEventListener(
    type: string,
    listener:
      | ((event: TypedEvent<any>) => void)
      | EventListenerOrEventListenerObject
      | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  // Overload 1: All typed events
  removeEventListener<K extends keyof InspectorClientEventMap>(
    type: K,
    listener: (event: TypedEvent<K>) => void,
    options?: boolean | EventListenerOptions,
  ): void;

  // Overload 2: Fallback for any string (for compatibility)
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;

  // Implementation - must be compatible with all overloads
  removeEventListener(
    type: string,
    listener:
      | ((event: TypedEvent<any>) => void)
      | EventListenerOrEventListenerObject
      | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }
}
