from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

from app.schemas.smart_contract_audit import AuditFinding


Severity = Literal["low", "medium", "high", "critical"]


@dataclass(frozen=True)
class AuditRule:
    key: str
    title: str
    severity: Severity
    description: str
    suggestion: str
    category: str
    pattern: re.Pattern[str]
    fast_mode: bool = True


@dataclass(frozen=True)
class AnalysisReport:
    findings: tuple[AuditFinding, ...]
    risk_score: int
    risk_level: Literal["low", "medium", "high", "critical"]
    attack_surface_summary: str
    fix_suggestions: tuple[str, ...]


RULES: tuple[AuditRule, ...] = (
    AuditRule(
        key="delegatecall",
        title="Delegatecall execution path detected",
        severity="critical",
        description=(
            "The contract exposes delegatecall usage, which can let external code "
            "mutate caller storage when target control or calldata validation is weak."
        ),
        suggestion=(
            "Isolate delegatecall behind strict allowlists, immutable targets, and "
            "post-call state invariants."
        ),
        category="privileged execution",
        pattern=re.compile(r"\.delegatecall\s*\("),
    ),
    AuditRule(
        key="tx_origin",
        title="tx.origin authorization pattern detected",
        severity="high",
        description=(
            "Authorization paths referencing tx.origin are phishing-prone and can be "
            "bypassed through malicious intermediate contracts."
        ),
        suggestion="Replace tx.origin checks with msg.sender plus explicit role controls.",
        category="access control",
        pattern=re.compile(r"\btx\.origin\b"),
    ),
    AuditRule(
        key="selfdestruct",
        title="Self-destruct capability present",
        severity="high",
        description=(
            "Selfdestruct or suicide primitives widen governance and kill-switch risk, "
            "especially if reachable by a single privileged actor."
        ),
        suggestion="Remove selfdestruct or gate it behind multi-sig and time-delayed controls.",
        category="lifecycle control",
        pattern=re.compile(r"\b(selfdestruct|suicide)\b"),
    ),
    AuditRule(
        key="unchecked_low_level_call",
        title="Low-level external call path detected",
        severity="high",
        description=(
            "Low-level call usage increases error-handling and reentrancy risk when "
            "return values and post-conditions are not enforced."
        ),
        suggestion=(
            "Validate low-level call return values, order state updates defensively, "
            "and add reentrancy-focused invariant tests."
        ),
        category="external interaction",
        pattern=re.compile(r"\.call\s*(?:\{[^}]*\})?\s*\("),
    ),
    AuditRule(
        key="block_timestamp",
        title="Timestamp-dependent logic detected",
        severity="medium",
        description=(
            "block.timestamp dependent logic can be miner-influenced and should not "
            "anchor security-critical randomness or tight-value execution windows."
        ),
        suggestion=(
            "Avoid using block.timestamp for randomness or sensitive branching; prefer "
            "bounded windows and explicit oracle inputs."
        ),
        category="timing dependency",
        pattern=re.compile(r"\bblock\.timestamp\b"),
        fast_mode=False,
    ),
    AuditRule(
        key="unsafe_randomness",
        title="Weak on-chain randomness source detected",
        severity="medium",
        description=(
            "The contract appears to derive randomness from chain variables that are "
            "predictable or miner-influenced."
        ),
        suggestion=(
            "Use a verifiable randomness source or commit-reveal flow instead of "
            "block variables or deterministic hashes."
        ),
        category="randomness",
        pattern=re.compile(r"(blockhash|keccak256\s*\([^)]*(block\.timestamp|block\.number))"),
        fast_mode=False,
    ),
    AuditRule(
        key="upgrade_hook",
        title="Upgrade hook exposed in source",
        severity="medium",
        description=(
            "Upgrade entrypoints increase governance and implementation-swap risk if "
            "authorization and timelock guarantees are weak."
        ),
        suggestion=(
            "Protect upgrade hooks with multi-sig or timelock controls and cover them "
            "with explicit authorization tests."
        ),
        category="upgradeability",
        pattern=re.compile(r"\b(upgradeTo|upgradeToAndCall|setImplementation)\b"),
        fast_mode=False,
    ),
)


def resolve_target_identifier(
    *,
    chain: str | None,
    contract_address: str | None,
) -> str:
    if chain and contract_address:
        return f"{chain}:{contract_address}"
    return "inline_source_bundle"


def _line_evidence(source_bundle: str, pattern: re.Pattern[str]) -> str | None:
    for line_number, line in enumerate(source_bundle.splitlines(), start=1):
        if pattern.search(line):
            excerpt = " ".join(line.strip().split())
            if len(excerpt) > 160:
                excerpt = f"{excerpt[:157]}..."
            return f"Line {line_number}: {excerpt}"
    return None


def _selected_rules(analysis_depth: Literal["fast", "standard"]) -> tuple[AuditRule, ...]:
    if analysis_depth == "fast":
        return tuple(rule for rule in RULES if rule.fast_mode)
    return RULES


def _risk_score(findings: tuple[AuditFinding, ...]) -> int:
    weights = {
        "low": 4,
        "medium": 10,
        "high": 20,
        "critical": 35,
    }
    score = sum(weights[finding.severity] for finding in findings)
    if len(findings) >= 3:
        score += 5
    return min(score, 100)


def _risk_level(score: int) -> Literal["low", "medium", "high", "critical"]:
    if score >= 85:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def _attack_surface_summary(
    source_bundle: str,
    findings: tuple[AuditFinding, ...],
) -> str:
    source_lines = len(source_bundle.splitlines())
    contract_count = len(re.findall(r"\b(contract|library|interface)\s+\w+", source_bundle))
    if not findings:
        return (
            f"The bundle spans {source_lines} lines across {max(contract_count, 1)} "
            "Solidity units and no high-confidence rule matches were triggered in the selected analysis mode."
        )
    categories: list[str] = []
    for rule in RULES:
        if any(finding.title == rule.title for finding in findings):
            categories.append(rule.category)
    unique_categories = ", ".join(dict.fromkeys(categories).keys())
    return (
        f"The bundle spans {source_lines} lines across {max(contract_count, 1)} Solidity units. "
        f"Primary attack surface concentrates around {unique_categories}. "
        "Review privileged entrypoints, external interactions, and upgrade controls before production deployment."
    )


def analyze_source_bundle(
    source_bundle: str,
    *,
    analysis_depth: Literal["fast", "standard"],
    include_evidence: bool,
) -> AnalysisReport:
    findings: list[AuditFinding] = []
    suggestions: list[str] = []
    for rule in _selected_rules(analysis_depth):
        if not rule.pattern.search(source_bundle):
            continue
        evidence = _line_evidence(source_bundle, rule.pattern) if include_evidence else None
        findings.append(
            AuditFinding(
                title=rule.title,
                severity=rule.severity,
                description=rule.description,
                evidence=evidence,
            )
        )
        if rule.suggestion not in suggestions:
            suggestions.append(rule.suggestion)

    if not suggestions:
        suggestions.append(
            "Add invariant tests around privileged state transitions and keep a second-pass manual review before deployment."
        )

    findings_tuple = tuple(findings)
    score = _risk_score(findings_tuple)
    return AnalysisReport(
        findings=findings_tuple,
        risk_score=score,
        risk_level=_risk_level(score),
        attack_surface_summary=_attack_surface_summary(source_bundle, findings_tuple),
        fix_suggestions=tuple(suggestions[:5]),
    )
