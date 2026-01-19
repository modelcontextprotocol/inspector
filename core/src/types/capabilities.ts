/**
 * Experimental capabilities configuration types
 */

export interface ExperimentalCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  warning?: string;
}
