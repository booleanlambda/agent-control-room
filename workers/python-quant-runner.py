#!/usr/bin/env python3
import ast
import hashlib
import json
import math
import random
import statistics
import sys
from statistics import NormalDist

MAX_ANALYSES = 32
MAX_VALUES = 20000
MAX_DRAWS = 50000
MAX_EXPR_CHARS = 600
MAX_POWER_ABS = 100
DEFAULT_ABS_TOL = 1e-8
DEFAULT_REL_TOL = 1e-8

class QuantError(Exception):
    pass

def finite_float(value, name="value"):
    try:
        out = float(value)
    except Exception as exc:
        raise QuantError(f"{name}_not_numeric") from exc
    if not math.isfinite(out):
        raise QuantError(f"{name}_non_finite")
    return out

def numeric_list(values, name="values", min_len=1):
    if not isinstance(values, list) or len(values) < min_len or len(values) > MAX_VALUES:
        raise QuantError(f"{name}_invalid_length")
    return [finite_float(v, name) for v in values]

def canonical_hash(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def quantile_type7(values, q):
    xs = sorted(values)
    if not xs:
        raise QuantError("quantile_empty")
    if not 0 <= q <= 1:
        raise QuantError("quantile_q_out_of_range")
    if len(xs) == 1:
        return xs[0]
    h = (len(xs) - 1) * q
    lo = int(math.floor(h))
    hi = int(math.ceil(h))
    if lo == hi:
        return xs[lo]
    return xs[lo] + (h - lo) * (xs[hi] - xs[lo])

def betacf(a, b, x):
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < 3e-14:
        d = 3e-14
    d = 1.0 / d
    h = d
    for m in range(1, 201):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < 3e-14:
            d = 3e-14
        c = 1.0 + aa / c
        if abs(c) < 3e-14:
            c = 3e-14
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < 3e-14:
            d = 3e-14
        c = 1.0 + aa / c
        if abs(c) < 3e-14:
            c = 3e-14
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 3e-12:
            break
    return h

def regularized_beta(x, a, b):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    log_bt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    bt = math.exp(log_bt)
    if x < (a + 1) / (a + b + 2):
        return bt * betacf(a, b, x) / a
    return 1.0 - bt * betacf(b, a, 1 - x) / b

def student_t_cdf(t, df):
    if df <= 0:
        raise QuantError("degrees_of_freedom_must_be_positive")
    if t == 0:
        return 0.5
    x = df / (df + t * t)
    ib = regularized_beta(x, df / 2.0, 0.5)
    return 1.0 - 0.5 * ib if t > 0 else 0.5 * ib

def student_t_ppf(p, df):
    if not 0 < p < 1:
        raise QuantError("probability_out_of_range")
    if p == 0.5:
        return 0.0
    sign = 1.0 if p > 0.5 else -1.0
    target = p if p > 0.5 else 1.0 - p
    lo, hi = 0.0, 1.0
    while student_t_cdf(hi, df) < target and hi < 1e6:
        hi *= 2.0
    for _ in range(100):
        mid = (lo + hi) / 2.0
        if student_t_cdf(mid, df) < target:
            lo = mid
        else:
            hi = mid
    return sign * (lo + hi) / 2.0

def confidence_z(confidence):
    confidence = finite_float(confidence, "confidence")
    if not 0 < confidence < 1:
        raise QuantError("confidence_out_of_range")
    return NormalDist().inv_cdf(0.5 + confidence / 2.0)

def describe(spec):
    values = numeric_list(spec.get("values"), "values")
    n = len(values)
    mean = statistics.fmean(values)
    median = statistics.median(values)
    q1 = quantile_type7(values, 0.25)
    q3 = quantile_type7(values, 0.75)
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    return {
        "n": n,
        "mean": mean,
        "median": median,
        "min": min(values),
        "max": max(values),
        "variance_sample": statistics.variance(values) if n > 1 else None,
        "stdev_sample": statistics.stdev(values) if n > 1 else None,
        "q1": q1,
        "q3": q3,
        "iqr": iqr,
        "outlier_lower_fence": lower,
        "outlier_upper_fence": upper,
        "outliers": [v for v in values if v < lower or v > upper],
        "quantile_method": "linear_type7",
    }

def pearson(spec):
    x = numeric_list(spec.get("x"), "x", 3)
    y = numeric_list(spec.get("y"), "y", 3)
    if len(x) != len(y):
        raise QuantError("x_y_length_mismatch")
    n = len(x)
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sx2 = sum((v - mx) ** 2 for v in x)
    sy2 = sum((v - my) ** 2 for v in y)
    if sx2 <= 0 or sy2 <= 0:
        raise QuantError("correlation_zero_variance")
    cross = sum((a - mx) * (b - my) for a, b in zip(x, y))
    r = cross / math.sqrt(sx2 * sy2)
    r = max(-1.0, min(1.0, r))
    df = n - 2
    if abs(r) >= 1:
        t = math.copysign(float("inf"), r)
        p = 0.0
    else:
        t = r * math.sqrt(df / (1 - r * r))
        p = 2 * (1 - student_t_cdf(abs(t), df))
    return {"n": n, "r": r, "r2": r * r, "t": t, "df": df, "p_two_sided": p}

def simple_regression(spec):
    x = numeric_list(spec.get("x"), "x", 3)
    y = numeric_list(spec.get("y"), "y", 3)
    if len(x) != len(y):
        raise QuantError("x_y_length_mismatch")
    n = len(x)
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sxx = sum((v - mx) ** 2 for v in x)
    if sxx <= 0:
        raise QuantError("regression_zero_x_variance")
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    slope = sxy / sxx
    intercept = my - slope * mx
    fitted = [intercept + slope * v for v in x]
    residuals = [yy - ff for yy, ff in zip(y, fitted)]
    sse = sum(e * e for e in residuals)
    sst = sum((yy - my) ** 2 for yy in y)
    r2 = 1 - sse / sst if sst > 0 else 1.0
    df = n - 2
    residual_variance = sse / df
    residual_se = math.sqrt(residual_variance)
    slope_se = math.sqrt(residual_variance / sxx)
    t = slope / slope_se if slope_se > 0 else math.copysign(float("inf"), slope)
    p = 2 * (1 - student_t_cdf(abs(t), df)) if math.isfinite(t) else 0.0
    return {
        "n": n,
        "intercept": intercept,
        "slope": slope,
        "r2": r2,
        "residual_standard_error": residual_se,
        "slope_se": slope_se,
        "slope_t": t,
        "slope_df": df,
        "slope_p_two_sided": p,
    }

def proportion_ci(spec):
    successes = finite_float(spec.get("successes"), "successes")
    total = finite_float(spec.get("total"), "total")
    confidence = finite_float(spec.get("confidence", 0.95), "confidence")
    if total <= 0 or successes < 0 or successes > total:
        raise QuantError("proportion_counts_invalid")
    p = successes / total
    z = confidence_z(confidence)
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return {
        "successes": successes,
        "total": total,
        "proportion": p,
        "confidence": confidence,
        "method": "wilson",
        "ci_low": max(0.0, center - half),
        "ci_high": min(1.0, center + half),
    }

def difference_proportions(spec):
    sa = finite_float(spec.get("successes_a"), "successes_a")
    na = finite_float(spec.get("total_a"), "total_a")
    sb = finite_float(spec.get("successes_b"), "successes_b")
    nb = finite_float(spec.get("total_b"), "total_b")
    confidence = finite_float(spec.get("confidence", 0.95), "confidence")
    if na <= 0 or nb <= 0 or sa < 0 or sb < 0 or sa > na or sb > nb:
        raise QuantError("difference_proportion_counts_invalid")
    pa, pb = sa / na, sb / nb
    diff = pb - pa
    zcrit = confidence_z(confidence)
    se_unpooled = math.sqrt(pa * (1 - pa) / na + pb * (1 - pb) / nb)
    pooled = (sa + sb) / (na + nb)
    se_pooled = math.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb))
    z = diff / se_pooled if se_pooled > 0 else 0.0
    p_two = 2 * (1 - NormalDist().cdf(abs(z)))
    return {
        "proportion_a": pa,
        "proportion_b": pb,
        "difference_b_minus_a": diff,
        "confidence": confidence,
        "method": "wald_unpooled_ci_pooled_z_test",
        "ci_low": diff - zcrit * se_unpooled,
        "ci_high": diff + zcrit * se_unpooled,
        "z": z,
        "p_two_sided": p_two,
    }

def mean_ci(spec):
    values = numeric_list(spec.get("values"), "values", 2)
    confidence = finite_float(spec.get("confidence", 0.95), "confidence")
    n = len(values)
    mean = statistics.fmean(values)
    sd = statistics.stdev(values)
    df = n - 1
    critical = student_t_ppf(0.5 + confidence / 2.0, df)
    se = sd / math.sqrt(n)
    return {
        "n": n,
        "mean": mean,
        "stdev_sample": sd,
        "standard_error": se,
        "df": df,
        "confidence": confidence,
        "critical_t": critical,
        "ci_low": mean - critical * se,
        "ci_high": mean + critical * se,
    }

def one_sample_t(spec):
    values = numeric_list(spec.get("values"), "values", 2)
    mu0 = finite_float(spec.get("mu0", 0), "mu0")
    n = len(values)
    mean = statistics.fmean(values)
    sd = statistics.stdev(values)
    se = sd / math.sqrt(n)
    if se <= 0:
        raise QuantError("one_sample_t_zero_variance")
    t = (mean - mu0) / se
    df = n - 1
    p = 2 * (1 - student_t_cdf(abs(t), df))
    return {"n": n, "mean": mean, "mu0": mu0, "t": t, "df": df, "p_two_sided": p}

def welch_t(spec):
    x = numeric_list(spec.get("x"), "x", 2)
    y = numeric_list(spec.get("y"), "y", 2)
    nx, ny = len(x), len(y)
    mx, my = statistics.fmean(x), statistics.fmean(y)
    vx, vy = statistics.variance(x), statistics.variance(y)
    ax, ay = vx / nx, vy / ny
    se = math.sqrt(ax + ay)
    if se <= 0:
        raise QuantError("welch_t_zero_variance")
    t = (mx - my) / se
    df = (ax + ay) ** 2 / ((ax * ax) / (nx - 1) + (ay * ay) / (ny - 1))
    p = 2 * (1 - student_t_cdf(abs(t), df))
    return {
        "n_x": nx, "n_y": ny, "mean_x": mx, "mean_y": my,
        "difference_x_minus_y": mx - my, "t": t, "df": df, "p_two_sided": p,
    }

def coefficient_t(spec):
    estimate = finite_float(spec.get("estimate"), "estimate")
    se = finite_float(spec.get("se"), "se")
    df = finite_float(spec.get("df"), "df")
    if se <= 0 or df <= 0:
        raise QuantError("coefficient_t_invalid_se_or_df")
    t = estimate / se
    p = 2 * (1 - student_t_cdf(abs(t), df))
    return {"estimate": estimate, "se": se, "t": t, "df": df, "p_two_sided": p}

def bootstrap_ci(spec):
    values = numeric_list(spec.get("values"), "values", 2)
    draws = int(spec.get("draws", 10000))
    seed = int(spec.get("seed", 0))
    confidence = finite_float(spec.get("confidence", 0.95), "confidence")
    statistic_name = str(spec.get("statistic", "mean")).strip().lower()
    if draws < 100 or draws > MAX_DRAWS:
        raise QuantError("bootstrap_draws_out_of_range")
    if statistic_name not in ("mean", "median"):
        raise QuantError("bootstrap_statistic_not_allowed")
    rng = random.Random(seed)
    n = len(values)
    fn = statistics.fmean if statistic_name == "mean" else statistics.median
    sims = []
    for _ in range(draws):
        sample = [values[rng.randrange(n)] for _ in range(n)]
        sims.append(fn(sample))
    alpha = 1 - confidence
    return {
        "n": n,
        "draws": draws,
        "seed": seed,
        "statistic": statistic_name,
        "estimate": fn(values),
        "confidence": confidence,
        "ci_low": quantile_type7(sims, alpha / 2),
        "ci_high": quantile_type7(sims, 1 - alpha / 2),
        "method": "percentile_bootstrap",
    }

SAFE_EXPR_FUNCS = {
    "abs": abs, "sqrt": math.sqrt, "log": math.log,
    "log10": math.log10, "exp": math.exp,
}

def eval_expr_node(node, variables):
    if isinstance(node, ast.Expression):
        return eval_expr_node(node.body, variables)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.Name) and node.id in variables:
        return finite_float(variables[node.id], node.id)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        v = eval_expr_node(node.operand, variables)
        return v if isinstance(node.op, ast.UAdd) else -v
    if isinstance(node, ast.BinOp):
        a = eval_expr_node(node.left, variables)
        b = eval_expr_node(node.right, variables)
        if isinstance(node.op, ast.Add): out = a + b
        elif isinstance(node.op, ast.Sub): out = a - b
        elif isinstance(node.op, ast.Mult): out = a * b
        elif isinstance(node.op, ast.Div): out = a / b
        elif isinstance(node.op, ast.Mod): out = a % b
        elif isinstance(node.op, ast.Pow):
            if abs(b) > MAX_POWER_ABS: raise QuantError("exponent_out_of_bounds")
            out = a ** b
        else: raise QuantError("operator_not_allowed")
        if not math.isfinite(out): raise QuantError("expression_non_finite")
        return float(out)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SAFE_EXPR_FUNCS:
        if node.keywords: raise QuantError("keyword_arguments_not_allowed")
        out = SAFE_EXPR_FUNCS[node.func.id](*[eval_expr_node(a, variables) for a in node.args])
        return finite_float(out, "function_result")
    raise QuantError("expression_syntax_not_allowed")

def compile_expression(expr):
    expr = str(expr or "").strip()
    if not expr or len(expr) > MAX_EXPR_CHARS:
        raise QuantError("expression_invalid_length")
    return ast.parse(expr, mode="eval")

def draw_distribution(rng, spec):
    if not isinstance(spec, dict):
        raise QuantError("distribution_spec_invalid")
    kind = str(spec.get("type", "")).strip().lower()
    if kind == "fixed":
        return finite_float(spec.get("value"), "fixed_value")
    if kind == "triangular":
        lo = finite_float(spec.get("min"), "min")
        mode = finite_float(spec.get("mode"), "mode")
        hi = finite_float(spec.get("max"), "max")
        if not lo <= mode <= hi or lo == hi:
            raise QuantError("triangular_parameters_invalid")
        return rng.triangular(lo, hi, mode)
    if kind == "uniform":
        lo = finite_float(spec.get("min"), "min")
        hi = finite_float(spec.get("max"), "max")
        if not lo < hi: raise QuantError("uniform_parameters_invalid")
        return rng.uniform(lo, hi)
    if kind == "normal":
        mean = finite_float(spec.get("mean"), "mean")
        sd = finite_float(spec.get("sd"), "sd")
        if sd <= 0: raise QuantError("normal_sd_invalid")
        return rng.gauss(mean, sd)
    raise QuantError("distribution_type_not_allowed")

def monte_carlo_expression(spec):
    expr = compile_expression(spec.get("expression"))
    distributions = spec.get("distributions")
    if not isinstance(distributions, dict) or not distributions:
        raise QuantError("distributions_required")
    draws = int(spec.get("draws", 10000))
    seed = int(spec.get("seed", 0))
    if draws < 100 or draws > MAX_DRAWS:
        raise QuantError("monte_carlo_draws_out_of_range")
    rng = random.Random(seed)
    outputs = []
    for _ in range(draws):
        variables = {name: draw_distribution(rng, cfg) for name, cfg in distributions.items()}
        outputs.append(eval_expr_node(expr, variables))
    return {
        "draws": draws,
        "seed": seed,
        "mean": statistics.fmean(outputs),
        "median": statistics.median(outputs),
        "p10": quantile_type7(outputs, 0.10),
        "p90": quantile_type7(outputs, 0.90),
        "probability_below_zero": sum(v < 0 for v in outputs) / draws,
        "min": min(outputs),
        "max": max(outputs),
    }

OPS = {
    "describe": describe,
    "pearson_correlation": pearson,
    "simple_linear_regression": simple_regression,
    "proportion_ci": proportion_ci,
    "difference_proportions_ci": difference_proportions,
    "mean_ci": mean_ci,
    "one_sample_t": one_sample_t,
    "welch_t": welch_t,
    "coefficient_t": coefficient_t,
    "bootstrap_ci": bootstrap_ci,
    "monte_carlo_expression": monte_carlo_expression,
}

def path_get(obj, path):
    cur = obj
    for part in str(path).split("."):
        if not isinstance(cur, dict) or part not in cur:
            raise QuantError(f"claim_path_missing:{path}")
        cur = cur[part]
    return cur

def compare_claims(result, claims, abs_tol, rel_tol):
    if not isinstance(claims, dict) or not claims:
        return {"required": True, "all_match": False, "error": "claims_required", "comparisons": []}
    comparisons = []
    all_match = True
    for path, claimed_raw in claims.items():
        actual_raw = path_get(result, path)
        if isinstance(claimed_raw, bool):
            matched = actual_raw is claimed_raw
            claimed = claimed_raw
            actual = actual_raw
        else:
            claimed = finite_float(claimed_raw, f"claim_{path}")
            actual = finite_float(actual_raw, f"actual_{path}")
            matched = math.isclose(actual, claimed, rel_tol=rel_tol, abs_tol=abs_tol)
        all_match = all_match and matched
        comparisons.append({"path": path, "claimed": claimed, "actual": actual, "matched": matched})
    return {"required": True, "all_match": all_match, "comparisons": comparisons}

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    analyses = payload.get("analyses")
    if not isinstance(analyses, list) or not analyses or len(analyses) > MAX_ANALYSES:
        raise QuantError("analyses_invalid")
    abs_tol = finite_float(payload.get("absolute_tolerance", DEFAULT_ABS_TOL), "absolute_tolerance")
    rel_tol = finite_float(payload.get("relative_tolerance", DEFAULT_REL_TOL), "relative_tolerance")
    rows = []
    all_claims_match = True
    for index, raw in enumerate(analyses):
        if not isinstance(raw, dict):
            raise QuantError("analysis_invalid")
        op = str(raw.get("analysis") or raw.get("operation") or "").strip()
        if op not in OPS:
            raise QuantError(f"analysis_not_allowed:{op}")
        spec = raw.get("spec")
        if not isinstance(spec, dict):
            raise QuantError("analysis_spec_required")
        result = OPS[op](spec)
        comparison = compare_claims(
            result,
            raw.get("claims"),
            finite_float(raw.get("absolute_tolerance", abs_tol), "analysis_absolute_tolerance"),
            finite_float(raw.get("relative_tolerance", rel_tol), "analysis_relative_tolerance"),
        )
        all_claims_match = all_claims_match and comparison.get("all_match") is True
        rows.append({
            "index": index,
            "id": str(raw.get("id") or f"analysis_{index+1}")[:120],
            "analysis": op,
            "input_hash": canonical_hash(spec),
            "result": result,
            "claim_verification": comparison,
        })
    sys.stdout.write(json.dumps({
        "ok": True,
        "engine": "aau_quantitative_python_v0_1",
        "analysis_count": len(rows),
        "all_claims_match": all_claims_match,
        "analyses": rows,
    }, separators=(",", ":"), allow_nan=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "engine": "aau_quantitative_python_v0_1",
            "error": f"{type(exc).__name__}:{str(exc)}"[:500],
        }, separators=(",", ":")))
        sys.exit(2)
