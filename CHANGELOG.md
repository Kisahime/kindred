# Changelog

## 1.0.0 (2026-10-13)

First public release.

- Runs from source: `start.bat` checks requirements (offering winget installs only after asking), offers updates, installs packages, builds when the source changed and starts the app. `start.bat dev` and `start.bat check` modes. No installer.

- Messenger-style desktop app for chatting with local AI characters (Ollama), with moods, memories, groups, a feed and proactive messages.
- Character editor, template gallery with generic adult sample characters, and AI-assisted character creation.
- Optional image generation through stable-diffusion.cpp (Image Studio, selfies, saved prompts).
- Optional voice calls (Kokoro TTS + faster-whisper STT, all local).
- Sparkles economy: café, shopping centre, daily items, gifts and offers between you and your characters.
- "Me" profile that controls what characters know about you.
- Data backups and restore from Options.
- First-run setup checklist that detects Ollama, models, the image engine and the voice helper.
- 18+ content is off by default and needs a confirmation to enable.
