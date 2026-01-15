import { spawn, ChildProcess } from "child_process";
import { createServer } from "net";

export const TEST_SERVER = "@modelcontextprotocol/server-everything@2026.1.14";

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(startPort, () => {
      const port = (server.address() as { port: number })?.port;
      server.close(() => resolve(port || startPort));
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Try next port
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

export class TestServerManager {
  private servers: ChildProcess[] = [];

  /**
   * Start an HTTP server for testing
   * Automatically finds an available port if the requested port is in use
   */
  async startHttpServer(
    requestedPort: number = 3001,
  ): Promise<{ process: ChildProcess; port: number }> {
    // Find an available port (handles parallel test execution)
    const port = await findAvailablePort(requestedPort);

    // Set PORT environment variable so the server uses the specific port
    const server = spawn("npx", [TEST_SERVER, "streamableHttp"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PORT: String(port) },
    });

    this.servers.push(server);

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 5000));

    return { process: server, port };
  }

  /**
   * Start an SSE server for testing
   * Automatically finds an available port if the requested port is in use
   */
  async startSseServer(
    requestedPort: number = 3000,
  ): Promise<{ process: ChildProcess; port: number }> {
    // Find an available port (handles parallel test execution)
    const port = await findAvailablePort(requestedPort);

    // Set PORT environment variable so the server uses the specific port
    const server = spawn("npx", [TEST_SERVER, "sse"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PORT: String(port) },
    });

    this.servers.push(server);

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    return { process: server, port };
  }

  /**
   * Cleanup all running servers
   */
  cleanup() {
    this.servers.forEach((server) => {
      try {
        if (server.pid) {
          process.kill(-server.pid);
        }
      } catch (e) {
        // Server may already be dead
      }
    });
    this.servers = [];
  }
}
