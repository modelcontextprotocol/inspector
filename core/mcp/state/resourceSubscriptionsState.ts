/**
 * ResourceSubscriptionsState: tracks the live resource-subscription list the
 * Resources screen renders. Subscribes to the InspectorClient's
 * `resourceSubscriptionsChange` (URI list) and `resourceUpdated` events,
 * resolves each URI against the optional `ManagedResourcesState` so subscriptions
 * carry the server-supplied Resource (name/title), and stamps `lastUpdated`
 * when a `notifications/resources/updated` arrives for a tracked URI.
 *
 * When no resource is found in the managed list (e.g. a template-expanded URI
 * the user subscribed to before the resources list refreshed), a synthetic
 * Resource `{ uri, name: uri }` is used — mirroring the fallback pattern in
 * ResourcesScreen. If the server later removes a previously-listed resource
 * while the user is still subscribed, the tile regresses to that synthetic
 * form: the managed list is the source of truth, so displaying a stale name
 * for a server-removed resource is intentionally avoided.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import type {
  ManagedResourcesState,
  ManagedResourcesStateEventMap,
} from "./managedResourcesState.js";
import type { InspectorResourceSubscription } from "../types.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";

export interface ResourceSubscriptionsStateEventMap {
  subscriptionsChange: InspectorResourceSubscription[];
}

/**
 * State manager that mirrors `InspectorClient.subscribedResources` as a list of
 * `InspectorResourceSubscription` objects keyed by URI, preserving each
 * subscription's `lastUpdated` across re-derivations.
 */
export class ResourceSubscriptionsState extends TypedEventTarget<ResourceSubscriptionsStateEventMap> {
  private subscribedUris: string[] = [];
  private lastUpdatedByUri: Map<string, Date> = new Map();
  private subscriptions: InspectorResourceSubscription[] = [];
  private client: InspectorClientProtocol | null = null;
  private resourcesState: ManagedResourcesState | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    client: InspectorClientProtocol,
    resourcesState: ManagedResourcesState | null = null,
  ) {
    super();
    this.client = client;
    this.resourcesState = resourcesState;

    const onSubscriptionsChange = (
      event: TypedEventGeneric<
        InspectorClientEventMap,
        "resourceSubscriptionsChange"
      >,
    ): void => {
      this.subscribedUris = event.detail;
      // Drop lastUpdated entries for URIs no longer subscribed
      const active = new Set(event.detail);
      for (const uri of this.lastUpdatedByUri.keys()) {
        if (!active.has(uri)) this.lastUpdatedByUri.delete(uri);
      }
      this.rebuild();
    };

    const onResourceUpdated = (
      event: TypedEventGeneric<InspectorClientEventMap, "resourceUpdated">,
    ): void => {
      const { uri } = event.detail;
      // Belt-and-braces: the client's dispatch site is already guarded by
      // subscribedResources.has(uri), so this re-check should be redundant.
      // It stays correct if a future change ever decouples dispatch from
      // subscription state.
      if (!this.subscribedUris.includes(uri)) return;
      this.lastUpdatedByUri.set(uri, new Date());
      this.rebuild();
    };

    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.subscribedUris = [];
        this.lastUpdatedByUri.clear();
        this.subscriptions = [];
        this.dispatchTypedEvent("subscriptionsChange", this.getSubscriptions());
      }
    };

    const onResourcesChange = (
      _event: TypedEventGeneric<
        ManagedResourcesStateEventMap,
        "resourcesChange"
      >,
    ): void => {
      // Re-resolve Resource references in case names/titles changed server-side.
      if (this.subscribedUris.length > 0) this.rebuild();
    };

    client.addEventListener(
      "resourceSubscriptionsChange",
      onSubscriptionsChange,
    );
    client.addEventListener("resourceUpdated", onResourceUpdated);
    client.addEventListener("statusChange", onStatusChange);
    resourcesState?.addEventListener("resourcesChange", onResourcesChange);

    this.unsubscribe = () => {
      this.client?.removeEventListener(
        "resourceSubscriptionsChange",
        onSubscriptionsChange,
      );
      this.client?.removeEventListener("resourceUpdated", onResourceUpdated);
      this.client?.removeEventListener("statusChange", onStatusChange);
      this.resourcesState?.removeEventListener(
        "resourcesChange",
        onResourcesChange,
      );
      this.client = null;
      this.resourcesState = null;
    };
  }

  getSubscriptions(): InspectorResourceSubscription[] {
    return [...this.subscriptions];
  }

  private rebuild(): void {
    const resources = this.resourcesState?.getResources() ?? [];
    const byUri = new Map(resources.map((r) => [r.uri, r]));
    this.subscriptions = this.subscribedUris.map((uri) => {
      const resource: Resource = byUri.get(uri) ?? { uri, name: uri };
      const lastUpdated = this.lastUpdatedByUri.get(uri);
      return lastUpdated ? { resource, lastUpdated } : { resource };
    });
    this.dispatchTypedEvent("subscriptionsChange", this.getSubscriptions());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedUris = [];
    this.lastUpdatedByUri.clear();
    this.subscriptions = [];
  }
}
