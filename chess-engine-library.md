---
name: Library/Chess/Chess Engine
tags: meta/library
files:
  - chess-engine.plug.js
  - arasan.wasm
  - arasanv8-20260906.nnue
---
# Chess Engine

The [Arasan](https://www.arasanchess.org/) chess engine (WebAssembly UCI
build) running entirely inside its own plug Worker sandbox — no core/client
changes needed. Exposes:

- `chess.engineEval(fen, depth?)` — position evaluation.
- `chess.reviewGame(pgn, depth?)` — full-game review (accuracy, move
  classification, advantage graph).
- `chess.engine.buildMoveList(pgn)` — cheap chess.js-only move list (no
  engine call), used for PGN navigation.

**This library page installs the two engine binary files alongside the
plug** (`arasan.wasm`, ~900KB, and `arasanv8-20260906.nnue`, ~25MB — the
neural network eval file), placed at `Library/Chess/arasan.wasm` /
`Library/Chess/arasanv8-20260906.nnue` in your Space, because the plug reads
them via `space.readFile` at those exact hardcoded paths (too large to embed
directly into the plug bundle, unlike this plug's smaller dependencies).
`chess.engineEval`/`chess.reviewGame` throw a clear `EngineNotInstalledError`
if those files are missing — `chess.engine.buildMoveList` (PGN navigation)
does not need them at all.

Originally built as part of
[ChessNote](https://github.com/covuaduongsinh/chessnote), a chess-focused
SilverBullet fork.

Source: [chessnote-plug-engine](https://github.com/covuaduongsinh/chessnote-plug-engine).
