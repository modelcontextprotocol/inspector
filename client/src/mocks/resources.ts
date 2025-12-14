export interface Resource {
  uri: string;
  mimeType: string;
  annotations?: {
    audience?: 'user' | 'application';
    priority?: number; // 0-1
  };
}

export interface ResourceTemplate {
  uriTemplate: string;
  description: string;
}

export interface Subscription {
  uri: string;
  lastUpdated: string;
}

export const mockResources: Resource[] = [
  {
    uri: 'file:///config.json',
    mimeType: 'application/json',
    annotations: { audience: 'application', priority: 0.9 },
  },
  {
    uri: 'file:///readme.md',
    mimeType: 'text/markdown',
    annotations: { audience: 'user' },
  },
  {
    uri: 'file:///data.csv',
    mimeType: 'text/csv',
    annotations: { priority: 0.5 },
  },
];

export const mockTemplates: ResourceTemplate[] = [
  { uriTemplate: 'user/{id}', description: 'Get user by ID' },
  { uriTemplate: 'file/{path}', description: 'Read file by path' },
];

export const mockSubscriptions: Subscription[] = [
  { uri: 'file:///config.json', lastUpdated: '2025-11-30T14:32:05Z' },
];
