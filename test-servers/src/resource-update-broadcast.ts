/**
 * Resource-update broadcast — one resource update reaching every session (#2964).
 *
 * Each session of the composable HTTP server is its own `McpServer` with its
 * own resource copies and its own subscription set, so the `update_resource`
 * tool on its own changes and notifies **only the session that called it**.
 * That is a faithful per-session server, and exactly wrong for a fan-out run:
 * `--load-subscribe` against it reports every other subscriber as missed
 * (`Delivered: 10 of 50`) because no other session was ever told.
 *
 * A broadcast is the cross-session half a real server has and the fixture did
 * not: a hub shared by every session the server opens. Each session joins it
 * on creation and leaves when its connection closes; `publish` applies the new
 * text to every member's copy of the resource and sends
 * `notifications/resources/updated` to each member subscribed to it. It is
 * opted into by `broadcastResourceUpdates: true` in a config file, which
 * `resolveConfig` turns into one hub on the resolved `ServerConfig` — and
 * since every session is built from that one config object, they all share it.
 *
 * The latest text per URI is kept, so a session opened after an update serves
 * the updated content rather than the preset's original — a subscriber that
 * re-reads on notification sees the same text whichever session it is.
 */

import type { RegisteredResource } from "@modelcontextprotocol/server";

/** One session's view of the broadcast. */
export interface ResourceUpdateMember {
  /** Replace this session's copy of `uri`'s text; a no-op where it serves none. */
  apply(uri: string, text: string): void;
  /**
   * Send `notifications/resources/updated` for `uri` if this session is
   * subscribed to it. Resolves `true` when a notification was sent.
   */
  notify(uri: string): Promise<boolean>;
}

/** A hub shared by every session of one server. */
export interface ResourceUpdateBroadcast {
  /** Add a session; replays the latest update of each URI. Returns `leave`. */
  join(member: ResourceUpdateMember): () => void;
  /**
   * Apply `text` to every session's copy of `uri` and notify each subscribed
   * session. A session whose send fails (its stream is gone) is skipped, not
   * fatal — the others still receive theirs. Resolves to the count notified.
   */
  publish(uri: string, text: string): Promise<number>;
  /** Sessions currently joined. */
  readonly size: number;
}

/** Create a broadcast hub; share one per server across all its sessions. */
export function createResourceUpdateBroadcast(): ResourceUpdateBroadcast {
  const members = new Set<ResourceUpdateMember>();
  const latest = new Map<string, string>();
  return {
    join(member) {
      for (const [uri, text] of latest) member.apply(uri, text);
      members.add(member);
      return () => {
        members.delete(member);
      };
    },
    async publish(uri, text) {
      latest.set(uri, text);
      const current = [...members];
      for (const member of current) member.apply(uri, text);
      const sent = await Promise.all(
        current.map((member) => member.notify(uri).catch(() => false)),
      );
      return sent.filter(Boolean).length;
    },
    get size() {
      return members.size;
    },
  };
}

/**
 * Point a registered resource at new text, keeping its MIME type. Returns
 * `false` when `uri` is not registered. Shared by `update_resource` (one
 * session) and the broadcast (every session), so both update identically.
 */
export function setResourceText(
  registered: Map<string, RegisteredResource>,
  uri: string,
  text: string,
): boolean {
  const resource = registered.get(uri);
  if (!resource) {
    return false;
  }
  const mimeType = resource.metadata?.mimeType || "text/plain";
  resource.update({
    callback: async () => ({ contents: [{ uri, mimeType, text }] }),
  });
  return true;
}
