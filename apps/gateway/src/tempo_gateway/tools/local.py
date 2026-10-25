"""Tools that need no network: arithmetic done exactly (a model's mental maths isn't), and dates
(what day a date is, how many days until it)."""

from __future__ import annotations

import ast
import math
import operator
import re
from collections.abc import Callable
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from .base import Context, Refused, Result, Tool, need, text

_BINARY: dict[type[ast.operator], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY: dict[type[ast.unaryop], Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_CALLS: dict[str, Callable[..., Any]] = {
    "round": round,
    "abs": abs,
    "sqrt": math.sqrt,
    "min": min,
    "max": max,
}
MAX_POWER = 100
MAX_SIZE = 1e15


def evaluate(expression: str) -> float | int:
    """Arithmetic only: numbers, + - * / // % **, brackets, round/abs/sqrt/min/max. Nothing else
    is evaluated (no names, attributes or other calls), and huge powers are refused."""

    def walk(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, int | float)
            and not isinstance(node.value, bool)
        ):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
            left, right = walk(node.left), walk(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > MAX_POWER:
                raise Refused("that power is too big")
            value = _BINARY[type(node.op)](left, right)
        elif isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            value = _UNARY[type(node.op)](walk(node.operand))
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _CALLS
            and not node.keywords
        ):
            value = _CALLS[node.func.id](*(walk(a) for a in node.args))
        else:
            raise Refused("only arithmetic can be worked out")
        if isinstance(value, int | float) and abs(value) > MAX_SIZE:
            raise Refused("that number is too big")
        return value

    cleaned = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", expression)  # 1,200 is twelve hundred
    for symbol, python in (("×", "*"), ("÷", "/"), ("£", ""), ("^", "**")):
        cleaned = cleaned.replace(symbol, python)
    try:
        return walk(ast.parse(cleaned, mode="eval"))  # type: ignore[no-any-return]
    except (SyntaxError, ZeroDivisionError, ValueError, TypeError) as exc:
        raise Refused(f"that sum can't be worked out ({type(exc).__name__})") from None


async def calculate(ctx: Context, args: dict[str, str]) -> Result:
    expression = need(args, "expression", "the sum", 200)
    value = evaluate(expression)
    shown = f"{value:,.2f}".rstrip("0").rstrip(".") if isinstance(value, float) else f"{value:,}"
    return {"expression": expression, "result": shown}, []


async def date_info(ctx: Context, args: dict[str, str]) -> Result:
    """A date's weekday, how far it is from today, and optionally the date some days on."""
    raw = need(args, "date", "which date (YYYY-MM-DD)", 10)
    try:
        when = date.fromisoformat(raw)
    except ValueError:
        raise Refused("give the date as YYYY-MM-DD") from None
    today = ctx.today()
    info: dict[str, Any] = {
        "date": when.isoformat(),
        "weekday": when.strftime("%A"),
        "days_from_today": (when - today).days,
        "today": today.isoformat(),
    }
    if add := (args.get("add_days") or "").strip():
        try:
            later = when + timedelta(days=int(Decimal(add)))
        except (InvalidOperation, ValueError, OverflowError):
            raise Refused("add_days must be a whole number") from None
        info["plus_days"] = {
            "days": int(Decimal(add)),
            "date": later.isoformat(),
            "weekday": later.strftime("%A"),
        }
    return info, []


CALCULATE = Tool(
    "calculate",
    "Work out a sum exactly (e.g. 15% of 240 is 240*15/100). Use it for any arithmetic.",
    {"expression": text("the arithmetic, e.g. 240*15/100")},
    ("expression",),
    calculate,
    lambda a: f"Worked out {a.get('expression', '')}",
    "tempo",
)
DATES = Tool(
    "date_info",
    "What weekday a date is, how many days away it is, or the date a number of days later.",
    {"date": text("YYYY-MM-DD"), "add_days": text("optional: days to add, e.g. 28")},
    ("date",),
    date_info,
    lambda a: f"Worked out the date {a.get('date', '')}",
    "tempo",
)
