// Real UCI engine analysis via Arasan (MIT-licensed chess engine, NNUE
// evaluation) compiled to WebAssembly with Emscripten. Used by both
// chess.ts's "Engine Eval" buttons (single-position, live) and
// game_reviewer.ts's reviewGame() (one call per position in a full game).
//
// The engine binary (~925KB .wasm) and its NNUE network (~25MB .nnue) are
// NOT bundled into this plug's own JS — they live as data files under
// libraries/Library/Chess/{arasan.wasm, arasanv8-20260906.nnue}.
// build/build_plugs.ts copies the whole libraries/Library tree into
// client_bundle/base_fs, and bin/silverbullet/src/embed.rs (`#[derive
// (RustEmbed)]` on client_bundle/base_fs) compiles THAT into the server
// binary itself as a read-only underlay mounted beneath every Space's own
// files (verified live: a brand-new, empty Space still lists and can read
// Library/Chess/arasan.wasm). So in a normal ChessNote build these ~26MB
// ship inside every binary unconditionally — there is currently no
// "optional install" step a user can skip, unlike a real SilverBullet
// Library one installs via the Library Manager. EngineNotInstalledError
// below is a defensive fallback (a custom/trimmed build that strips
// libraries/Library/Chess before compiling, or a Space file of the same
// name shadowing the underlay with something invalid), not the expected
// path for a normal build. See
// docs/plans/2026-09-07-danh-gia-va-ke-hoach-hoan-thien-chessnote.md,
// Giai đoạn 2, for the full build pipeline (Emscripten + WASM SIMD128,
// which Arasan's NNUE code requires — there is no SIMD-free fallback for
// its sparse input layer) and this binary-size tradeoff.
//
// Architecture: this file runs inside the plug's own Web Worker sandbox
// (SilverBullet already isolates each plug in a Worker — see
// docs/Plugs/Development.md), so the engine runs off the main UI thread
// without needing a second nested Worker. Each call to evalPosition()
// spins up a *fresh* Emscripten module instance fed a fixed batch of UCI
// commands via a synchronous Module.stdin() queue, and reads results back
// via Module.print(); a UCI engine's main loop naturally exits on "quit",
// so there is no persistent process to manage. The engine's own binary and
// network bytes are cached across calls (space.readFile is only paid once).

import { space } from "@silverbulletmd/silverbullet/syscalls";
import { Chess } from "chess.js";
// @ts-expect-error -- Emscripten-generated JS glue (build/build_client.ts
// doesn't compile it, no .d.ts shipped); typed as `any` at the call sites below.
import ArasanModule from "./wasm/arasan.mjs";

const WASM_PATH = "Library/Chess/arasan.wasm";
const NNUE_PATH = "Library/Chess/arasanv8-20260906.nnue";
const NNUE_FILENAME = "arasanv8-20260906.nnue";

// Exported as a plain string (not just embedded in the class below) because
// a syscall error crossing the plug Worker boundary only carries `.message`
// across (see client/plugos/worker_runtime.ts's "invr" handler) — the
// receiving side reconstructs a generic `Error`, losing the `EngineNotInstalledError`
// class identity and even `.name`. Callers in other plugs (see
// plug_api.ts's `isEngineNotInstalledError`) must match on this message
// string instead of `instanceof`.
export const ENGINE_NOT_INSTALLED_MESSAGE =
  "Không tìm thấy file engine Arasan (arasan.wasm / arasanv8-20260906.nnue). " +
  "Bản build ChessNote chuẩn luôn kèm sẵn 2 file này — nếu thiếu, có thể đây là " +
  "bản build tùy chỉnh đã lược bỏ libraries/Library/Chess, hoặc Space này có file " +
  "trùng tên đang che khuất chúng.";

export class EngineNotInstalledError extends Error {
  constructor() {
    super(ENGINE_NOT_INSTALLED_MESSAGE);
    this.name = "EngineNotInstalledError";
  }
}

export interface EngineResult {
  bestMove: string | null;
  scoreCp: number | null; // centipawns, from the side-to-move's perspective
  mateIn: number | null; // moves to mate, if forced (overrides scoreCp when set)
  depth: number | null;
  pv: string[]; // principal variation, UCI long algebraic (e.g. "e2e4")
  raw: string[]; // full engine stdout, for debugging
}

let cachedBytes: { wasm: Uint8Array; nnue: Uint8Array } | null = null;

async function getEngineBytes(): Promise<{
  wasm: Uint8Array;
  nnue: Uint8Array;
}> {
  if (cachedBytes) return cachedBytes;
  const [hasWasm, hasNnue] = await Promise.all([
    space.fileExists(WASM_PATH),
    space.fileExists(NNUE_PATH),
  ]);
  if (!hasWasm || !hasNnue) {
    throw new EngineNotInstalledError();
  }
  const [wasm, nnue] = await Promise.all([
    space.readFile(WASM_PATH),
    space.readFile(NNUE_PATH),
  ]);
  cachedBytes = { wasm, nnue };
  return cachedBytes;
}

function parseUciOutput(lines: string[]): EngineResult {
  let bestMove: string | null = null;
  let scoreCp: number | null = null;
  let mateIn: number | null = null;
  let depth: number | null = null;
  let pv: string[] = [];

  for (const line of lines) {
    if (line.startsWith("bestmove")) {
      const parts = line.split(/\s+/);
      bestMove = parts[1] ?? null;
    } else if (line.startsWith("info") && line.includes(" pv ")) {
      // e.g. "info multipv 1 depth 8 score cp 81 time 4 nodes 21 hashfull 0 pv d2d4 d7d5"
      const depthMatch = line.match(/\bdepth (\d+)/);
      if (depthMatch) depth = parseInt(depthMatch[1], 10);
      const cpMatch = line.match(/\bscore cp (-?\d+)/);
      const mateMatch = line.match(/\bscore mate (-?\d+)/);
      if (mateMatch) {
        mateIn = parseInt(mateMatch[1], 10);
        scoreCp = null;
      } else if (cpMatch) {
        scoreCp = parseInt(cpMatch[1], 10);
        mateIn = null;
      }
      const pvMatch = line.match(/\bpv (.+)$/);
      if (pvMatch) pv = pvMatch[1].trim().split(/\s+/);
    }
  }
  return { bestMove, scoreCp, mateIn, depth, pv, raw: lines };
}

/**
 * Runs a real Arasan (NNUE) analysis of `fen` to `depth` plies. Throws
 * EngineNotInstalledError if the "Chess Engine" Library hasn't been
 * installed in this Space.
 */
export async function evalPosition(
  fen: string,
  depth = 12,
): Promise<EngineResult> {
  // A position with no legal moves (checkmate/stalemate) has nothing to
  // search — asking Arasan anyway produces UCI output parseUciOutput() can't
  // turn into a meaningful score, which used to surface as a misleading
  // "eval: 0.0" on an actually-decisive position. Short-circuit locally.
  if (new Chess(fen).isGameOver()) {
    const mated = new Chess(fen).isCheckmate();
    return {
      bestMove: null,
      scoreCp: mated ? null : 0,
      mateIn: mated ? -1 : null, // the side to move has already been mated
      depth: null,
      pv: [],
      raw: [],
    };
  }

  const { wasm, nnue } = await getEngineBytes();

  const outputLines: string[] = [];
  // Deliberately NOT followed by "quit\n": Arasan checks stdin for an
  // interrupt (stop/quit) between iterative-deepening iterations, and since
  // our stdin() callback below exposes the whole queue synchronously, a
  // queued "quit" is visible immediately and aborts the search after depth
  // 1 every time (verified: removing it lets a depth-12 search actually
  // reach depth 12). Leaving the queue empty after "go depth N\n" makes
  // stdin() return EOF once the engine goes looking for its next command
  // (right after printing "bestmove"), which Arasan treats the same as an
  // explicit "quit" and exits cleanly — see the Node repro in Giai đoạn 2's
  // nhật ký for the side-by-side comparison.
  const stdinQueue = `uci\nisready\nposition fen ${fen}\ngo depth ${depth}\n`;
  let stdinPos = 0;

  // deno-lint-ignore no-explicit-any
  const instance: any = await ArasanModule({
    // deno-lint-ignore no-explicit-any
    instantiateWasm(imports: WebAssembly.Imports, successCallback: any) {
      (
        WebAssembly.instantiate(
          wasm,
          imports,
        ) as unknown as Promise<WebAssembly.WebAssemblyInstantiatedSource>
      ).then((output) => successCallback(output.instance, output.module));
      return {};
    },
    print: (text: string) => outputLines.push(text),
    printErr: () => {},
    stdin: () =>
      stdinPos < stdinQueue.length ? stdinQueue.charCodeAt(stdinPos++) : null,
    noInitialRun: true,
  });

  instance.FS.writeFile("/" + NNUE_FILENAME, nnue);
  instance.callMain([]);

  return parseUciOutput(outputLines);
}
