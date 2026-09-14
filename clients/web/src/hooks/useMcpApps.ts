import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RefObject } from "react";
import { notifications } from "@mantine/notifications";
import type { ElicitResult, Resource } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../components/elements/AppRenderer/AppRenderer";
import { createAppBridgeFactory } from "../components/elements/AppRenderer/createAppBridgeFactory";
import { publishAppDocument } from "../lib/publishAppDocument";
import {
  AppElicitationController,
  type AppElicitationEntry,
  type AppElicitationSession,
} from "../lib/appElicitationController";
import { getAuthToken } from "../lib/authToken";

export interface UseMcpAppsOptions {
  /** The live client. Null while disconnected; the bridges read it lazily. */
  inspectorClient: InspectorClient | null;
  /** Origin the backend's `/api/*` routes are reached on. */
  configBaseUrl: string;
  /**
   * Whatever the resource list currently holds — every page in the default
   * aggregate mode, only the pages fetched so far under `paginatedLists`. Read
   * through a ref rather than a dependency (see below), so a new array
   * identity on every render costs nothing here.
   */
  resources: Resource[];
}

export interface McpApps {
  /** Pushes tool input/result into the running app, and tears it down. */
  appRendererRef: RefObject<AppRendererHandle | null>;
  /** Bridge for an App-tool frame in the Apps tab. */
  sandboxBridgeFactory: BridgeFactory;
  /** Bridge for an app-rendered elicitation modal (advertises `elicitation`). */
  elicitationBridgeFactory: BridgeFactory;
  /** The elicitations currently awaiting an answer, for `AppElicitationHost`. */
  appElicitations: AppElicitationEntry[];
  /**
   * Close the previous client's session and open one for the client being
   * constructed. Synchronous, and called at construction, so the swap itself is
   * the moment ownership changes hands.
   */
  newAppElicitationSession: () => AppElicitationSession;
  handleAppElicitationSettle: (requestId: string, result: ElicitResult) => void;
  handleAppElicitationFail: (requestId: string, error: Error) => void;
}

/**
 * The MCP Apps runtime wiring — the two sandbox bridge factories, the renderer
 * handle, and the app-rendered elicitation controller (#1854) — lifted out of
 * `App.tsx` by the phase-2 decomposition (#2156, under #2129/#2126).
 *
 * Nearly a leaf: it reads the active client and the resource listing and calls
 * nothing back. What keeps it one hook rather than several is that both
 * factories are built from the same two lazily-read inputs, and the elicitation
 * session is owned by the controller the second factory renders through.
 *
 * The caller still owns `sandboxUrl` and the client construction that consumes
 * `newAppElicitationSession` — whether the sandbox exists decides whether the
 * nested MCP Apps `elicitation` capability is advertised, and that is a
 * connection-lifecycle question rather than an Apps one.
 */
export function useMcpApps({
  inspectorClient,
  configBaseUrl,
  resources,
}: UseMcpAppsOptions): McpApps {
  // `sandboxUrl` is the inspector's sandbox-proxy page (the trusted outer
  // iframe); `appRendererRef` lets the app handlers push tool input/result into
  // the running app and tear it down. The bridge factory wraps the active
  // client's underlying SDK client so the running view can call the server, and
  // reads the tool's UI resource into the sandbox on handshake.
  const appRendererRef = useRef<AppRendererHandle>(null);

  // The `resources/list` entries, read lazily by the App bridge factories below.
  // ext-apps treats a listing entry's `_meta.ui` as the static default for its
  // UI resource (a read content item's own `_meta.ui` wins), so the sandbox CSP
  // has to be able to see it. A ref rather than a dependency: the factories only
  // read it inside an async sandboxready handler, long after any render that
  // produced the listing.
  //
  // The listing is a documented *default* that a read content item overrides,
  // and an app whose entry sits on an unfetched page simply falls back to no
  // hints (`connect-src 'none'`), exactly as before this wiring existed.
  // Walking the whole list to close that would issue the very requests the user
  // opted out of by turning pagination on, so the setting wins.
  //
  // Published from a layout effect rather than written during render: the only
  // reader is the async `sandboxready` handler below, which runs long after the
  // commit this writes in, so it sees the same listing either way.
  const listedResourcesRef = useRef<Resource[]>([]);
  useLayoutEffect(() => {
    listedResourcesRef.current = resources;
  }, [resources]);
  // Best-effort by construction: this reads the list as it stands when the app
  // opens, and does not distinguish "no entry for this URI" from "the list
  // hasn't arrived yet". Both yield no hints, which is the same outcome as
  // having no listing carrier at all. Blocking the render on list readiness
  // instead would mean waiting on a request that, for a server advertising no
  // `resources` capability or whose list errored, never resolves — trading a
  // missing default for an app that never renders.
  const getListedResourceMeta = useCallback(
    (uri: string) =>
      listedResourcesRef.current.find((r) => r.uri === uri)?._meta,
    [],
  );

  // `_meta.ui.domain` support (#2056): hand a wrapped app document to the
  // backend so it can serve it from a dedicated origin, giving the app's
  // requests a real `Origin`. Resolves `null` on any backend that can't, and
  // the factory then renders the app the default (opaque-origin) way.
  const publishDocument = useCallback(
    (doc: { html: string; csp?: string }) =>
      publishAppDocument(doc, {
        baseUrl: configBaseUrl,
        authToken: getAuthToken(),
      }),
    [configBaseUrl],
  );

  // `react-hooks/refs` cannot see through `createAppBridgeFactory`, so it warns
  // that a ref-reading callback handed to it (`getListedResourceMeta`) *may* be
  // called during render. It is not: the factory only stores its deps, and the
  // sole call site is inside the async `sandboxready` handler, which runs once
  // an app frame has mounted and its sandbox has handshaked. Reading the
  // listing lazily there is the whole point — see `listedResourcesRef` above.
  const sandboxBridgeFactory = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- justified directly above
      createAppBridgeFactory({
        publishAppDocument: publishDocument,
        getClient: () => inspectorClient?.getAppRendererClient() ?? null,
        getListedResourceMeta,
        readResource: async (uri) => {
          if (!inspectorClient) throw new Error("No MCP client connected.");
          const invocation = await inspectorClient.readResource(uri);
          return invocation.result;
        },
        // The bridge's sandboxready handler reads + posts the UI resource
        // inside a detached async block; without this hook a 404 / malformed
        // resource is console.error-only and the user stares at a blank
        // frame. Surface it as a toast. The renderer separately drives
        // `data-app-status` so an automated driver can time out on
        // never-reaching-"ready" and read the toast.
        onResourceError: (err) => {
          notifications.show({
            title: "App resource failed to load",
            message: err.message,
            color: "red",
          });
        },
      }),
    [inspectorClient, getListedResourceMeta, publishDocument],
  );

  // App-rendered form elicitations (#1854). The controller is created once and
  // handed to every InspectorClient at construction — its `render` is what opts
  // this client into advertising the nested MCP Apps `elicitation` capability,
  // which is why only the web client (the one with a sandbox) claims it.
  // Held as lazily-initialized state rather than a ref seeded during render:
  // the instance is never reassigned, so `useState`'s initializer gives the
  // same create-once semantics without reading a ref while rendering.
  const [appElicitationController] = useState(
    () => new AppElicitationController(),
  );
  // The window onto the controller for the CURRENT client. Closing it when the
  // client is replaced both rejects that connection's queued requests and
  // refuses any it enqueues during its own (asynchronous) teardown — a late
  // entry would otherwise be rendered by a factory bound to the replacement
  // client, i.e. read and answered through a different server.
  const appElicitationSessionRef = useRef<AppElicitationSession>(null);
  const appElicitations = useSyncExternalStore(
    appElicitationController.subscribe,
    appElicitationController.getEntries,
  );

  // A SECOND factory, differing from `sandboxBridgeFactory` only in that it
  // advertises `hostCapabilities.elicitation`. An App-tool frame is never handed
  // an elicitation, so telling those apps otherwise would be a false claim.
  const elicitationBridgeFactory = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- same dep, same reason as `sandboxBridgeFactory` above
      createAppBridgeFactory({
        advertiseElicitation: true,
        publishAppDocument: publishDocument,
        getClient: () => inspectorClient?.getAppRendererClient() ?? null,
        getListedResourceMeta,
        readResource: async (uri) => {
          if (!inspectorClient) throw new Error("No MCP client connected.");
          const invocation = await inspectorClient.readResource(uri);
          return invocation.result;
        },
        // Unlike the Apps tab there is no persistent surface to show the
        // failure on — the modal is about to be replaced by the native form —
        // so the toast is the only place the user learns why.
        onResourceError: (err) => {
          notifications.show({
            title: "Elicitation app failed to load",
            message: err.message,
            color: "red",
          });
        },
      }),
    [inspectorClient, getListedResourceMeta, publishDocument],
  );

  const newAppElicitationSession = useCallback(() => {
    appElicitationSessionRef.current?.close(
      new Error("Connection replaced before the app answered"),
    );
    const session = appElicitationController.openSession();
    appElicitationSessionRef.current = session;
    return session;
  }, [appElicitationController]);

  const handleAppElicitationSettle = useCallback(
    (requestId: string, result: ElicitResult) => {
      appElicitationController.settle(requestId, result);
    },
    [appElicitationController],
  );

  const handleAppElicitationFail = useCallback(
    (requestId: string, error: Error) => {
      appElicitationController.fail(requestId, error);
    },
    [appElicitationController],
  );

  return {
    appRendererRef,
    sandboxBridgeFactory,
    elicitationBridgeFactory,
    appElicitations,
    newAppElicitationSession,
    handleAppElicitationSettle,
    handleAppElicitationFail,
  };
}
