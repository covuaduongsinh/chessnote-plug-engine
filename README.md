# chessnote-plug-engine

A standalone SilverBullet plug: the [Arasan](https://www.arasanchess.org/)
chess engine compiled to WebAssembly (NNUE), UCI protocol parsing, and
game-review/move-classification logic (centipawn loss, accuracy,
brilliant/mistake/blunder classification) — extracted from
[ChessNote](https://github.com/covuaduongsinh/chessnote) (a chess-focused
SilverBullet fork). Runs entirely inside its own plug Worker sandbox.

## Install

In SilverBullet, run the **"Library: Install"** command and paste this URL:

```
https://raw.githubusercontent.com/covuaduongsinh/chessnote-plug-engine/main/chess-engine-library.md
```

This pulls in `chess-engine.plug.js` **and the two engine binary files**
(`arasan.wasm`, ~900KB, `arasanv8-20260906.nnue`, ~25MB — so this install
step takes a bit longer than the other chessnote-plug-* repos) at
`Library/Chess/arasan.wasm` / `Library/Chess/arasanv8-20260906.nnue` in your
Space, since the plug reads them from those exact hardcoded paths. After
installing, run **"Plugs: Reload"** if it doesn't load automatically.

This plug has no dependency on any other chessnote-plug-* — it's a good
first install. It's a dependency *for* `chessnote-plug-core`,
`chessnote-plug-ai`, and `chessnote-plug-pdf-export` (see their own READMEs
for the full install order).

## What it provides

- `chess.engineEval(fen, depth?)` — position evaluation.
- `chess.reviewGame(pgn, depth?)` — full-game review (accuracy, move
  classification, advantage graph).
- `chess.engine.buildMoveList(pgn)` — cheap chess.js-only move list (no
  engine call, no binary files needed), used for PGN navigation.

`chess.engineEval`/`chess.reviewGame` throw a clear `EngineNotInstalledError`
(surfaced as `isEngineNotInstalledError(e)` for callers to check) if the two
binary files above are missing.

## Development

Source lives here **and** as `plugs/chess-engine/` in the main
[chessnote](https://github.com/covuaduongsinh/chessnote) monorepo, which is
where `chess-engine.plug.yaml` actually gets compiled during ChessNote's own
build (`npm run build:plugs`). This repo's `chess-engine.plug.js` is a
manually-published snapshot — after changing the source here (or there),
rebuild and re-copy the compiled `.plug.js` to keep this repo's install URL
up to date.

To compile it yourself from this repo directly, you'll need SilverBullet's
plug-compile tooling (see [Plug
Development](https://silverbullet.md/Plugs/Development) docs) pointed at
`chess-engine.plug.yaml`.
