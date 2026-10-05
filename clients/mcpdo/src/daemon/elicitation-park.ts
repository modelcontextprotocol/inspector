/**
 * Daemon-side parking for elicitations from non-interactive callers
 * (dual-era support, phase 2). Instead of relaying an elicitation over the
 * socket for an inline prompt — which a non-TTY agent can never answer, its
 * stdin isn't wired to the human — the in-flight call is parked here: the
 * originating `rpc` returns immediately with `kind: "elicitation-pending"`,
 * and a later `elicitation/respond` op answers the exchange and picks up
 * either the final call result or the next pending round. Works identically
 * for both eras because the bridge funnels legacy server→client requests and
 * modern non-task MRTR rounds through the same `ElicitationChannel` seam.
 */
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { ElicitationChannel } from "./ipc-glue.js";
import type {
  ElicitationPendingInfo,
  ElicitationRequestFrame,
  ElicitationResponseFrame,
  RpcResult,
} from "./protocol.js";

/**
 * How long an unanswered parked elicitation lives before the daemon cancels
 * it. Long enough for an agent to relay a form to a human and collect
 * answers; bounded so a caller that vanishes can't hold the server's
 * elicitation request (and the parked call) open forever.
 */
export const PARKED_ELICITATION_TTL_MS = 10 * 60_000;

/**
 * {@link ElicitationChannel} that parks instead of prompting: `request()`
 * returns a promise nobody answers until `elicitation/respond` calls
 * {@link answer}. `waitForElicitation()` lets the rpc/respond handlers race
 * the in-flight call against the next elicitation arriving. `close()`
 * cancel-settles the current exchange and every future one (expiry or
 * connection teardown) — the bridge's channel-failure path then `cancel()`s
 * the underlying message, so the parked call always settles.
 */
export class ParkingElicitationChannel implements ElicitationChannel {
  private pending: {
    frame: ElicitationRequestFrame;
    resolve: (frame: ElicitationResponseFrame) => void;
    reject: (error: Error) => void;
  } | null = null;
  private waiter: ((frame: ElicitationRequestFrame) => void) | null = null;
  private closed: Error | null = null;

  request(frame: ElicitationRequestFrame): Promise<ElicitationResponseFrame> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      this.pending = { frame, resolve, reject };
      if (this.waiter) {
        const waiter = this.waiter;
        this.waiter = null;
        waiter(frame);
      }
    });
  }

  /** Resolves when the next elicitation arrives; never rejects. */
  waitForElicitation(): Promise<ElicitationRequestFrame> {
    if (this.pending) return Promise.resolve(this.pending.frame);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** The frame of the exchange currently awaiting an answer, if any. */
  pendingFrame(): ElicitationRequestFrame | null {
    return this.pending?.frame ?? null;
  }

  /**
   * Answer the pending exchange. A no-op when nothing is pending (the call
   * settled on its own — e.g. the server timed out its elicitation and
   * completed anyway); the caller then just picks up the settled outcome.
   */
  answer(response: ElicitationResponseFrame): void {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(response);
  }

  /** Cancel-settle the pending exchange and auto-cancel all future ones. */
  close(error: Error): void {
    this.closed = error;
    const pending = this.pending;
    this.pending = null;
    this.waiter = null;
    pending?.reject(error);
  }
}

export type ParkedCall = {
  /** Current round's payload; re-pointed by {@link ElicitationParkRegistry.rearm}. */
  info: ElicitationPendingInfo;
  /** Client the call runs on — guards against new rpcs interleaving. */
  client: InspectorClient;
  channel: ParkingElicitationChannel;
  /** Settles when the parked daemon-side call finishes (result or error). */
  outcome: Promise<RpcResult>;
  /**
   * Removes the call's bridge subscriber. Normally the call's own `finally`
   * unwires when the underlying call settles — but a cancelled/expired park
   * abandons a call that is still running server-side, and its subscriber
   * would otherwise stay first in the bridge's dispatch order until the
   * server settles it, swallowing (auto-cancelling) the next elicitation of
   * any new call started in that window. Park teardown owns the unwire so a
   * closed channel is never a dispatch target. Idempotent.
   */
  unwire: () => void;
  /**
   * `awaiting` = parked, answerable; `responding` = an `elicitation/respond`
   * is in flight for it (a concurrent respond must not double-answer).
   */
  state: "awaiting" | "responding";
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * All parked calls, keyed by the current round's `elicitationId`. At most
 * one per connection: the daemon serializes rpcs per client and refuses new
 * rpcs on a connection with a parked call (the bridge would misroute a
 * second call's elicitations to the parked subscriber).
 */
export class ElicitationParkRegistry {
  private readonly byId = new Map<string, ParkedCall>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = PARKED_ELICITATION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** The parked call running on `client`, whatever its state, if any. */
  forClient(client: InspectorClient): ParkedCall | undefined {
    for (const entry of this.byId.values()) {
      if (entry.client === client) return entry;
    }
    return undefined;
  }

  /** Park a call. `info.expiresAt` is set here from the registry's TTL. */
  add(entry: {
    info: Omit<ElicitationPendingInfo, "expiresAt">;
    client: InspectorClient;
    channel: ParkingElicitationChannel;
    outcome: Promise<RpcResult>;
    unwire: () => void;
  }): ParkedCall {
    const parked: ParkedCall = {
      ...entry,
      info: { ...entry.info, expiresAt: Date.now() + this.ttlMs },
      state: "awaiting",
      timer: null,
    };
    this.byId.set(parked.info.elicitationId, parked);
    this.armTimer(parked);
    return parked;
  }

  /**
   * Claim a parked call for one `elicitation/respond`. Removes the id from
   * the awaitable state so a concurrent respond can't double-answer.
   */
  take(elicitationId: string): ParkedCall {
    const entry = this.byId.get(elicitationId);
    if (!entry || entry.state !== "awaiting") {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `No pending elicitation '${elicitationId}' — it may have expired, been answered, or belong to a connection that closed.`,
        { code: "elicitation_not_found" },
      );
    }
    entry.state = "responding";
    this.clearTimer(entry);
    return entry;
  }

  /** Park the next round of an already-claimed call under a new id. */
  rearm(entry: ParkedCall, info: Omit<ElicitationPendingInfo, "expiresAt">) {
    this.byId.delete(entry.info.elicitationId);
    entry.info = { ...info, expiresAt: Date.now() + this.ttlMs };
    entry.state = "awaiting";
    this.byId.set(entry.info.elicitationId, entry);
    this.armTimer(entry);
    return entry.info;
  }

  /** The parked call settled; forget it. */
  finish(entry: ParkedCall): void {
    this.clearTimer(entry);
    this.byId.delete(entry.info.elicitationId);
  }

  /** Connection going away (disconnect / replacing connect): cancel its parked call. */
  cancelForConnection(connectionName: string): void {
    for (const entry of this.byId.values()) {
      if (entry.info.connection === connectionName) this.cancel(entry);
    }
  }

  /** Daemon shutdown: cancel everything so no server request is left held. */
  cancelAll(): void {
    for (const entry of this.byId.values()) this.cancel(entry);
  }

  private cancel(entry: ParkedCall): void {
    this.finish(entry);
    // The abandoned call may run server-side long after this park is gone;
    // unwire its bridge subscriber now so it cannot shadow a new call's
    // elicitations (see ParkedCall.unwire).
    entry.unwire();
    entry.channel.close(
      new CliExitCodeError(
        EXIT_CODES.UNREACHABLE,
        "Parked elicitation cancelled: the connection or daemon is going away.",
        { code: "elicitation_cancelled" },
      ),
    );
  }

  private armTimer(entry: ParkedCall): void {
    if (this.ttlMs <= 0) return;
    entry.timer = setTimeout(() => {
      this.finish(entry);
      entry.unwire();
      entry.channel.close(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          "Parked elicitation expired unanswered.",
          { code: "elicitation_expired" },
        ),
      );
    }, this.ttlMs);
    entry.timer.unref?.();
  }

  private clearTimer(entry: ParkedCall): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
}
