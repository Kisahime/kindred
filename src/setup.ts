// First-run setup checklist: what is installed and what is optional.
export interface SetupProbe { ollama: boolean; models: string[]; defaultModel: string; image: boolean; voice: boolean; }
export interface SetupItem { key: "ollama" | "model" | "image" | "voice"; label: string; ok: boolean; required: boolean; hint: string; links: { label: string; url: string }[]; }

export const SETUP_LINKS = {
  ollama: { label: "Ollama download", url: "https://ollama.com/download" },
  sd: { label: "stable-diffusion.cpp releases", url: "https://github.com/leejet/stable-diffusion.cpp/releases" },
  kokoro: { label: "Kokoro-82M", url: "https://huggingface.co/hexgrad/Kokoro-82M" },
  kokoroOnnx: { label: "kokoro-onnx (model files)", url: "https://github.com/thewh1teagle/kokoro-onnx/releases" },
  whisper: { label: "faster-whisper", url: "https://github.com/SYSTRAN/faster-whisper" },
};

const hasModel = (models: string[], m: string) => {
  const want = m.includes(":") ? m : `${m}:latest`;
  return models.some((x) => x === m || x === want);
};

export function setupStatus(p: SetupProbe): SetupItem[] {
  return [
    { key: "ollama", label: "Ollama (chat engine)", ok: p.ollama, required: true,
      hint: p.ollama ? "Ollama is running." : "Install Ollama and start it. Chat needs it.", links: [SETUP_LINKS.ollama] },
    { key: "model", label: `Chat model "${p.defaultModel}"`, ok: p.ollama && hasModel(p.models, p.defaultModel), required: true,
      hint: !p.ollama ? "Start Ollama first." : hasModel(p.models, p.defaultModel) ? "Installed." :
        p.models.length ? `Not installed. Run: ollama pull ${p.defaultModel}  (or pick one of your ${p.models.length} installed models per character).` : `No models yet. Run: ollama pull ${p.defaultModel}`,
      links: [] },
    { key: "image", label: "Image engine (optional)", ok: p.image, required: false,
      hint: p.image ? "stable-diffusion.cpp found." : "Optional. Put sd-cli.exe in engine\\sd-cuda12 and set it in Image Studio. The app works without it.", links: [SETUP_LINKS.sd] },
    { key: "voice", label: "Voice calls (optional)", ok: p.voice, required: false,
      hint: p.voice ? "Voice helper installed." : "Optional. Run setup-voice.ps1 (Kokoro + faster-whisper). The app works without it.", links: [SETUP_LINKS.kokoro, SETUP_LINKS.kokoroOnnx, SETUP_LINKS.whisper] },
  ];
}

export const setupReady = (items: SetupItem[]) => items.filter((i) => i.required).every((i) => i.ok);
