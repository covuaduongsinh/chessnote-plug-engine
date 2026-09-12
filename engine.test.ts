import { Chess } from "chess.js";
import { describe, expect, test, vi } from "vitest";
import {
  centipawnsToWinChance,
  formatScore,
  parseUciInfoLine,
} from "./uci_protocol.ts";

// reviewGame() calls the real Arasan WASM engine via evalPosition(), which
// needs a running plug worker (space.readFile) that doesn't exist in this
// unit-test environment. Mock it with a deterministic material-count
// "engine" — good enough to exercise reviewGame()'s own CPL/classification
// math, which is what this test actually verifies (arasan_engine.ts's real
// UCI behavior is covered separately, see docs/plans/2026-09-07-*, Giai
// đoạn 2's nhật ký, for the Node/browser verification of the real engine).
vi.mock("./arasan_engine.ts", () => ({
  evalPosition: vi.fn(async (fen: string) => {
    const chess = new Chess(fen);
    const values: Record<string, number> = {
      p: 1,
      n: 3,
      b: 3,
      r: 5,
      q: 9,
      k: 0,
    };
    let material = 0;
    for (const row of chess.board()) {
      for (const sq of row) {
        if (sq) material += (sq.color === "w" ? 1 : -1) * values[sq.type];
      }
    }
    const stmCp = (chess.turn() === "w" ? material : -material) * 100;
    return {
      bestMove: null,
      scoreCp: stmCp,
      mateIn: null,
      depth: 1,
      pv: [],
      raw: [],
    };
  }),
}));

const { reviewGame, buildMoveList } = await import("./game_reviewer.ts");

describe("Chess Engine & Game Review Unit Tests", () => {
  test("parseUciInfoLine correctly parses depth, score cp, nodes, pv", () => {
    const line =
      "info depth 16 seldepth 22 score cp 145 nodes 152340 nps 1200000 time 127 pv e2e4 c7c5 g1f3";
    const info = parseUciInfoLine(line);

    expect(info).not.toBeNull();
    expect(info?.depth).toBe(16);
    expect(info?.seldepth).toBe(22);
    expect(info?.scoreCp).toBe(145);
    expect(info?.nodes).toBe(152340);
    expect(info?.pv).toEqual(["e2e4", "c7c5", "g1f3"]);
  });

  test("parseUciInfoLine correctly parses mate in X", () => {
    const line = "info depth 20 score mate 3 pv f7f8q g8f8 d1d8";
    const info = parseUciInfoLine(line);

    expect(info?.scoreMate).toBe(3);
    expect(info?.scoreCp).toBeUndefined();
    expect(formatScore(undefined, 3)).toBe("+M3");
    expect(formatScore(undefined, -2)).toBe("-M2");
  });

  test("centipawnsToWinChance calculates proper winning probability", () => {
    expect(Math.round(centipawnsToWinChance(0))).toBe(50);
    expect(centipawnsToWinChance(200)).toBeGreaterThan(65);
    expect(centipawnsToWinChance(-200)).toBeLessThan(35);
  });

  const scholarsMatePgn = `[Event "Short Game"]
[White "Player 1"]
[Black "Player 2"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

  test("buildMoveList produces the move list synchronously, with no engine involved", () => {
    const moves = buildMoveList(scholarsMatePgn);
    expect(moves.length).toBe(7);
    expect(moves[6].san).toBe("Qxf7#");
    expect(moves[6].isWhite).toBe(true);
    expect(moves[0].fenBefore).toContain(" w ");
    expect(moves[6].fenAfter).toContain(" b "); // Black to move, but checkmated
  });

  test("reviewGame classifies the mating capture as best/brilliant and reaches full accuracy", async () => {
    const report = await reviewGame(scholarsMatePgn, 10);

    expect(report.moves.length).toBe(7);
    expect(report.moves[6].san).toBe("Qxf7#");
    // The first 6 plies fall under the "book" cutoff regardless of engine
    // output; only the mating move (ply index 6) exercises real
    // classification logic against the mocked engine above.
    expect(
      report.moves[6].classification === "brilliant" ||
        report.moves[6].classification === "best",
    ).toBe(true);
    expect(report.moves[6].scoreAfter).toBeGreaterThan(500); // decisively winning for White after mate
    expect(report.advantageGraph.length).toBe(7);
    expect(
      report.whiteStats.best +
        report.whiteStats.good +
        report.whiteStats.brilliant +
        report.whiteStats.book,
    ).toBeGreaterThan(0);
    expect(report.whiteAccuracy).toBeGreaterThan(70);
    expect(report.blackAccuracy).toBeLessThanOrEqual(100);
  });

  test("reviewGame never calls the engine on a position with no legal moves (checkmate)", async () => {
    const { evalPosition } = await import("./arasan_engine.ts");
    vi.mocked(evalPosition).mockClear();
    await reviewGame(scholarsMatePgn, 10);
    // 7 plies -> 8 positions total, but the final (checkmated) position must
    // be short-circuited locally rather than handed to the engine.
    expect(vi.mocked(evalPosition)).toHaveBeenCalledTimes(7);
  });
});
