import { Chess } from "chess.js";
import { type EngineResult, evalPosition } from "./arasan_engine.ts";
import { centipawnsToWinChance } from "./uci_protocol.ts";

export type MoveClassification =
  | "brilliant" // !!
  | "great" // !
  | "best" // Best engine move
  | "good" // Minor difference
  | "inaccuracy" // ?! (CPL 30 - 75)
  | "mistake" // ? (CPL 75 - 150)
  | "blunder" // ?? (CPL > 150)
  | "book"; // Opening book move

/** The cheap, chess.js-only move data needed to render/navigate a PGN — no engine involved, safe to compute at widget render time. */
export interface MoveListEntry {
  moveNum: number;
  isWhite: boolean;
  san: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
}

export interface ReviewedMove extends MoveListEntry {
  scoreBefore: number; // in centipawns from White's perspective
  scoreAfter: number;
  cpl: number; // Centipawn loss (>= 0)
  classification: MoveClassification;
  bestMoveSan?: string;
}

export interface GameReviewReport {
  whiteAccuracy: number; // 0 - 100%
  blackAccuracy: number; // 0 - 100%
  whiteStats: Record<MoveClassification, number>;
  blackStats: Record<MoveClassification, number>;
  moves: ReviewedMove[];
  advantageGraph: { moveIdx: number; score: number }[]; // Scores from White perspective
}

/**
 * Builds the move list (SAN, from/to, FEN before/after) for a PGN using only
 * chess.js — no engine calls, so this is cheap enough to run synchronously at
 * widget render time for board navigation, independent of whether a full
 * (engine-backed) game review has been requested.
 */
export function buildMoveList(pgn: string): MoveListEntry[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const sim = new Chess();

  const moves: MoveListEntry[] = [];
  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const fenBefore = sim.fen();
    sim.move(move.san);
    moves.push({
      moveNum: Math.floor(i / 2) + 1,
      isWhite: i % 2 === 0,
      san: move.san,
      from: move.from,
      to: move.to,
      fenBefore,
      fenAfter: sim.fen(),
    });
  }
  return moves;
}

function sideToMoveIsWhite(fen: string): boolean {
  return fen.split(" ")[1] === "w";
}

// Converts an engine result (scored from the perspective of the side to move
// in `fen`) to a White-perspective centipawn score. Mate scores saturate to
// ±10000 — exact mate distance doesn't matter for CPL/accuracy math, only
// the sign of who is winning.
function toWhiteCp(fen: string, result: EngineResult): number {
  const whiteToMove = sideToMoveIsWhite(fen);
  const stmCp =
    result.mateIn !== null && result.mateIn !== undefined
      ? result.mateIn > 0
        ? 10000
        : -10000
      : (result.scoreCp ?? 0);
  return whiteToMove ? stmCp : -stmCp;
}

// Converts the engine's UCI long-algebraic best move (e.g. "e2e4", "e7e8q")
// at `fen` into SAN, for display in the move tree / "best move" column.
function uciToSan(fen: string, uciMove: string | null): string | undefined {
  if (!uciMove || uciMove.length < 4) return undefined;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uciMove.slice(0, 2),
      to: uciMove.slice(2, 4),
      promotion: uciMove.length > 4 ? uciMove.slice(4) : undefined,
    });
    return move?.san;
  } catch {
    return undefined;
  }
}

/**
 * Runs a full real-engine (Arasan, NNUE) review of a PGN game: one
 * evalPosition() call per position along the game (N+1 for N plies — the
 * "after" evaluation of move i doubles as the "before" evaluation of move
 * i+1), classifying each move by centipawn loss against the engine's own
 * best continuation from the position before it.
 *
 * This is a genuinely slow, real search per position (measured ~0.5s each
 * at depth 12 on a mid-complexity middlegame position) — for a full game
 * that adds up to tens of seconds. Callers MUST treat this as an explicit,
 * on-demand batch job (e.g. behind a "Game Review" button with a loading
 * state) and never call it at widget render time. Propagates whatever
 * evalPosition() throws (including EngineNotInstalledError) instead of
 * silently falling back to a fake/heuristic result.
 */
export async function reviewGame(
  pgn: string,
  depth = 12,
): Promise<GameReviewReport> {
  const moveList = buildMoveList(pgn);

  const emptyStats = (): Record<MoveClassification, number> => ({
    brilliant: 0,
    great: 0,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    book: 0,
  });

  const whiteStats = emptyStats();
  const blackStats = emptyStats();

  if (moveList.length === 0) {
    return {
      whiteAccuracy: 100,
      blackAccuracy: 100,
      whiteStats,
      blackStats,
      moves: [],
      advantageGraph: [],
    };
  }

  // One evalPosition() per distinct position: start position + after every
  // move. Sequential (not Promise.all) on purpose — each call spins up its
  // own WASM instance plus a 25MB NNUE write, so running many concurrently
  // would multiply peak memory/CPU for no real speed gain (single-threaded
  // WASM already saturates one core).
  //
  // A position with no legal moves (checkmate/stalemate) is handled locally
  // instead of asking the engine: there's nothing to search, and Arasan's
  // UCI output for a position with no legal moves is not something
  // parseUciOutput() can turn into a meaningful score.
  const fens = [moveList[0].fenBefore, ...moveList.map((m) => m.fenAfter)];
  const evals: EngineResult[] = [];
  for (const fen of fens) {
    const probe = new Chess(fen);
    if (probe.isGameOver()) {
      evals.push({
        bestMove: null,
        scoreCp: probe.isCheckmate() ? null : 0,
        mateIn: probe.isCheckmate() ? -1 : null, // the side to move has already been mated
        depth: null,
        pv: [],
        raw: [],
      });
    } else {
      evals.push(await evalPosition(fen, depth));
    }
  }

  const reviewedMoves: ReviewedMove[] = [];
  const advantageGraph: { moveIdx: number; score: number }[] = [];
  let totalWhiteWinLoss = 0;
  let totalBlackWinLoss = 0;
  let whiteMoveCount = 0;
  let blackMoveCount = 0;

  for (let i = 0; i < moveList.length; i++) {
    const m = moveList[i];
    const isWhite = m.isWhite;
    const scoreBeforeWhite = toWhiteCp(fens[i], evals[i]);
    const scoreAfterWhite = toWhiteCp(fens[i + 1], evals[i + 1]);
    const bestMoveSan = uciToSan(fens[i], evals[i].bestMove) ?? m.san;

    advantageGraph.push({ moveIdx: i, score: scoreAfterWhite });

    // The engine's score at the position *before* the move already reflects
    // the value of its own best continuation, so it doubles as the
    // "best-case outcome" baseline the played move is measured against.
    const cpl = isWhite
      ? Math.max(0, scoreBeforeWhite - scoreAfterWhite)
      : Math.max(0, scoreAfterWhite - scoreBeforeWhite);

    const winBefore = centipawnsToWinChance(
      isWhite ? scoreBeforeWhite : -scoreBeforeWhite,
    );
    const winAfter = centipawnsToWinChance(
      isWhite ? scoreAfterWhite : -scoreAfterWhite,
    );
    const winLoss = Math.max(0, winBefore - winAfter);

    if (isWhite) {
      totalWhiteWinLoss += winLoss;
      whiteMoveCount++;
    } else {
      totalBlackWinLoss += winLoss;
      blackMoveCount++;
    }

    let classification: MoveClassification = "good";
    if (i < 6) {
      classification = "book";
    } else if (cpl === 0 || m.san === bestMoveSan) {
      if (m.san.includes("x") && Math.abs(scoreAfterWhite) > 300) {
        classification = "brilliant";
      } else {
        classification = "best";
      }
    } else if (cpl <= 30) {
      classification = "good";
    } else if (cpl <= 85) {
      classification = "inaccuracy";
    } else if (cpl <= 180) {
      classification = "mistake";
    } else {
      classification = "blunder";
    }

    if (isWhite) {
      whiteStats[classification]++;
    } else {
      blackStats[classification]++;
    }

    reviewedMoves.push({
      ...m,
      scoreBefore: isWhite ? scoreBeforeWhite : -scoreBeforeWhite,
      scoreAfter: isWhite ? scoreAfterWhite : -scoreAfterWhite,
      cpl,
      classification,
      bestMoveSan,
    });
  }

  const whiteAccuracy =
    whiteMoveCount > 0
      ? Math.max(
          40,
          Math.min(99.5, 100 - (totalWhiteWinLoss / whiteMoveCount) * 2.2),
        )
      : 100;
  const blackAccuracy =
    blackMoveCount > 0
      ? Math.max(
          40,
          Math.min(99.5, 100 - (totalBlackWinLoss / blackMoveCount) * 2.2),
        )
      : 100;

  return {
    whiteAccuracy: parseFloat(whiteAccuracy.toFixed(1)),
    blackAccuracy: parseFloat(blackAccuracy.toFixed(1)),
    whiteStats,
    blackStats,
    moves: reviewedMoves,
    advantageGraph,
  };
}
