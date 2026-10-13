"""Kindred voice helper: Kokoro TTS + faster-whisper STT over localhost HTTP.
Started and stopped by the app. Binds 127.0.0.1 only."""
import io, json, os, sys, glob, threading, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
# CUDA libraries from the nvidia-* PyPI wheels (cuBLAS / cuDNN for CTranslate2)
for d in glob.glob(os.path.join(HERE, "venv", "Lib", "site-packages", "nvidia", "*", "bin")):
    os.add_dll_directory(d)
    os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")

import numpy as np

PORT = int(os.environ.get("VOICE_PORT", "8765"))
CFG = {"kokoro_model": os.path.join(HERE, "models", "kokoro-v1.0.onnx"), "kokoro_voices": os.path.join(HERE, "models", "voices-v1.0.bin"),
       "whisper_model": "small", "whisper_device": "auto"}
try:
    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f: CFG.update(json.load(f))
except FileNotFoundError: pass

state = {"tts": None, "stt": None, "device": None, "error": None, "voices": []}
tts_lock, stt_lock = threading.Lock(), threading.Lock()

def log(msg): print(time.strftime("[voice %H:%M:%S] ") + msg, flush=True)

def load():
    log(f"loading Kokoro from {CFG['kokoro_model']}")
    try:
        from kokoro_onnx import Kokoro
        state["tts"] = Kokoro(CFG["kokoro_model"], CFG["kokoro_voices"])
        state["voices"] = sorted(state["tts"].get_voices())
    except Exception as e: state["error"] = f"kokoro: {e}"; log(state["error"])
    log(f"kokoro ok ({len(state['voices'])} voices); loading whisper {CFG['whisper_model']}")
    from faster_whisper import WhisperModel
    tries = [("cuda", "float16"), ("cpu", "int8")] if CFG["whisper_device"] in ("auto", "cuda") else [("cpu", "int8")]
    for dev, ct in tries:
        try:
            m = WhisperModel(CFG["whisper_model"], device=dev, compute_type=ct)
            m.transcribe(np.zeros(16000, dtype=np.float32), language="en")  # warm-up (also proves CUDA works)
            state["stt"], state["device"] = m, f"{dev}/{ct}"
            log(f"whisper ok on {dev}/{ct}")
            break
        except Exception as e: state["error"] = f"whisper {dev}: {e}"; log(state["error"])
    if state["stt"] and state["tts"]: state["error"] = None

def wav_bytes(samples, sr):
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    b = io.BytesIO()
    with wave.open(b, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return b.getvalue()

def read_wav(data):
    with wave.open(io.BytesIO(data)) as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    if ch > 1: a = a.reshape(-1, ch).mean(axis=1)
    if sr != 16000: a = np.interp(np.linspace(0, len(a), int(len(a) * 16000 / sr), endpoint=False), np.arange(len(a)), a).astype(np.float32)
    return a

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        if not isinstance(body, bytes): body = json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def body(self): return self.rfile.read(int(self.headers.get("Content-Length", "0")))
    def do_GET(self):
        if self.path == "/health":
            self.send(200, {"ready": bool(state["tts"] and state["stt"]), "tts": bool(state["tts"]), "stt": bool(state["stt"]), "device": state["device"],
                            "error": state["error"], "voices": state["voices"], "whisper": CFG["whisper_model"]})
        else: self.send(404, {"error": "not found"})
    def do_POST(self):
        try:
            if self.path == "/tts":
                if not state["tts"]: return self.send(503, {"error": "tts not loaded"})
                q = json.loads(self.body()); t0 = time.time()
                with tts_lock: s, sr = state["tts"].create(q["text"], voice=q.get("voice") or "af_heart", speed=float(q.get("speed") or 1.0), lang=q.get("lang") or "en-us")
                out = wav_bytes(s, sr); self.send_response(200)
                self.send_header("Content-Type", "audio/wav"); self.send_header("X-Ms", str(int((time.time() - t0) * 1000))); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
            elif self.path == "/stt":
                if not state["stt"]: return self.send(503, {"error": "stt not loaded"})
                a = read_wav(self.body()); t0 = time.time()
                with stt_lock:
                    segs, _ = state["stt"].transcribe(a, language="en", beam_size=1, vad_filter=True, condition_on_previous_text=False)
                    text = " ".join(s.text.strip() for s in segs).strip()
                self.send(200, {"text": text, "ms": int((time.time() - t0) * 1000), "seconds": round(len(a) / 16000, 2)})
            else: self.send(404, {"error": "not found"})
        except Exception as e: log(f"{self.path} failed: {e}"); self.send(500, {"error": str(e)})

if __name__ == "__main__":
    log(f"python {sys.version.split()[0]} listening on 127.0.0.1:{PORT}")
    threading.Thread(target=load, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()