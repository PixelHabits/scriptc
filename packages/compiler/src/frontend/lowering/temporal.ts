import * as ts from "../ts7/adapter.js";
import { DYN, type IrExpr, type SrcLoc } from "../../ir/ir.js";
import type { Lowerer } from "./lowerer.js";
import { isGlobalObjectRead } from "./host-globals.js";
import { stdlibGlobalNameOf, withoutTypeCasts } from "./surfaces.js";

/** The namespace identity supports probes, while every member use refuses. */
export function temporalValue(loc: SrcLoc): IrExpr {
  return { kind: "libCall", fn: "global.temporal", args: [], type: DYN, loc };
}

export function isTemporalValue(
  lowerer: Lowerer,
  node: ts.Expression,
  seen: Set<ts.Symbol> = new Set(),
): boolean {
  const expr = withoutTypeCasts(node);
  if (
    !ts.isIdentifier(expr) &&
    !ts.isPropertyAccessExpression(expr) &&
    !ts.isElementAccessExpression(expr)
  )
    return false;
  if (stdlibGlobalNameOf(lowerer, expr) === "Temporal") return true;
  if (ts.isPropertyAccessExpression(expr))
    return expr.name.text === "Temporal" && isGlobalObjectRead(lowerer, expr.expression);
  if (ts.isElementAccessExpression(expr))
    return (
      ts.isStringLiteralLike(expr.argumentExpression) &&
      expr.argumentExpression.text === "Temporal" &&
      isGlobalObjectRead(lowerer, expr.expression)
    );
  if (!ts.isIdentifier(expr)) return false;
  const symbol = lowerer.checker.getSymbolAtLocation(expr);
  if (symbol === undefined || seen.has(symbol)) return false;
  seen.add(symbol);
  const decl = symbol.valueDeclaration;
  return (
    decl !== undefined &&
    ts.isVariableDeclaration(decl) &&
    decl.initializer !== undefined &&
    (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0 &&
    isTemporalValue(lowerer, decl.initializer, seen)
  );
}

/** Calls and constructors may lower their callee without a member-read hook. */
export function fenceTemporalMemberUse(lowerer: Lowerer, expr: ts.Expression): void {
  let node = withoutTypeCasts(ts.isTypeOfExpression(expr) ? expr.expression : expr);
  while (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isNewExpression(node)
  ) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (isTemporalValue(lowerer, node.expression)) lowerer.temporalFence(expr);
      const symbol = lowerer.typeOf(node.expression).getSymbol();
      if (ts.symbolNameOf(symbol) === "Temporal" && lowerer.isStdlibSymbol(symbol))
        lowerer.temporalFence(expr);
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : null;
      if (
        name === "toTemporalInstant" &&
        lowerer.mapTypeOf(lowerer.typeOf(node.expression))?.kind === "date"
      )
        lowerer.temporalFence(expr);
      if (
        name !== null &&
        ["atimeInstant", "mtimeInstant", "ctimeInstant", "birthtimeInstant"].includes(name)
      ) {
        const kind = lowerer.mapTypeOf(lowerer.typeOf(node.expression))?.kind;
        if (kind === "stats" || kind === "bigintStats") lowerer.temporalFence(expr);
      }
    }
    node = withoutTypeCasts(node.expression);
  }
}
