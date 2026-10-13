import { streamChat } from "../dist-test/ollama.js";
const model = process.argv[2] || "qwen3:8b";
let n = 0; const t0 = Date.now();
const full = await streamChat(model, [{ role: "system", content: "You are Mira, a warm tea-shop owner. Short IM-style replies." }, { role: "user", content: "hi mira! how was your day?" }],
  { onToken: (t) => { n++; process.stdout.write(t); } });
console.log(`\n--- ${model}: ${n} tokens, ${full.length} chars, ${Date.now() - t0} ms`);