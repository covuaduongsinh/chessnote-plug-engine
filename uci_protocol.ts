/**
 * UCI Protocol Message Types & Parser (MIT License)
 */

export interface UciInfo {
  depth?: number;
  seldepth?: number;
  scoreCp?: number;
  scoreMate?: number;
  nodes?: number;
  nps?: number;
  time?: number;
  pv?: string[];
  multipv?: number;
}

export interface EngineEvaluation {
  scoreCp: number; // in centipawns (positive is white advantage)
  isMate: boolean;
  mateIn?: number;
  depth: number;
  bestMove?: string;
  pv: string[];
  winChance: number; // 0 to 100%
}

/**
 * Parses a standard UCI 'info ...' string line into structured UciInfo
 */
export function parseUciInfoLine(line: string): UciInfo | null {
  if (!line.startsWith("info ")) return null;

  const tokens = line.split(" ");
  const info: UciInfo = { pv: [] };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "depth" && i + 1 < tokens.length) {
      info.depth = parseInt(tokens[++i], 10);
    } else if (token === "seldepth" && i + 1 < tokens.length) {
      info.seldepth = parseInt(tokens[++i], 10);
    } else if (token === "score" && i + 2 < tokens.length) {
      const type = tokens[++i];
      const val = parseInt(tokens[++i], 10);
      if (type === "cp") {
        info.scoreCp = val;
      } else if (type === "mate") {
        info.scoreMate = val;
      }
    } else if (token === "nodes" && i + 1 < tokens.length) {
      info.nodes = parseInt(tokens[++i], 10);
    } else if (token === "nps" && i + 1 < tokens.length) {
      info.nps = parseInt(tokens[++i], 10);
    } else if (token === "time" && i + 1 < tokens.length) {
      info.time = parseInt(tokens[++i], 10);
    } else if (token === "multipv" && i + 1 < tokens.length) {
      info.multipv = parseInt(tokens[++i], 10);
    } else if (token === "pv") {
      info.pv = tokens.slice(i + 1);
      break;
    }
  }

  return info;
}

/**
 * Calculates winning probability (0 to 100%) from centipawn score
 * Uses the standard Lichess / FIDE winning probability model:
 * Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 */
export function centipawnsToWinChance(cp: number): number {
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/**
 * Formats centipawn or mate score into user-friendly string (e.g. "+1.4", "-0.8", "M3")
 */
export function formatScore(scoreCp?: number, scoreMate?: number): string {
  if (scoreMate !== undefined) {
    return scoreMate > 0 ? `+M${scoreMate}` : `-M${Math.abs(scoreMate)}`;
  }
  if (scoreCp !== undefined) {
    const pawns = (scoreCp / 100).toFixed(1);
    return scoreCp > 0 ? `+${pawns}` : pawns;
  }
  return "0.0";
}
