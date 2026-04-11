/**
 * OYO Tool Parser — extracts <tool_call>…</tool_call> blocks from model text.
 *
 * OYO emits tools as XML so we can detect and route them without depending
 * on Gemini's structured function-calling API. This keeps the layer
 * provider-agnostic for Phase 2/3 when we swap to Gemini Live voice.
 */

import type { ToolCall, ToolResult } from './types';

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const TOOL_TAG_RE = /<tool>([\s\S]*?)<\/tool>/;
const PARAM_TAG_RE = /<(\w+)>([\s\S]*?)<\/\1>/g;

let counter = 0;
function uid(): string {
  counter += 1;
  return `tc_${Date.now().toString(36)}_${counter}`;
}

/**
 * Parse tool calls from a raw model response.
 * Returns the cleaned text (with tool calls stripped) and the extracted calls.
 */
export function parseToolCalls(text: string): {
  cleanText: string;
  toolCalls: ToolCall[];
} {
  const toolCalls: ToolCall[] = [];

  TOOL_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const block = match[1];

    const toolMatch = TOOL_TAG_RE.exec(block);
    if (!toolMatch) continue;
    const toolName = toolMatch[1].trim();

    const params: Record<string, string> = {};
    const paramRe = new RegExp(PARAM_TAG_RE.source, 'g');
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(block)) !== null) {
      const tag = paramMatch[1];
      if (tag === 'tool') continue;
      params[tag] = paramMatch[2].trim();
    }

    toolCalls.push({ id: uid(), tool: toolName, params });
  }

  const cleanText = text.replace(TOOL_CALL_RE, '').trim();
  return { cleanText, toolCalls };
}

/**
 * Format tool results into a string the model can read back
 * (for multi-turn tool loops).
 */
export function formatToolResults(results: ToolResult[]): string {
  return results
    .map((r) => {
      const status = r.success ? 'success' : 'error';
      return `<tool_result tool="${r.tool}" status="${status}">\n${r.data}\n</tool_result>`;
    })
    .join('\n\n');
}
