/**
 * Send a single text message to an ElevenLabs Conversational AI Agent
 * (text-only mode) and return the full text response.
 *
 * Uses the same WebSocket protocol as the official Conversation SDK but
 * implemented minimally for Node.js server-side single-shot text generation.
 *
 * Flow:
 *   1. GET /v1/convai/conversation/get-signed-url?agent_id=... → signed wss URL
 *   2. WebSocket.connect(signed_url)
 *   3. Send {"type":"conversation_initiation_client_data"} with text-only override
 *   4. Send {"type":"user_message","text":"..."}
 *   5. Collect "agent_response" messages until done
 *   6. Close WebSocket and return concatenated text
 *
 * Reference:
 *   - .agents/skills/agents/SKILL.md
 *   - MoodCast enhance.mjs (uses same protocol via the SDK)
 */
import WebSocket from "ws";

import { getServerEnv } from "@/lib/env";

interface AgentChatOptions {
  /** Agent id created via the dashboard or API. */
  agentId: string;
  /** The user's message to send. */
  message: string;
}

interface ElevenLabsWsMessage {
  type: string;
  agent_response_event?: { agent_response?: string };
  agent_chat_response_part?: never;
  text_response_part?: { type: string; text?: string; event_id?: number };
  audio_event?: unknown;
  user_transcription_event?: unknown;
  conversation_initiation_metadata_event?: unknown;
  ping_event?: { event_id: number };
}

/**
 * Get a signed WebSocket URL for the given agent.
 */
async function getSignedUrl(agentId: string): Promise<string> {
  const env = getServerEnv();
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `agent_signed_url_failed_${response.status}: ${errorText.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as { signed_url: string };
  if (!data.signed_url) {
    throw new Error("agent_signed_url_missing");
  }
  return data.signed_url;
}

/**
 * Send a single message to a text-only ElevenLabs agent and return the
 * full agent response as a string.
 */
export async function chatWithAgent(opts: AgentChatOptions): Promise<string> {
  const { agentId, message } = opts;
  const signedUrl = await getSignedUrl(agentId);

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(signedUrl);
    let response = "";
    let initialized = false;
    let done = false;

    const finish = (result: string | null, error?: Error) => {
      if (done) return;
      done = true;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch {
        /* ignore */
      }
      if (error) reject(error);
      else resolve(result!);
    };

    ws.on("open", () => {
      // Send the conversation initiation with text-only override.
      ws.send(
        JSON.stringify({
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            conversation: { text_only: true },
          },
        }),
      );
    });

    ws.on("message", (raw) => {
      let msg: ElevenLabsWsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "conversation_initiation_metadata":
          // Server is ready; send the user message.
          if (!initialized) {
            initialized = true;
            ws.send(
              JSON.stringify({
                type: "user_message",
                text: message,
              }),
            );
          }
          break;

        case "agent_chat_response_part": {
          // Streaming text response. Collect delta parts until stop.
          const part = msg.text_response_part;
          if (part?.type === "delta" && part.text) {
            response += part.text;
          } else if (part?.type === "stop") {
            // Final delta received. Resolve immediately.
            if (response.trim()) {
              finish(response.trim());
            } else {
              finish(null, new Error("agent_empty_response"));
            }
          }
          break;
        }

        case "agent_response":
          // Some agents/configurations send a single agent_response with the
          // full text. Treat it as a fallback completion signal.
          if (msg.agent_response_event?.agent_response) {
            response = msg.agent_response_event.agent_response;
            finish(response.trim());
          }
          break;

        case "ping":
          // Reply with pong to keep the connection alive.
          if (msg.ping_event?.event_id !== undefined) {
            ws.send(
              JSON.stringify({
                type: "pong",
                event_id: msg.ping_event.event_id,
              }),
            );
          }
          break;

        default:
          // Ignore audio_event, vad_score, internal_tentative_agent_response, etc.
          break;
      }
    });

    ws.on("error", (err: Error) => {
      finish(null, new Error(`agent_ws_error: ${err.message}`));
    });

    ws.on("close", (code: number, reason: Buffer) => {
      if (!done) {
        if (response.trim()) {
          finish(response.trim());
        } else {
          finish(
            null,
            new Error(
              `agent_ws_closed: code=${code}, reason=${reason.toString().slice(0, 200)}`,
            ),
          );
        }
      }
    });
  });
}
