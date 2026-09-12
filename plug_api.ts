// Thin cross-plug API for chess-engine, mirroring plugs/index/plug_api.ts and
// plugs/chess-themes/plug_api.ts: every export just forwards to the syscall
// this plug's manifest registers, so callers in other plugs (chess-core,
// chess-ai, chess-pdf-export, chess-repertoire, ...) never import
// chess-engine's actual WASM/engine logic directly.
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { ENGINE_NOT_INSTALLED_MESSAGE } from "./arasan_engine.ts";
import type { EngineResult } from "./arasan_engine.ts";
import type { GameReviewReport, MoveListEntry } from "./game_reviewer.ts";

export function evalPosition(
  fen: string,
  depth?: number,
): Promise<EngineResult> {
  return syscall("chess.engineEval", fen, depth);
}

export function reviewGame(
  pgn: string,
  depth?: number,
): Promise<GameReviewReport> {
  return syscall("chess.reviewGame", pgn, depth);
}

export function buildMoveList(pgn: string): Promise<MoveListEntry[]> {
  return syscall("chess.engine.buildMoveList", pgn);
}

/**
 * A syscall error crossing the plug Worker boundary only carries `.message`
 * (see client/plugos/worker_runtime.ts) — the receiving side reconstructs a
 * generic `Error`, losing the `EngineNotInstalledError` class identity and
 * even `.name`. Callers that used to do `e instanceof EngineNotInstalledError`
 * on a same-realm direct import must use this instead once the call goes
 * through `evalPosition`/`reviewGame` above.
 */
export function isEngineNotInstalledError(e: unknown): boolean {
  return e instanceof Error && e.message === ENGINE_NOT_INSTALLED_MESSAGE;
}
