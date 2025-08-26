import { StdErrNotification } from "../../../lib/notificationTypes";

export interface InterceptedConsoleError {
  message: string;
  stack?: string;
  timestamp: number;
  serverName?: string;
}

export interface ConsoleErrorInterceptor {
  setup(
    serverName: string,
    onError: (notification: StdErrNotification) => void,
  ): void;
  cleanup(): void;
  setCurrentServer(serverName: string | null): void;
}

class ConsoleErrorInterceptorImpl implements ConsoleErrorInterceptor {
  private originalConsoleError: typeof console.error | null = null;
  private currentServerName: string | null = null;
  private errorCallback: ((notification: StdErrNotification) => void) | null =
    null;
  private isActive = false;

  setup(
    serverName: string,
    onError: (notification: StdErrNotification) => void,
  ): void {
    if (this.isActive) {
      this.cleanup();
    }

    this.currentServerName = serverName;
    this.errorCallback = onError;
    this.originalConsoleError = console.error;
    this.isActive = true;

    // Intercept console.error
    console.error = (...args: any[]) => {
      // Call original console.error first
      if (this.originalConsoleError) {
        this.originalConsoleError.apply(console, args);
      }

      // Process the error for our notification system
      this.handleError(args);
    };
  }

  cleanup(): void {
    if (this.isActive && this.originalConsoleError) {
      console.error = this.originalConsoleError;
      this.originalConsoleError = null;
      this.currentServerName = null;
      this.errorCallback = null;
      this.isActive = false;
    }
  }

  setCurrentServer(serverName: string | null): void {
    this.currentServerName = serverName;
  }

  private handleError(args: any[]): void {
    if (!this.errorCallback || !this.currentServerName) {
      return;
    }

    try {
      const errorMessage = this.formatErrorMessage(args);
      const notification = this.createStdErrNotificationFromConsoleError({
        message: errorMessage,
        timestamp: Date.now(),
        serverName: this.currentServerName,
        stack: this.extractStackTrace(args),
      });

      this.errorCallback(notification);
    } catch (error) {
      // Avoid infinite recursion by not using console.error here
      if (this.originalConsoleError) {
        this.originalConsoleError("Failed to process console error:", error);
      }
    }
  }

  private formatErrorMessage(args: any[]): string {
    return args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        } else if (arg instanceof Error) {
          return arg.message;
        } else if (typeof arg === "object") {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        } else {
          return String(arg);
        }
      })
      .join(" ");
  }

  private extractStackTrace(args: any[]): string | undefined {
    for (const arg of args) {
      if (arg instanceof Error && arg.stack) {
        return arg.stack;
      }
    }
    return undefined;
  }

  private createStdErrNotificationFromConsoleError(
    error: InterceptedConsoleError,
  ): StdErrNotification {
    const content = error.stack
      ? `${error.message}\n${error.stack}`
      : error.message;

    return {
      method: "notifications/stderr",
      params: {
        content,
      },
    };
  }
}

// Singleton instance
export const consoleErrorInterceptor: ConsoleErrorInterceptor =
  new ConsoleErrorInterceptorImpl();

// Utility function for creating stderr notifications from console errors
export function createStdErrNotificationFromConsoleError(
  error: InterceptedConsoleError,
): StdErrNotification {
  const content = error.stack
    ? `${error.message}\n${error.stack}`
    : error.message;

  return {
    method: "notifications/stderr",
    params: {
      content,
    },
  };
}
