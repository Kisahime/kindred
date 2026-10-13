import { Channel, invoke } from "@tauri-apps/api/core";

export const OLLAMA_URL = "http://localhost:11434";
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
type ChatEvent = { kind: "token" | "thinking" | "done" | "error"; data: string };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** No reply token within this time -> give up with a message. */
export const FIRST_TOKEN_TIMEOUT_MS = 120_000;

export async function listModels(): Promise<string[]> {
  if (isTauri) return invoke<string[]>("ollama_models");
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`);
  return ((await res.json()).models ?? []).map((m: { name: string }) => m.name);
}

export interface StreamHandlers { onToken: (t: string) => void; onThinking?: () => void; }

/** Streams a reply. think:false so reasoning models (e.g. qwen3) answer directly. */
export function streamChat(model: string, messages: ChatMessage[], h: StreamHandlers): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false, gotToken = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => finish(() => reject(new Error(
      `No reply after ${FIRST_TOKEN_TIMEOUT_MS / 1000}s - is the model loading or too big?`))), FIRST_TOKEN_TIMEOUT_MS);
    const onEvent = (ev: ChatEvent) => {
      if (settled) return;
      switch (ev.kind) {
        case "token": if (!gotToken) { gotToken = true; clearTimeout(timer); } h.onToken(ev.data); break;
        case "thinking": h.onThinking?.(); break;
        case "error": finish(() => reject(new Error(ev.data))); break;
        case "done": finish(() => ev.data.trim() ? resolve(ev.data)
          : reject(new Error(`${model} returned an empty reply.`))); break;
      }
    };
    if (isTauri) {
      const ch = new Channel<ChatEvent>(); ch.onmessage = onEvent;
      invoke("ollama_chat", { model, messages, think: false, onEvent: ch })
        .catch((e) => finish(() => reject(new Error(String(e)))));
    } else {
      browserStream(model, messages, onEvent).catch((e) => onEvent({ kind: "error", data: String(e) }));
    }
  });
}

/** Browser fallback (vite dev in a normal browser): fetch + NDJSON buffering. */
export async function browserStream(model: string, messages: ChatMessage[], emit: (e: ChatEvent) => void, url = OLLAMA_URL) {
  const res = await fetch(`${url}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, think: false }) });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  let full = "";
  const handle = (line: string): boolean => {
    line = line.trim(); if (!line) return false;
    const o = JSON.parse(line);
    if (o.error) throw new Error(o.error);
    if (o.message?.thinking) emit({ kind: "thinking", data: o.message.thinking });
    if (o.message?.content) { full += o.message.content; emit({ kind: "token", data: o.message.content }); }
    return !!o.done;
  };
  if (!res.body) { for (const l of (await res.text()).split("\n")) handle(l); emit({ kind: "done", data: full }); return; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (handle(line)) { emit({ kind: "done", data: full }); return; }
    }
    if (done) break;
  }
  handle(buf + dec.decode()); emit({ kind: "done", data: full });
}