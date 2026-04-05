/**
 * WoClaw Plugin for OpenCode
 * 
 * Connects OpenCode to WoClaw Hub for:
 * - Shared memory (read/write/list/delete)
 * - Topic messaging (join/leave/send)
 * - Session context sharing on start/compaction
 * 
 * Install:
 *   1. Place this file in ~/.config/opencode/plugins/woclaw.js
 *   2. Or add "opencode-woclaw" to your opencode.json plugins list
 *   3. Set environment variables:
 *      WOCLAW_HUB_URL=ws://vm153:8082
 *      WOCLAW_TOKEN=WoClaw2026
 *      WOCLAW_AGENT_ID=opencode-{hostname}
 */

import { tool } from "@opencode-ai/plugin";

const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || "ws://localhost:8080";
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || "WoClaw2026";
const WOCLAW_AGENT_ID = process.env.WOCLAW_AGENT_ID || `opencode-${require("os").hostname()}`;
const WOCLAW_REST_URL = process.env.WOCLAW_REST_URL || WOCLAW_HUB_URL.replace("ws://", "http://").replace("wss://", "https://") + ":8083";

// ============================================================================
// WoClaw REST API helpers
// ============================================================================

async function woclawRequest(endpoint, options = {}) {
  const url = `${WOCLAW_REST_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${WOCLAW_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WoClaw API error ${response.status}: ${text}`);
  }
  
  return response.json();
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const WoClawPlugin = async ({ client, directory }) => {
  console.log("[WoClaw] Plugin initialized. Hub:", WOCLAW_HUB_URL);

  return {
    // -------------------------------------------------------------------------
    // Shell: inject WoClaw env vars into all shell executions
    // -------------------------------------------------------------------------
    "shell.env": async (input, output) => {
      output.env.WOCLAW_HUB_URL = WOCLAW_HUB_URL;
      output.env.WOCLAW_REST_URL = WOCLAW_REST_URL;
      output.env.WOCLAW_TOKEN = WOCLAW_TOKEN;
      output.env.WOCLAW_AGENT_ID = WOCLAW_AGENT_ID;
    },

    // -------------------------------------------------------------------------
    // Session: share context on session start and compaction
    // -------------------------------------------------------------------------
    "session.created": async ({ session }) => {
      try {
        // Try to load shared project context from WoClaw Hub
        const projectKey = process.env.WOCLAW_PROJECT_KEY || "project:context";
        const data = await woclawRequest(`/memory/${projectKey}`);
        
        if (data.exists && data.value) {
          console.log(`[WoClaw] Loaded shared context (${data.value.length} chars)`);
          // The context can be injected into the session via client
          // For now just log - actual injection depends on OpenCode API
        } else {
          console.log("[WoClaw] No shared context found");
        }
      } catch (err) {
        console.log("[WoClaw] Could not load shared context:", err.message);
      }
    },

    "session.compacted": async ({ session }) => {
      try {
        const projectKey = process.env.WOCLAW_PROJECT_KEY || "project:context";
        const sessionSummary = `[${new Date().toISOString()}] OpenCode session snapshot`;
        
        await woclawRequest("/memory", {
          method: "POST",
          body: JSON.stringify({
            key: projectKey,
            value: sessionSummary,
            updatedBy: WOCLAW_AGENT_ID,
          }),
        });
        
        console.log("[WoClaw] Session snapshot saved to Hub");
      } catch (err) {
        console.log("[WoClaw] Could not save session snapshot:", err.message);
      }
    },

    // -------------------------------------------------------------------------
    // Custom Tools: WoClaw memory and topic management
    // -------------------------------------------------------------------------
    tool: {
      /**
       * woclaw_memory_read - Read from WoClaw shared memory
       */
      woclaw_memory_read: tool({
        description: "Read a value from WoClaw Hub's shared memory pool. Use to fetch shared context written by other agents (OpenClaw, Claude Code, etc.)",
        args: {
          key: tool.schema.string({
            description: "Memory key to read",
          }),
        },
        async execute(args) {
          try {
            const data = await woclawRequest(`/memory/${args.key}`);
            if (!data.exists) {
              return `Key "${args.key}" not found in WoClaw Hub memory.`;
            }
            return `Value: ${data.value}\n(Last updated: ${data.updatedAt || "unknown"})`;
          } catch (err) {
            return `Error reading memory: ${err.message}`;
          }
        },
      }),

      /**
       * woclaw_memory_write - Write to WoClaw shared memory
       */
      woclaw_memory_write: tool({
        description: "Write a value to WoClaw Hub's shared memory pool. Other agents (OpenClaw, Claude Code, etc.) can read this with woclaw_memory_read. Useful for sharing project context, discoveries, and key decisions.",
        args: {
          key: tool.schema.string({ description: "Memory key" }),
          value: tool.schema.string({ description: "Value to store" }),
        },
        async execute(args) {
          try {
            await woclawRequest("/memory", {
              method: "POST",
              body: JSON.stringify({
                key: args.key,
                value: args.value,
                updatedBy: WOCLAW_AGENT_ID,
              }),
            });
            return `✅ Written "${args.key}" = "${args.value}" to WoClaw Hub`;
          } catch (err) {
            return `Error writing memory: ${err.message}`;
          }
        },
      }),

      /**
       * woclaw_memory_list - List all shared memory keys
       */
      woclaw_memory_list: tool({
        description: "List all keys in WoClaw Hub's shared memory pool.",
        args: {},
        async execute() {
          try {
            const data = await woclawRequest("/memory");
            if (!data.keys || data.keys.length === 0) {
              return "WoClaw Hub memory is empty.";
            }
            return "Memory keys:\n" + data.keys.map(k => `  - ${k}`).join("\n");
          } catch (err) {
            return `Error listing memory: ${err.message}`;
          }
        },
      }),

      /**
       * woclaw_memory_delete - Delete a shared memory key
       */
      woclaw_memory_delete: tool({
        description: "Delete a key from WoClaw Hub's shared memory pool.",
        args: {
          key: tool.schema.string({ description: "Memory key to delete" }),
        },
        async execute(args) {
          try {
            await woclawRequest(`/memory/${args.key}`, { method: "DELETE" });
            return `✅ Deleted "${args.key}" from WoClaw Hub`;
          } catch (err) {
            return `Error deleting memory: ${err.message}`;
          }
        },
      }),

      /**
       * woclaw_topics_list - List available WoClaw topics
       */
      woclaw_topics_list: tool({
        description: "List all topics available on WoClaw Hub.",
        args: {},
        async execute() {
          try {
            const data = await woclawRequest("/topics");
            if (!data.topics || data.topics.length === 0) {
              return "No topics found on WoClaw Hub.";
            }
            return "Topics:\n" + data.topics.map(t => `  - ${t.name} (${t.memberCount || 0} members)`).join("\n");
          } catch (err) {
            return `Error listing topics: ${err.message}`;
          }
        },
      }),

      /**
       * woclaw_hub_status - Check WoClaw Hub connection status
       */
      woclaw_hub_status: tool({
        description: "Check if WoClaw Hub is reachable and report its status.",
        args: {},
        async execute() {
          try {
            const data = await woclawRequest("/health");
            return `✅ WoClaw Hub is online!\nUptime: ${data.uptime ? Math.floor(data.uptime / 3600) + "h" : "unknown"}\nAgents: ${data.agents || 0}\nTopics: ${data.topics || 0}`;
          } catch (err) {
            return `❌ WoClaw Hub unreachable: ${err.message}`;
          }
        },
      }),
    },
  };
};

export default WoClawPlugin;
