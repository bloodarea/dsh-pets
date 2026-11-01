# DSH Pets

**Cross-platform desktop pets for DeepSeek Harness.**

[English](README.md) | [简体中文](README_zh.md)

DSH Pets brings your running AI agent sessions onto the desktop through animated characters, event-driven voice lines, and actionable notifications. Keep an eye on parallel tasks, jump to the right session, and know when an agent needs you—without constantly checking the DSH Web interface.

> **Project status: early development.** This README describes the intended product and development milestones. Features listed as planned are **not** claims that they are already implemented. The project builds on ideas and code from [zuodazuoqiang001/dsh-pet](https://github.com/zuodazuoqiang001/dsh-pet), a Windows desktop-pet plugin for DSH.

## What it does

The product is organized around four focused modules:

| Module | Planned capabilities |
| --- | --- |
| **Session Management** | Show active top-level DSH sessions, quickly switch to a selected session, and notify on task completion, failure, or approval requests. Keep missed notifications accessible. |
| **Character System** | Display Spine characters or sprite-sheet pets, associate characters with model identities, and map agent states to expressions and motions. |
| **Voice System** | Play **pre-recorded voice lines** for events, with character-specific voice packs, volume/mute controls, cooldowns, and optional lip sync. |
| **Desktop Interaction** | Transparent floating window, drag/position persistence, system tray, click-through behavior, do-not-disturb mode, and basic performance settings. |

**Two non-negotiable capabilities:**

1. **Switch between running sessions quickly** from the desktop pet's session list or bubbles.
2. **Receive reliable task-completion alerts**, including an actionable path back to the corresponding session.

Character animation and voice make these workflows more expressive; they must never prevent session controls and notifications from working.

## How it should feel

- **Working:** a character reacts to an active agent; session bubbles show what is still running.
- **Needs attention:** the character signals an approval request and offers a direct session shortcut.
- **Completed:** an animation and optional recorded line announce the result; the notification remains available until reviewed.
- **Idle:** the character returns to subtle idle motions without interrupting desktop work.
- **Multiple agents:** notifications are queued or coalesced instead of playing several voice lines simultaneously.

Characters may be mapped to model families (for example, DeepSeek, Claude, or GPT), with manual overrides. A session remains identified by its **session ID** even if the model changes.

## Planned architecture

```text
DeepSeek Harness (DSH Web / Cordis plugin)
  ├─ Session and agent status
  ├─ Task completion / failure / approval events
  └─ Session focus and navigation
                 │
                 │ Local, restricted communication
                 ▼
Electron desktop companion (main process)
  ├─ Connection / notification / session controllers
  ├─ Window, tray, platform integration
  └─ React + TypeScript UI
       ├─ Session bubbles and notification history
       ├─ Spine renderer (primary character format)
       ├─ Static-image fallback (no GPU / reduced mode)
       └─ Pre-recorded voice playback + optional lip sync
```

**Target platforms:** Windows, Linux, and macOS. Initial desktop verification is planned for **Ubuntu 24.04 Desktop with DSH Web**, with Windows and macOS compatibility tests following. Linux X11/XWayland and native Wayland have different restrictions around global window positioning, always-on-top behavior, and focus; support will be documented based on real testing rather than assumed.

### Character assets

Character packs are self-contained directories with a single contract file. The bundled default pack ships inside the package; every other pack is downloaded on demand into the user's data directory, which takes precedence over the bundled copy.

```text
assets/characters/                 # bundled, read-only
  index.json                       # downloadable-pack index (version, sha256, url)
  deepseek/                        # the only pack shipped with the package
    manifest.json
    LICENSE
    preview.webp
    spine/                         # Spine skeleton, atlas and textures
    voice/                         # pre-recorded status lines (optional per event)

~/.dsh/pets/characters/<id>/       # downloaded, writable, overrides the bundled copy
```

`manifest.json` is the contract, so the runtime never guesses file names. It declares the Spine entry plus scale and anchor, the agent-state → animation mapping (`idle`, `working`, `attention`, `done`, `failed`), which voice lines exist for each event, and a static-image fallback for machines without GPU acceleration. A pack may omit a voice event, and that event simply stays silent.

This layout is the **agreed target**, not yet implemented. Voice lines are recorded or generated **ahead of time** and shipped inside a character pack. **There is no runtime text-to-speech generation requirement**, no mandatory TTS API, and no need to send session text to a speech provider.

Tools for producing illustrations, skeleton animation, or audio may be used **offline during asset creation**; they are not part of the DSH Pets runtime.

## Roadmap

### v0.1 — Usable desktop companion

- [ ] DSH plugin connection and reliable per-session state tracking
- [ ] Active-session bubbles/list and one-click session navigation
- [ ] Completion, failure, and approval alerts with deduplication
- [ ] Missed/unread notifications and safe reconnection behavior
- [ ] Cross-platform desktop window and tray foundation
- [ ] Spine character rendering with static-image fallback
- [ ] Pre-recorded voice playback, mute, and event cooldown
- [ ] Dragging, remembered position, and basic do-not-disturb controls
- [ ] Ubuntu 24.04 end-to-end verification

### Later improvements

- [ ] Model-to-character mapping, character-pack management UI, and on-demand pack download
- [ ] Better mouth-motion synchronization and natural idle interactions
- [ ] Edge docking, auto-hide, and configurable mouse pass-through
- [ ] Power-saving / reduced-frame-rate mode
- [ ] Wider Windows, macOS, X11, and Wayland compatibility coverage

The roadmap is indicative and may change as implementation and compatibility testing progress.

## Installation

**No stable cross-platform release is documented yet.** Once an installable version is available, installation steps and supported DSH versions will be published here. Please do not assume the original Windows-only `dsh-pet` installation instructions apply to this project.

## Reliability, privacy, and resource usage

Design priorities:

- Prefer explicit task lifecycle signals; losing connectivity must **not** be mistaken for successful completion.
- Deduplicate completion events, retain unread notices, and restore the visible state after reconnection when supported by DSH.
- Keep controls usable when the character renderer, audio, or GPU acceleration is unavailable.
- Keep communication local by default and restrict exposed control endpoints; remote-access configurations must be secured separately.
- Do not read task contents aloud by default. Recorded voice lines communicate predefined **status messages**, not arbitrary code, secrets, or chat content.
- Provide mute, do-not-disturb, and lower-resource options for long-running desktop use.

These are **engineering goals**, not a security audit or a claim of completed functionality.

## Development and contributions

The project is in an early stage. Issues, platform-specific bug reports, and reproducible test cases are welcome. Before proposing new features, please prioritize the two core workflows: **session switching** and **reliable completion notifications**.

## Attribution and licensing

### Project code

DSH Pets is intended to evolve from [zuodazuoqiang001/dsh-pet](https://github.com/zuodazuoqiang001/dsh-pet), which is published under the **MIT License**. Any reused upstream code retains its original copyright and license notices, and this repository should carry the applicable `LICENSE` file.

### Character packs: CC BY-NC-SA 4.0, non-commercial

The bundled `deepseek` pack is built on community fan artwork and is distributed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)), following the original author's [copyright statement](https://www.bilibili.com/opus/1247156596114456581).

- **Attribution is mandatory**: 上善无形 / 上善 for the original character and ZipZipPipe for the DeepSeek redesign ([author page](https://space.bilibili.com/4168597)); each pack credits its own contributors in `CREDITS.md`.
- **Commercial use is not permitted, in any form.** This project grants no commercial license.
- **Share-alike**: adaptations of the artwork must be released under the same CC BY-NC-SA 4.0 license, with modifications indicated.
- The packs exist for **open-source learning and personal use** only.
- Every pack ships its own `LICENSE` and `CREDITS.md` beside its assets — see [assets/characters/deepseek/LICENSE](assets/characters/deepseek/LICENSE) and [CREDITS.md](assets/characters/deepseek/CREDITS.md) for the full provenance chain and the assets deliberately **not** included.
- **Takedown**: if a rights holder objects to any included asset, open an [issue](https://github.com/bloodarea/dsh-pets/issues) with the file path and a verifiable source; the asset will be removed after verification. CC licenses are irrevocable, so this commits us to stopping distribution, not to amending the license.
- Character packs are themed after model families but are **not** official brand material.

### Trademarks

Names and marks such as DeepSeek, Claude, GPT, Kimi, and Qwen belong to their respective owners. Nothing in this project implies affiliation with or endorsement by any of them.

### Spine runtime

Spine runtimes and exported animation data are subject to Esoteric Software's commercial licensing terms; confirm the applicable terms before shipping. Other third-party SDKs and assets keep their own licenses.

---

**DSH Pets** — A small, always-available desktop entry point for your AI agent sessions.
