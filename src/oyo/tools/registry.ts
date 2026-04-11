/**
 * OYO Tool Registry — central dispatch for all OYO tools.
 *
 * Registers the music action tools and exposes a single executeTool() entry
 * point. Provides getToolDescriptions() for system-prompt injection so OYO
 * knows what it can call, though the main character prompt already lists
 * them inline for clarity.
 */

import type { ToolCall, ToolDefinition, ToolResult } from './types';
import { MUSIC_TOOLS } from './music';

const registry = new Map<string, ToolDefinition>();

function register(tool: ToolDefinition): void {
  registry.set(tool.name, tool);
}

for (const tool of MUSIC_TOOLS) {
  register(tool);
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function listTools(): ToolDefinition[] {
  return [...registry.values()];
}

export function getToolDescriptions(): string {
  const lines: string[] = ['Available tools OYO can call:'];
  for (const tool of registry.values()) {
    const paramList = tool.parameters
      .map((p) => `${p.name} (${p.type}${p.required ? ', required' : ''})`)
      .join(', ');
    lines.push(`- ${tool.name}(${paramList}) — ${tool.description}`);
  }
  return lines.join('\n');
}

/**
 * Execute a parsed ToolCall, dispatching to the registered handler.
 * Never throws — always returns a ToolResult, even on error.
 */
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const tool = registry.get(call.tool);
  if (!tool) {
    return {
      toolCallId: call.id,
      tool: call.tool,
      success: false,
      data: `Unknown tool: ${call.tool}`,
    };
  }

  try {
    const result = await tool.execute(call.params);
    result.toolCallId = call.id;
    return result;
  } catch (err) {
    return {
      toolCallId: call.id,
      tool: call.tool,
      success: false,
      data: `Tool execution failed: ${String(err)}`,
    };
  }
}

/**
 * Execute many tool calls in sequence (tools may depend on each other, e.g.
 * searchByVibe then addToQueue).
 */
export async function executeTools(calls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls) {
    results.push(await executeTool(call));
  }
  return results;
}
