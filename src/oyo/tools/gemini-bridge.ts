/**
 * OYO → Gemini Live Bridge
 *
 * Converts OYO's ToolDefinition format to Gemini's FunctionDeclaration format
 * so OYO's 7 music tools can be used with the Gemini Live WebSocket API.
 *
 * OYO format:  { name, description, parameters: [{ name, type, description, required }] }
 * Gemini format: { name, description, parameters: { type: 'OBJECT', properties: {}, required: [] } }
 */

import type { ToolDefinition } from './types';

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

/** Convert a single OYO ToolDefinition to Gemini FunctionDeclaration */
export function toGeminiTool(tool: ToolDefinition): GeminiFunctionDeclaration {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];

  for (const p of tool.parameters) {
    properties[p.name] = {
      type: p.type.toUpperCase(),
      description: p.description,
    };
    if (p.required) required.push(p.name);
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'OBJECT',
      properties,
      required,
    },
  };
}

/** Convert all OYO tools to Gemini FunctionDeclaration array */
export function allOyoToolsAsGemini(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map(toGeminiTool);
}
