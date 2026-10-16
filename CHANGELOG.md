# Changelog

## 1.2.0 (2026-10-16)

- **Group outings (Together mode for group chats)**: meet up with a group in person at any place preset or custom spot, with member schedule checks, N-way Sparkles cost splitting (or a close friend offering to treat), scene cards and place backgrounds.
- **Planned group hangouts**: plan a group outing for later (automatically finding the next overlapping free window across everyone's schedules), with ready notifications and upcoming group plans in the "What's new" feed.
- **Group narrator, photos & gifts in person**: optional group scene narrator (every few turns or via `>>` / `/narrate`), group scene photos (the whole group, the group with you, or a single member), and in-person gifting to any attending member.
- **Group recaps**: ending a group outing writes a shared recap, saves a memory for each attendee, updates each attendee's mood and closeness, records first-hangout milestones, and posts an attendee's status update to the feed.
- Styled `*action*` text in all group chats, and automatic pausing of 1-to-1 proactive events while a character is out with a group.

## 1.1.0 (2026-10-14)

- **Together mode**: meet a character in person. Pick a place (16 presets or your own), a time of day and who pays; the chat turns into an in-person scene with styled actions (*like this*), a scene card (place, time, season, weather) and a recap when you part.
- Optional narrator that describes the scene every few turns (or on demand with `>>` / `/narrate`).
- Meet-up costs in Sparkles (you pay, they pay, split, or free places), and characters can invite you out themselves.
- Plan for later: arrange a meet-up for a set time; it starts when it is due.
- Place backgrounds: an optional generated picture of the place behind the scene, softly blurred, with a "Picture strength" slider in Options.
- Scene photos: ask for a photo together during a scene. They follow the same rules as selfies (adults only, nothing explicit; worn gifts like lingerie only in private places).
- Gifts in person: hand over an item during a scene, and characters may occasionally give you something.
- Optional follow-up message after a meet-up (can be switched off).
- Fixed: gift messages could read as if the gift went the wrong way.
- Smaller start-up chunk: React is split into its own bundle.

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
