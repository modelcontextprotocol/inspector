import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound } from "lucide-react";

export interface TokenLoginScreenProps {
  onTokenSubmit: (token: string) => void;
}

/**
 * Shown when the app loads without an API token (e.g. direct navigation).
 * User enters the token (provided when running the inspector from the CLI);
 * on submit we persist it and load the main app.
 */
const TokenLoginScreen = ({ onTokenSubmit }: TokenLoginScreenProps) => {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Please enter an API token.");
      return;
    }
    setError(null);
    onTokenSubmit(trimmed);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <KeyRound className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">MCP Inspector</h1>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Enter the API token to continue. The token is provided when you run
            the inspector from the CLI (e.g.{" "}
            <code className="rounded bg-muted px-1">npm run web</code>) and is
            included in the URL when the browser opens.
          </p>
          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-token">API token</Label>
              <Input
                id="api-token"
                type="password"
                placeholder="Paste your API token"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError(null);
                }}
                className="font-mono text-sm"
                autoFocus
                autoComplete="off"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default TokenLoginScreen;
