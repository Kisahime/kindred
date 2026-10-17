# Changelog

## 1.3.0 (2026-10-17)

**Living World**
- **Character relationships (opt-in)**: in a character's editor, "People … knows" starts empty; add the people they know (acquaintance, friend, best friend, rival, crush, partner or family) and remove them again. Pairs are mutual, keep affinity, opinions and notes, and slowly evolve from world moments and shared group outings. Nothing is linked automatically; romance and family are only ever set by hand, and family is always platonic. Old auto-created, untouched pairs are cleaned up once on first start.
- **Social feed**: linked characters like, comment on and reply to each other's posts and to your comments. Optional photo posts follow the selfie rules, with a daily limit. Switch and frequency in Options → Living world.
- **Letters & diaries** (💌): characters who may message you first sometimes write letters, and you can write back; close characters keep a diary you can unlock. Saved in the local database.
- **Real weather & seasons (opt-in)**: with the Options switch on and your town shared in your "Me" profile, characters know the current weather where you live (via Open-Meteo, cached for 30 minutes, with an offline fallback to the season). Weather and season feed into chats, scenes and photos.
- **Seasonal events**: New Year, Valentine's Day, Halloween and Christmas messages and a small seasonal strip (Valentine's messages skip family).
- **Character cards**: import Tavern/SillyTavern V1, V2 and V3 cards from PNG or JSON with a preview before saving (age must be 18+, or the card is imported as a protected family character; explicit text never goes into image prompts). Export any character as a V2 PNG card or JSON.

**Protected under-18 family characters**
- Characters under 18 are allowed only as family (son, daughter, child, younger sibling, niece/nephew, grandchild…), marked 🛡️ in the editor. Saving blocks a non-family relationship.
- No pictures of them, ever: no selfies, avatar or appearance generation, feed photos or Image Studio prompts linked to them (also guarded in the image backend). Scene photos with them show only the place; group photos leave them out.
- No romance or 18+ content, regardless of the 18+ switch: a firm wholesome-and-platonic block in their prompt, no dates (hangouts only), no adult gifts, platonic letters and seasonal messages, and character relations limited to friend, best friend, rival, acquaintance or family.
- Card import: cards that appear to describe a minor can only be imported as a protected family character (with an age and family role, romantic/explicit lines removed and no card image); sexual or romantic minor cards are refused, and the triggering words are shown.

**Theme cleanup**
- All new v1.3 views (feed comments, letters and diaries, the seasonal strip, card import, the "People … knows" rows and the protected note) use the theme colours, so they match every theme (default, night, pastel, mint).

## 1.2.1 (2026-10-16)

- Scene and group photo captions/prompts no longer say "at the the …", and skip "the" for personal places ("at Mira's flat", "at my place").
- Group photo requests only pick out a single member when they are clearly named in the request ("photo of Rose", "Rose, smile!"), so names that are also common words no longer trigger by accident; "a photo of you together" no longer adds you to the shot.
- Group outing recaps always name who treated everyone when "they pay" is chosen.
- `npm test` builds the test bundle and runs all test scripts (live checks skip when Ollama is not running).
- Test data no longer uses a real town name.

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
