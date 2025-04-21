import path from "node:path";
import os from "node:os";
import {
  Agent as HTTPAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
} from "undici";

const _defaultDispatcher = getGlobalDispatcher();
let _enabledSocketProxy = false;

export function enableSocketProxy(socketProxyPath: string) {
  if (_enabledSocketProxy) {
    return;
  }

  const socketPath = socketProxyPath.replace("~", os.homedir());
  const agent = new HTTPAgent({
    socketPath: socketPath as string,
    connect: {},
  });

  // Proxy all requests through a unix proxy
  setGlobalDispatcher(agent);
  _enabledSocketProxy = true;
}
export function disableSocketProxy() {
  if (!_enabledSocketProxy) {
    return;
  }
  _enabledSocketProxy = false;
  setGlobalDispatcher(_defaultDispatcher);
}
