import type { OAuthStep, AuthGuidedState } from "./types.js";
import type { BaseOAuthClientProvider } from "./providers.js";
export interface StateMachineContext {
    state: AuthGuidedState;
    serverUrl: string;
    provider: BaseOAuthClientProvider;
    updateState: (updates: Partial<AuthGuidedState>) => void;
    fetchFn?: typeof fetch;
}
export interface StateTransition {
    canTransition: (context: StateMachineContext) => Promise<boolean>;
    execute: (context: StateMachineContext) => Promise<void>;
}
export declare const oauthTransitions: Record<OAuthStep, StateTransition>;
export declare class OAuthStateMachine {
    private serverUrl;
    private provider;
    private updateState;
    private fetchFn?;
    constructor(serverUrl: string, provider: BaseOAuthClientProvider, updateState: (updates: Partial<AuthGuidedState>) => void, fetchFn?: typeof fetch | undefined);
    executeStep(state: AuthGuidedState): Promise<void>;
}
//# sourceMappingURL=state-machine.d.ts.map