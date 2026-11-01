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
| **Character System** | Display Live2D characters or sprite-sheet pets, associate characters with model identities, and map agent states to expressions and motions. |
| **Voice System** | Play **pre-recorded voice lines** for events, with character-specific voice packs, volume/mute controls, cooldowns, and optional lip sync. |
| **Desktop Interaction** | Transparent floating window, drag/position persistence, system tray, click-through behavior, do-not-disturb mode, and basic performance settings. |

**Two non-negotiable capabilities:**

1. **Switch between running sessions quickly** from the desktop pet's session list or bubbles.
2. **Receive reliable task-completion alerts**, including an actionable path back to the corresponding session.

Live2D animation and voice make these workflows more expressive; they must never prevent session controls and notifications from working.

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
       ├─ Live2D renderer (Cubism SDK for Web)
       ├─ Sprite renderer (fallback)
       └─ Pre-recorded voice playback + optional lip sync
```

**Target platforms:** Windows, Linux, and macOS. Initial desktop verification is planned for **Ubuntu 24.04 Desktop with DSH Web**, with Windows and macOS compatibility tests following. Linux X11/XWayland and native Wayland have different restrictions around global window positioning, always-on-top behavior, and focus; support will be documented based on real testing rather than assumed.

### Character assets

Each character can have its own model, motions, expressions, and recorded audio clips. A possible asset layout is:

```text
characters/
  example-character/
    manifest.json
    live2d/                # Cubism model and related files
    sprites/               # Optional sprite fallback
    voice/
      task-completed.ogg
      task-failed.ogg
      approval-required.ogg
```

This is an **illustrative layout**, not a finalized asset schema. Voice lines are generated or recorded **ahead of time** and bundled with a character pack. **There is no runtime text-to-speech generation requirement**, no mandatory TTS API, and no need to send session text to a speech provider.

Tools for producing illustrations, layered images, animations, or audio may be used **offline during asset creation**; they are not part of the DSH Pets runtime.

## Roadmap

### v0.1 — Usable desktop companion

- [ ] DSH plugin connection and reliable per-session state tracking
- [ ] Active-session bubbles/list and one-click session navigation
- [ ] Completion, failure, and approval alerts with deduplication
- [ ] Missed/unread notifications and safe reconnection behavior
- [ ] Cross-platform desktop window and tray foundation
- [ ] Live2D rendering with sprite fallback
- [ ] Pre-recorded voice playback, mute, and event cooldown
- [ ] Dragging, remembered position, and basic do-not-disturb controls
- [ ] Ubuntu 24.04 end-to-end verification

### Later improvements

- [ ] Model-to-character mapping and character-pack management UI
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
- Keep controls usable when Live2D, audio, or GPU acceleration is unavailable.
- Keep communication local by default and restrict exposed control endpoints; remote-access configurations must be secured separately.
- Do not read task contents aloud by default. Recorded voice lines communicate predefined **status messages**, not arbitrary code, secrets, or chat content.
- Provide mute, do-not-disturb, and lower-resource options for long-running desktop use.

These are **engineering goals**, not a security audit or a claim of completed functionality.

## Development and contributions

The project is in an early stage. Issues, platform-specific bug reports, and reproducible test cases are welcome. Before proposing new features, please prioritize the two core workflows: **session switching** and **reliable completion notifications**.

## Attribution and licensing

DSH Pets is intended to evolve from [zuodazuoqiang001/dsh-pet](https://github.com/zuodazuoqiang001/dsh-pet), which is published under the **MIT License**. Any reused upstream code must retain the original copyright and license notices. This project's repository should include the applicable `LICENSE` file.

**Character artwork, Live2D models, voice recordings, and third-party SDKs have their own licenses.** No third-party character or voice asset should be bundled without permission, and Live2D Cubism distribution terms must be checked before shipping expandable model-loading features.

---

**DSH Pets** — A small, always-available desktop entry point for your AI agent sessions.
