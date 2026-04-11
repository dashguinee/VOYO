/**
 * OYO Tool Types — shared type definitions for the OYO tool system.
 *
 * OYO calls tools via XML blocks in its text response, which the parser
 * extracts and the registry dispatches to the actual handlers. Each tool
 * defines its parameters and an execute() function that performs the action.
 */

export interface ToolCall {
  id: string;
  tool: string;
  params: Record<string, string>;
}

export interface ToolResult {
  toolCallId: string;
  tool: string;
  success: boolean;
  data: string;
  metadata?: Record<string, unknown>;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, string>) => Promise<ToolResult>;
}
