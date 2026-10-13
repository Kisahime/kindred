# Third-party notices

Kindred is MIT licensed (see LICENSE). It builds on the projects below. Packages marked **bundled** are compiled into the installer; the rest are **downloaded separately by the user** and are not redistributed by this project.

| Component | Use | Licence | Shipped |
|---|---|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) and plugins (autostart, dialog, notification) | desktop shell | MIT or Apache-2.0 | bundled |
| [React](https://github.com/facebook/react) / react-dom | UI | MIT | bundled |
| [Vite](https://github.com/vitejs/vite), [TypeScript](https://github.com/microsoft/TypeScript) | build tools | MIT / Apache-2.0 | build only |
| [rusqlite](https://github.com/rusqlite/rusqlite) + [SQLite](https://sqlite.org) | storage | MIT / public domain | bundled |
| [serde](https://github.com/serde-rs/serde), [reqwest](https://github.com/seanmonstar/reqwest), [tokio](https://github.com/tokio-rs/tokio) and other Rust crates (see `src-tauri/Cargo.lock`) | runtime | MIT and/or Apache-2.0 | bundled |
| [Ollama](https://github.com/ollama/ollama) | local chat engine | MIT | user download |
| Chat models via Ollama (default `qwen3:8b`) | language model | each model's own licence (e.g. Apache-2.0 for Qwen3) | user download |
| [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) | image engine | MIT | user download |
| Image models (Stable Diffusion etc.) | image model | each model's own licence | user download |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | text-to-speech model | Apache-2.0 | user download |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | TTS runtime | MIT (uses espeak-ng, GPL-3.0, via espeakng-loader) | user download |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / [CTranslate2](https://github.com/OpenNMT/CTranslate2) | speech recognition | MIT | user download |
| [OpenAI Whisper models](https://github.com/openai/whisper) | speech model | MIT | user download |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime), [NumPy](https://numpy.org) | voice helper | MIT / BSD-3-Clause | user download |
| NVIDIA CUDA libraries (cuBLAS, cuDNN) | optional GPU speedup | NVIDIA software licence | user download |

Full licence texts for bundled Rust crates can be generated with `cargo about` or `cargo license`, and for npm packages with `npx license-checker`.
