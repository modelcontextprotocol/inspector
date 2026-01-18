import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
  type Dispatch,
} from 'react';
import type {
  SamplingRequest,
  ElicitationRequest,
  TestingProfile,
} from '@modelcontextprotocol/inspector-core';
import { mockTestingProfiles } from '@/mocks/testingProfiles';

// Types for pending client requests during tool execution
export type ClientRequestType = 'sampling' | 'elicitation';
export type ClientRequestStatus = 'pending' | 'responding' | 'completed' | 'rejected';

export interface PendingClientRequest {
  id: string;
  type: ClientRequestType;
  parentRequestId: string;
  request: SamplingRequest | ElicitationRequest;
  status: ClientRequestStatus;
  createdAt: string;
  response?: unknown;
}

export interface ExecutionProgress {
  current: number;
  total: number;
  message?: string;
}

export interface ExecutionState {
  // Current execution context
  currentRequestId: string | null;
  isExecuting: boolean;
  progress: ExecutionProgress | null;

  // Pending client requests (sampling/elicitation) triggered during execution
  pendingClientRequests: PendingClientRequest[];

  // Testing profile for sampling/elicitation responses
  activeProfileId: string;
  profiles: TestingProfile[];
}

// Actions
export type ExecutionAction =
  | { type: 'START_EXECUTION'; requestId: string }
  | { type: 'UPDATE_PROGRESS'; progress: ExecutionProgress }
  | { type: 'END_EXECUTION' }
  | { type: 'CANCEL_EXECUTION' }
  | { type: 'ADD_CLIENT_REQUEST'; request: PendingClientRequest }
  | {
      type: 'UPDATE_CLIENT_REQUEST';
      id: string;
      status: ClientRequestStatus;
      response?: unknown;
    }
  | { type: 'REMOVE_CLIENT_REQUEST'; id: string }
  | { type: 'CLEAR_CLIENT_REQUESTS' }
  | { type: 'SET_ACTIVE_PROFILE'; profileId: string }
  | { type: 'ADD_PROFILE'; profile: TestingProfile }
  | { type: 'UPDATE_PROFILE'; profile: TestingProfile }
  | { type: 'DELETE_PROFILE'; profileId: string };

// Initial state
const initialState: ExecutionState = {
  currentRequestId: null,
  isExecuting: false,
  progress: null,
  pendingClientRequests: [],
  activeProfileId: 'manual',
  profiles: mockTestingProfiles,
};

// Reducer
function executionReducer(
  state: ExecutionState,
  action: ExecutionAction
): ExecutionState {
  switch (action.type) {
    case 'START_EXECUTION':
      return {
        ...state,
        currentRequestId: action.requestId,
        isExecuting: true,
        progress: null,
        pendingClientRequests: [],
      };

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        progress: action.progress,
      };

    case 'END_EXECUTION':
      return {
        ...state,
        isExecuting: false,
        progress: null,
      };

    case 'CANCEL_EXECUTION':
      return {
        ...state,
        currentRequestId: null,
        isExecuting: false,
        progress: null,
        pendingClientRequests: [],
      };

    case 'ADD_CLIENT_REQUEST':
      return {
        ...state,
        pendingClientRequests: [...state.pendingClientRequests, action.request],
      };

    case 'UPDATE_CLIENT_REQUEST':
      return {
        ...state,
        pendingClientRequests: state.pendingClientRequests.map((req) =>
          req.id === action.id
            ? { ...req, status: action.status, response: action.response }
            : req
        ),
      };

    case 'REMOVE_CLIENT_REQUEST':
      return {
        ...state,
        pendingClientRequests: state.pendingClientRequests.filter(
          (req) => req.id !== action.id
        ),
      };

    case 'CLEAR_CLIENT_REQUESTS':
      return {
        ...state,
        pendingClientRequests: [],
      };

    case 'SET_ACTIVE_PROFILE':
      return {
        ...state,
        activeProfileId: action.profileId,
      };

    case 'ADD_PROFILE':
      return {
        ...state,
        profiles: [...state.profiles, action.profile],
      };

    case 'UPDATE_PROFILE':
      return {
        ...state,
        profiles: state.profiles.map((p) =>
          p.id === action.profile.id ? action.profile : p
        ),
      };

    case 'DELETE_PROFILE':
      // Cannot delete the active profile or the last profile
      if (
        action.profileId === state.activeProfileId ||
        state.profiles.length <= 1
      ) {
        return state;
      }
      return {
        ...state,
        profiles: state.profiles.filter((p) => p.id !== action.profileId),
      };

    default:
      return state;
  }
}

// Context
interface ExecutionContextValue {
  state: ExecutionState;
  dispatch: Dispatch<ExecutionAction>;
}

const ExecutionContext = createContext<ExecutionContextValue | null>(null);

// Provider
interface ExecutionProviderProps {
  children: ReactNode;
}

export function ExecutionProvider({ children }: ExecutionProviderProps) {
  const [state, dispatch] = useReducer(executionReducer, initialState);

  return (
    <ExecutionContext.Provider value={{ state, dispatch }}>
      {children}
    </ExecutionContext.Provider>
  );
}

// Hook
export function useExecution(): ExecutionContextValue {
  const context = useContext(ExecutionContext);
  if (!context) {
    throw new Error('useExecution must be used within an ExecutionProvider');
  }
  return context;
}

// Helper hook to get active profile
export function useActiveProfile(): TestingProfile | undefined {
  const { state } = useExecution();
  return state.profiles.find((p) => p.id === state.activeProfileId);
}

// Helper hook to get pending requests count
export function usePendingRequestsCount(): number {
  const { state } = useExecution();
  return state.pendingClientRequests.filter((r) => r.status === 'pending').length;
}

// Helper to generate unique request ID
export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Helper to generate client request ID
export function generateClientRequestId(
  parentId: string,
  type: ClientRequestType,
  index: number
): string {
  return `${parentId}-${type}-${index}`;
}

// Helper hook to get current (first pending) request
export function useCurrentPendingRequest(): PendingClientRequest | undefined {
  const { state } = useExecution();
  return state.pendingClientRequests.find((r) => r.status === 'pending');
}

// Helper hook to get count of resolved (completed or rejected) requests
export function useResolvedRequestsCount(): number {
  const { state } = useExecution();
  return state.pendingClientRequests.filter(
    (r) => r.status === 'completed' || r.status === 'rejected'
  ).length;
}
