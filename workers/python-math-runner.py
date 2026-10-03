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

def strict_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SafeMathError(f"{name}_must_be_json_number")
    out = float(value)
    if not math.isfinite(out):
        raise SafeMathError(f"{name}_non_finite")
    return out

def strict_nonnegative_number(value, name):
    out = strict_number(value, name)
    if out < 0:
        raise SafeMathError(f"{name}_negative")
    return out

def eval_node(node):
    if isinstance(node, ast.Expression):
        return eval_node(node.body)
    if isinstance(node, ast.Constant) and not isinstance(node.value, bool) and isinstance(node.value, (int, float)):
        # Preserve integer literals as integers. Most arithmetic operators will
        # naturally promote them as needed, while functions such as round(x, ndigits)
        # require ndigits to remain an int rather than being coerced to float.
        if isinstance(node.value, int):
            return node.value
        return strict_number(node.value, "constant")
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
        if node.func.id == "round":
            if len(args) not in (1, 2):
                raise SafeMathError("function_argument_invalid:round")
            if len(args) == 2:
                ndigits = args[1]
                if isinstance(ndigits, bool) or not isinstance(ndigits, int):
                    raise SafeMathError("round_ndigits_must_be_integer")
        try:
            value = SAFE_FUNCS[node.func.id](*args)
        except Exception as exc:
            raise SafeMathError(f"function_argument_invalid:{node.func.id}") from exc
        return strict_number(value, "function_result")
    raise SafeMathError("syntax_not_allowed")

def safe_eval(expression):
    if not isinstance(expression, str):
        raise SafeMathError("expression_must_be_string")
    expr = expression.strip()
    if not expr or len(expr) > MAX_EXPR_CHARS:
        raise SafeMathError("expression_invalid_length")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise SafeMathError("expression_syntax_invalid") from exc
    return eval_node(tree)

def check_label(item, index):
    label = item.get("label")
    if not isinstance(label, str) or not label.strip():
        raise SafeMathError("label_must_be_nonempty_string")
    if len(label) > 120:
        raise SafeMathError("label_too_long")
    return label

def error_code(exc):
    if isinstance(exc, SafeMathError):
        return str(exc)[:180]
    if isinstance(exc, ZeroDivisionError):
        return "division_by_zero"
    if isinstance(exc, OverflowError):
        return "numeric_overflow"
    if isinstance(exc, ValueError):
        return "numeric_domain_error"
    return f"{type(exc).__name__}:{str(exc)}"[:180]

def main():
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    checks = payload.get("checks")
    if not isinstance(checks, list) or not checks or len(checks) > MAX_CHECKS:
        raise SafeMathError("checks_invalid")

    abs_tol = strict_nonnegative_number(payload.get("absolute_tolerance", 1e-9), "absolute_tolerance")
    rel_tol = strict_nonnegative_number(payload.get("relative_tolerance", 1e-9), "relative_tolerance")
    results = []
    all_match = True
    all_valid = True
    validation_error_count = 0

    for index, item in enumerate(checks):
        label = f"check_{index+1}"
        claimed = None
        try:
            if not isinstance(item, dict):
                raise SafeMathError("check_must_be_object")
            label = check_label(item, index)
            expression = item.get("expression")
            claimed = strict_number(item.get("claimed_result"), "claimed_result")
            actual = safe_eval(expression)
            check_abs_tol = strict_nonnegative_number(
                item.get("runtime_absolute_tolerance", abs_tol),
                "runtime_absolute_tolerance",
            )
            check_abs_tol = min(abs_tol, check_abs_tol)
            matched = math.isclose(actual, claimed, rel_tol=rel_tol, abs_tol=check_abs_tol)
            all_match = all_match and matched
            results.append({
                "index": index,
                "label": label,
                "valid": True,
                "matched": matched,
                "actual": actual,
                "claimed_result": claimed,
                "absolute_tolerance": check_abs_tol,
                "relative_tolerance": rel_tol,
                "error_code": None,
            })
        except Exception as exc:
            all_valid = False
            all_match = False
            validation_error_count += 1
            results.append({
                "index": index,
                "label": label,
                "valid": False,
                "matched": False,
                "actual": None,
                "claimed_result": claimed,
                "error_code": error_code(exc),
            })

    sys.stdout.write(json.dumps({
        "ok": True,
        "all_valid": all_valid,
        "all_match": all_match,
        "validation_error_count": validation_error_count,
        "check_count": len(results),
        "results": results,
    }, separators=(",", ":"), allow_nan=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "failure_class": "runtime_contract" if isinstance(exc, SafeMathError) else "runtime",
            "error": f"{type(exc).__name__}:{str(exc)}"[:300],
        }, separators=(",", ":")))
        sys.exit(2)
