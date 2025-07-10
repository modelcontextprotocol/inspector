import http from "http";
import { URL } from "url";

interface OAuthCallbackServer {
  server: http.Server;
  port: number;
  url: string;
}

export class OAuthCallbackManager {
  private servers: OAuthCallbackServer[] = [];
  private mcpInspectorUrl: string;

  constructor(mcpInspectorUrl: string) {
    this.mcpInspectorUrl = mcpInspectorUrl;
  }

  private createCallbackServer(callbackUrl: string, isDebug: boolean = false): OAuthCallbackServer | null {
    try {
      const parsedUrl = new URL(callbackUrl);
      const port = parseInt(parsedUrl.port, 10);
      
      if (!port || isNaN(port)) {
        console.warn(`Invalid port in OAuth callback URL: ${callbackUrl}`);
        return null;
      }

      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
        
        // Get OAuth parameters from the query string
        const code = reqUrl.searchParams.get("code");
        const state = reqUrl.searchParams.get("state");
        const error = reqUrl.searchParams.get("error");
        const errorDescription = reqUrl.searchParams.get("error_description");

        // Build redirect URL to MCP Inspector
        const inspectorPath = isDebug ? "/oauth/callback/debug" : "/oauth/callback";
        const redirectUrl = new URL(inspectorPath, this.mcpInspectorUrl);
        
        // Forward all query parameters
        reqUrl.searchParams.forEach((value, key) => {
          redirectUrl.searchParams.set(key, value);
        });

        // Send redirect response
        res.writeHead(302, {
          "Location": redirectUrl.toString(),
          "Content-Type": "text/html",
        });
        
        const redirectHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>OAuth Redirect</title>
              <meta charset="utf-8">
            </head>
            <body>
              <h2>OAuth Authentication</h2>
              <p>Redirecting to MCP Inspector...</p>
              <p>If you are not redirected automatically, <a href="${redirectUrl.toString()}">click here</a>.</p>
              <script>
                // Automatic redirect
                window.location.href = "${redirectUrl.toString()}";
              </script>
            </body>
          </html>
        `;
        
        res.end(redirectHtml);
        
        console.log(`OAuth ${isDebug ? "debug " : ""}callback received on port ${port}`);
        if (code) {
          console.log(`  Authorization code: ${code.substring(0, 10)}...`);
        }
        if (error) {
          console.log(`  Error: ${error} - ${errorDescription || "No description"}`);
        }
        console.log(`  Redirecting to: ${redirectUrl.toString()}`);
      });

      return { server, port, url: callbackUrl };
    } catch (error) {
      console.error(`Failed to create OAuth callback server for ${callbackUrl}:`, error);
      return null;
    }
  }

  start(): void {
    const oauthCallback = process.env.OAUTH_MCP_INSPECTOR_CALLBACK;
    const oauthDebugCallback = process.env.OAUTH_MCP_INSPECTOR_DEBUG_CALLBACK;

    if (oauthCallback) {
      const callbackServer = this.createCallbackServer(oauthCallback, false);
      if (callbackServer) {
        callbackServer.server.listen(callbackServer.port, () => {
          console.log(`🔗 OAuth callback server listening on ${callbackServer.url}`);
        });
        
        callbackServer.server.on("error", (err) => {
          if ((err as any).code === "EADDRINUSE") {
            console.warn(`⚠️  OAuth callback port ${callbackServer.port} is in use`);
          } else {
            console.error(`OAuth callback server error:`, err);
          }
        });

        this.servers.push(callbackServer);
      }
    }

    if (oauthDebugCallback) {
      const debugCallbackServer = this.createCallbackServer(oauthDebugCallback, true);
      if (debugCallbackServer) {
        debugCallbackServer.server.listen(debugCallbackServer.port, () => {
          console.log(`🔗 OAuth debug callback server listening on ${debugCallbackServer.url}`);
        });

        debugCallbackServer.server.on("error", (err) => {
          if ((err as any).code === "EADDRINUSE") {
            console.warn(`⚠️  OAuth debug callback port ${debugCallbackServer.port} is in use`);
          } else {
            console.error(`OAuth debug callback server error:`, err);
          }
        });

        this.servers.push(debugCallbackServer);
      }
    }

    if (this.servers.length === 0) {
      console.log("No OAuth callback URLs configured");
    }
  }

  stop(): void {
    this.servers.forEach(({ server, port }) => {
      server.close(() => {
        console.log(`OAuth callback server on port ${port} stopped`);
      });
    });
    this.servers = [];
  }
}