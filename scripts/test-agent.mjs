import WebSocket from "ws";

const API_KEY = "sk_f4c84adcedafc99d75e84c819eca7f41a24ee050aadd7baf";
const AGENT_ID = "agent_3301krzwv465era9rh33d39h9xtn";

async function main() {
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`, {
    headers: { "xi-api-key": API_KEY },
  });
  const { signed_url } = await r.json();
  console.log("Signed URL:", signed_url.slice(0, 100));

  const ws = new WebSocket(signed_url);
  let initialized = false;

  ws.on("open", () => {
    console.log("[OPEN]");
    ws.send(JSON.stringify({
      type: "conversation_initiation_client_data",
      conversation_config_override: { conversation: { text_only: true } },
    }));
  });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    console.log(`[MSG] type=${msg.type}`, JSON.stringify(msg).slice(0, 400));
    if (msg.type === "conversation_initiation_metadata" && !initialized) {
      initialized = true;
      console.log("[SEND user_message]");
      ws.send(JSON.stringify({
        type: "user_message",
        text: "Write a 4-line lullaby for a child named Mira about stars and dreams.",
      }));
    }
    if (msg.type === "agent_response") {
      console.log("\n=== AGENT RESPONSE ===");
      console.log(msg.agent_response_event?.agent_response);
      console.log("======================\n");
      ws.close();
    }
  });

  ws.on("error", (err) => console.error("[ERROR]", err));
  ws.on("close", (code, reason) => {
    console.log(`[CLOSE] code=${code} reason=${reason.toString()}`);
    process.exit(0);
  });

  setTimeout(() => {
    console.log("[TIMEOUT 25s]");
    ws.close();
    process.exit(1);
  }, 25000);
}

main();
