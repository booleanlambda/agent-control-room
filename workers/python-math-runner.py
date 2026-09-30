#!/usr/bin/env python3
import ast
import json
import math
import sys

MAX_CHECKS = 64
MAX_EXPR_CHARS = 600
MAX_POWER_ABS = 100
SAFE_FUNCS = {
    "abs": abs,
    "round": round,
    "sqrt": math.sqrt,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
}
SAFE_CONSTS = {"pi": math.pi, "e": math.e}

class SafeMathError(Exception):
    pass

def eval_node(node):
    if isinstance(node, ast.Expression):
        return eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.Name) and node.id in SAFE_CONSTS:
        return float(SAFE_CONSTS[node.id])
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = eval_node(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp):
        left = eval_node(node.left)
        right = eval_node(node.right)
        if isinstance(node.op, ast.Add):
            value = left + right
        elif isinstance(node.op, ast.Sub):
            value = left - right
        elif isinstance(node.op, ast.Mult):
            value = left * right
        elif isinstance(node.op, ast.Div):
            value = left / right
        elif isinstance(node.op, ast.Mod):
            value = left % right
        elif isinstance(node.op, ast.Pow):
            if abs(right) > MAX_POWER_ABS:
                raise SafeMathError("exponent_out_of_bounds")
            value = left ** right
        else:
            raise SafeMathError("operator_not_allowed")
        if not math.isfinite(value):
            raise SafeMathError("non_finite_result")
        return float(value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SAFE_FUNCS:
        if node.keywords:
            raise SafeMathError("keyword_arguments_not_allowed")
        args = [eval_node(arg) for arg in node.args]
        value = SAFE_FUNCS[node.func.id](*args)
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise SafeMathError("non_finite_result")
        return float(value)
    raise SafeMathError("syntax_not_allowed")

def safe_eval(expression):
    expr = str(expression or "").strip()
    if not expr or len(expr) > MAX_EXPR_CHARS:
        raise SafeMathError("expression_invalid_length")
    tree = ast.parse(expr, mode="eval")
    return eval_node(tree)

def main():
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    checks = payload.get("checks")
    if not isinstance(checks, list) or not checks or len(checks) > MAX_CHECKS:
        raise SafeMathError("checks_invalid")

    abs_tol = float(payload.get("absolute_tolerance", 1e-9))
    rel_tol = float(payload.get("relative_tolerance", 1e-9))
    results = []
    all_match = True

    for index, item in enumerate(checks):
        if not isinstance(item, dict):
            raise SafeMathError("check_invalid")
        expression = item.get("expression")
        claimed = float(item.get("claimed_result"))
        if not math.isfinite(claimed):
            raise SafeMathError("claimed_result_non_finite")
        actual = safe_eval(expression)
        matched = math.isclose(actual, claimed, rel_tol=rel_tol, abs_tol=abs_tol)
        all_match = all_match and matched
        results.append({
            "index": index,
            "label": str(item.get("label") or f"check_{index+1}")[:120],
            "matched": matched,
            "actual": actual,
            "claimed_result": claimed,
        })

    sys.stdout.write(json.dumps({
        "ok": True,
        "all_match": all_match,
        "check_count": len(results),
        "results": results,
    }, separators=(",", ":")))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": f"{type(exc).__name__}:{str(exc)}"[:300],
        }, separators=(",", ":")))
        sys.exit(2)
