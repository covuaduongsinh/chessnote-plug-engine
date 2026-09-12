# chessnote-plug-engine

ChessNote's chess engine plug: the Arasan chess engine compiled to WebAssembly
(NNUE), UCI protocol parsing, and game-review/move-classification logic
(centipawn loss, accuracy, brilliant/mistake/blunder classification).

## ⚠️ Not independently installable

This is a **mirrored source snapshot** of `plugs/chess-engine/` from the main
[chessnote](https://github.com/covuaduongsinh/chessnote) monorepo, kept as a
separate repository for clearer version tracking of this one feature area.

It is **not** a standalone, installable SilverBullet plug:

- It exposes its functions (`chess.engineEval`, `chess.reviewGame`,
  `chess.engine.buildMoveList`) as syscalls consumed by ChessNote's other
  chess-* plugs (chess-core, chess-ai, chess-pdf-export) — it only makes sense
  running alongside them inside the ChessNote client build.
- The actual build (compiling this into a `.plug.js`, registering it in
  `plugs/builtin_plugs.ts`) happens in the main chessnote repo, not here.

To use or modify this code, work in the main
[chessnote](https://github.com/covuaduongsinh/chessnote) repo instead — this
repo exists for reference and history, not standalone development.
