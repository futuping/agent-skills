#!/usr/bin/env python3
"""Read-only evidence-record consistency checks, NOT a proof of software quality.

Python >=3.10, stdlib only. Never executes commands stored in a record.
Return codes: 0 consistent, 1 validation errors, 2 usage/input errors.
Only inspect trusted, quiescent local roots: concurrent hostile filesystem
mutation and fabricated-but-hashed logs are outside this checker's guarantee.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any

VERSION = "1.1.1"
MAX_RECORD = 2 * 1024 * 1024
MAX_EVIDENCE = 10 * 1024 * 1024
STATUSES = {"未开始", "进行中", "待验证", "通过", "阻塞", "不适用"}
KINDS = {"exploration", "new_project", "existing_project", "change", "bugfix", "prototype", "incident", "maintenance", "evaluation", "retirement"}
STAGES = {f"{i:02d}" for i in range(0, 16)}
CAPABILITY_STATES = {"available_verified", "configured_unverified", "planned", "unavailable"}
EVIDENCE_KINDS = {"execution", "observation", "human_decision", "simulation", "plan", "citation"}
ACTUAL = {"execution", "observation", "human_decision"}
UNKNOWN = {"unverified", "unassigned", "not-yet-inspected", "not-yet-assigned", "", "unknown"}


class InputError(ValueError):
    """Invalid or unsafe input file."""


def read_bounded(path: Path, root: Path, limit: int) -> bytes:
    """Resolve containment, reject non-regular files, bound read; no file writes."""
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
        if not resolved.is_file():
            raise InputError("not a regular file")
        # NOFOLLOW guards the final component after resolving; parent-directory
        # races remain outside the supported trusted/quiescent-root threat model.
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        fd = os.open(resolved, flags)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise InputError("not a regular file")
            if info.st_size > limit:
                raise InputError(f"file exceeds {limit} bytes")
            data = handle.read(limit + 1)
        if len(data) > limit:
            raise InputError(f"file exceeds {limit} bytes")
        return data
    except InputError:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise InputError(f"unreadable file or path escapes root: {path}: {exc}") from exc


def no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise InputError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def reject_constant(value: str) -> None:
    raise InputError(f"non-finite JSON value: {value}")


def load_record(path: Path, root: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_bounded(path, root, MAX_RECORD).decode("utf-8-sig"),
                          object_pairs_hook=no_duplicates, parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise InputError(f"invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError("record must be a JSON object")
    return data


def validate_record(data: dict[str, Any], root: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings = ["一致性检查不证明日志真实、预期独立、授权合法或软件正确。"]
    counters = {"criteria": 0, "evidence": 0, "files_checked": 0}

    def err(message: str) -> None:
        errors.append(message)

    def text(obj: dict[str, Any], key: str, where: str) -> bool:
        if not isinstance(obj.get(key), str) or not obj[key].strip():
            err(f"{where}.{key}: non-empty string required")
            return False
        return True

    def target(obj: dict[str, Any], where: str, verified: bool) -> bool:
        """Context targets are intake snapshots, never surrogate software targets."""
        ok = text(obj, "object", where)
        target_type = obj.get("target_type", "software")
        if target_type not in ("software", "context"):
            err(f"{where}.target_type: software/context required")
            ok = False
        if ok and verified and obj["object"].strip().lower() in UNKNOWN:
            err(f"{where}.object: unresolved target cannot support a pass")
            ok = False
        for key in ("revision", "environment"):
            if target_type == "context" and key in obj and obj[key] is None:
                reasons = obj.get("absence_reasons")
                if not isinstance(reasons, dict) or not text(reasons, key, where + ".absence_reasons"):
                    err(f"{where}.{key}: null context field needs an absence reason")
                    ok = False
                continue
            valid = text(obj, key, where)
            if valid and verified and obj[key].strip().lower() in UNKNOWN:
                err(f"{where}.{key}: unresolved target cannot support a pass")
                valid = False
            ok = valid and ok
        if target_type == "context":
            valid = text(obj, "snapshot_id", where)
            if valid and verified and obj["snapshot_id"].strip().lower() in UNKNOWN:
                err(f"{where}.snapshot_id: unresolved context snapshot")
                valid = False
            ok = valid and ok
        return ok

    def same_target(left: dict[str, Any], right: dict[str, Any]) -> bool:
        if left.get("target_type", "software") != right.get("target_type", "software"):
            return False
        fields = ("object", "revision", "environment")
        if left.get("target_type") == "context":
            fields += ("snapshot_id",)
        return all(left.get(k) == right.get(k) for k in fields)

    if type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        err("schema_version: expected integer 1")
    task = data.get("task")
    if not isinstance(task, dict):
        err("task: object required")
        task = {}
    for key in ("id", "execution_owner", "acceptance_owner"):
        text(task, key, "task")
    target(task, "task", task.get("status") == "通过")
    if not isinstance(task.get("kind"), str) or task["kind"] not in KINDS:
        err("task.kind: unsupported kind")
    if not isinstance(task.get("status"), str) or task["status"] not in STATUSES:
        err("task.status: unsupported status")
    if task.get("risk") not in ("low", "medium", "high"):
        err("task.risk: low/medium/high required")
    if task.get("status") == "通过":
        for key in ("id", "execution_owner", "acceptance_owner"):
            if isinstance(task.get(key), str) and task[key].strip().lower() in UNKNOWN:
                err(f"task.{key}: unresolved field cannot support a pass")
    stages = task.get("selected_stages")
    if (not isinstance(stages, list) or
        any(not isinstance(x, str) or x not in STAGES for x in stages)):
        err("task.selected_stages: list of 00..15 required")
        stages = []
    if len(stages) != len(set(stages)):
        err("task.selected_stages: duplicate stage")
    if task.get("status") == "通过" and not stages:
        err("passed task must select at least one stage")
    authorization = task.get("authorization")
    if not isinstance(authorization, dict):
        err("task.authorization: object required")
    else:
        for key in ("allowed", "forbidden"):
            if not isinstance(authorization.get(key), list) or any(not isinstance(x, str) for x in authorization[key]):
                err(f"task.authorization.{key}: string list required")
    budget = task.get("budget")
    if not isinstance(budget, dict):
        err("task.budget: object required")
    else:
        for key in ("max_hypothesis_cycles", "max_validation_runs", "max_same_failure_retries"):
            if key not in budget or (budget[key] is not None and
                    (type(budget[key]) is not int or budget[key] < 0)):
                err(f"task.budget.{key}: non-negative integer or explicit null required")
        if "review_checkpoints" in budget:
            checkpoints = budget["review_checkpoints"]
            if not isinstance(checkpoints, dict):
                err("task.budget.review_checkpoints: object required")
            else:
                for key in ("hypothesis_cycles", "validation_runs"):
                    if type(checkpoints.get(key)) is not int or checkpoints[key] <= 0:
                        err(f"task.budget.review_checkpoints.{key}: positive integer required")
    handoff = data.get("handoff")
    if not isinstance(handoff, dict):
        err("handoff: object required")
    else:
        text(handoff, "next_action", "handoff")
        if not isinstance(handoff.get("blockers"), list) or any(not isinstance(x, str) for x in handoff["blockers"]):
            err("handoff.blockers: string list required")
        elif task.get("status") == "通过" and handoff["blockers"]:
            err("passed task cannot retain blockers in its declared scope")

    def indexed(items: Any, name: str) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        if not isinstance(items, list):
            err(f"{name}: list required")
            return out
        if len(items) > 1000:
            err(f"{name}: at most 1000 entries")
            return out
        for i, item in enumerate(items):
            where = f"{name}[{i}]"
            if not isinstance(item, dict):
                err(f"{where}: object required")
                continue
            if not text(item, "id", where):
                continue
            identity = item["id"]
            if identity in out:
                err(f"{where}: duplicate id {identity}")
            out[identity] = item
        return out

    criteria = indexed(data.get("criteria"), "criteria")
    evidence = indexed(data.get("evidence"), "evidence")
    counters["criteria"], counters["evidence"] = len(criteria), len(evidence)
    valid_evidence: set[str] = set()
    for eid, item in evidence.items():
        start_errors = len(errors)
        where = f"evidence[{eid}]"
        for key in ("producer", "action", "summary", "independence"):
            text(item, key, where)
        kind = item.get("kind")
        if not isinstance(kind, str) or kind not in EVIDENCE_KINDS:
            err(f"{where}.kind: invalid")
        if item.get("result") not in ("pass", "fail", "inconclusive"):
            err(f"{where}.result: invalid")
        target(item, where, isinstance(kind, str) and kind in ACTUAL and item.get("result") == "pass")
        if item.get("target_type") == "context":
            if kind == "execution":
                err(f"{where}: context evidence cannot be technical execution")
            if isinstance(kind, str) and kind in ACTUAL and item.get("purpose") != "intake":
                err(f"{where}: actual context evidence requires purpose=intake")
        try:
            stamp = item.get("timestamp")
            if not isinstance(stamp, str):
                raise ValueError("timestamp string required")
            when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if when.tzinfo is None or when.utcoffset() is None:
                raise ValueError("timezone required")
        except ValueError as exc:
            err(f"{where}.timestamp: {exc}")
        refs = item.get("criterion_ids")
        if not isinstance(refs, list) or any(not isinstance(x, str) for x in refs):
            err(f"{where}.criterion_ids: string list required")
        else:
            if len(refs) != len(set(refs)):
                err(f"{where}.criterion_ids: duplicate reference")
            for cid in refs:
                if cid not in criteria:
                    err(f"{where}: unknown criterion {cid}")
        if isinstance(kind, str) and kind in ACTUAL:
            loc, digest = item.get("locator"), item.get("sha256")
            if not isinstance(loc, str) or not loc.strip() or Path(loc).is_absolute():
                err(f"{where}.locator: relative local file required for actual evidence")
            elif not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
                err(f"{where}.sha256: 64 hex characters required")
            else:
                try:
                    payload = read_bounded(root / loc, root, MAX_EVIDENCE)
                    counters["files_checked"] += 1
                    if hashlib.sha256(payload).hexdigest() != digest.lower():
                        err(f"{where}: SHA256 mismatch")
                except InputError as exc:
                    err(f"{where}: {exc}")
        if len(errors) == start_errors:
            valid_evidence.add(eid)

    active: list[dict[str, Any]] = []
    for cid, item in criteria.items():
        where = f"criteria[{cid}]"
        text(item, "statement", where)
        if item.get("kind") not in ("technical", "user", "value", "review", "intake"):
            err(f"{where}.kind: invalid")
        stage = item.get("stage")
        if stage is not None and (not isinstance(stage, str) or stage not in STAGES):
            err(f"{where}.stage: 00..15 required")
        elif stage is not None and stage not in stages:
            err(f"{where}.stage: must be selected by task")
        if item.get("kind") == "intake":
            if stage != "00" or "00" not in stages:
                err(f"{where}: intake criterion requires selected stage 00")
        elif stage == "00":
            err(f"{where}: stage 00 only accepts intake criteria")
        if type(item.get("critical")) is not bool:
            err(f"{where}.critical: boolean required")
        if not isinstance(item.get("status"), str) or item["status"] not in STATUSES:
            err(f"{where}.status: invalid")
        if item.get("status") == "不适用":
            text(item, "na_reason", where)
            if item.get("critical"):
                err(f"{where}: critical criterion cannot be N/A")
        else:
            active.append(item)
        refs = item.get("evidence_ids")
        if not isinstance(refs, list) or any(not isinstance(x, str) for x in refs):
            err(f"{where}.evidence_ids: string list required")
            refs = []
        elif len(refs) != len(set(refs)):
            err(f"{where}.evidence_ids: duplicate reference")
        for eid in refs:
            if eid not in evidence:
                err(f"{where}: unknown evidence {eid}")
            else:
                reverse = evidence[eid].get("criterion_ids", [])
                if not isinstance(reverse, list) or cid not in reverse:
                    err(f"{where}: reverse link missing for evidence {eid}")
        desired = item.get("target", task)
        if not isinstance(desired, dict):
            err(f"{where}.target: object required")
            desired = task
        if "target" in item:
            target(desired, where + ".target", item.get("status") == "通过")
            if not same_target(desired, task):
                text(item, "target_reason", where)
        if item.get("kind") == "intake":
            if desired.get("target_type") != "context":
                err(f"{where}: intake requires a context target")
        elif desired.get("target_type") == "context":
            err(f"{where}: product criterion cannot use a context target")
        if item.get("status") == "通过":
            criterion_kind = item.get("kind") if isinstance(item.get("kind"), str) else "invalid"
            allowed = {"technical": {"execution"}, "user": {"observation", "human_decision"},
                       "value": {"observation", "human_decision"}, "review": ACTUAL,
                       "intake": {"observation", "human_decision"}}.get(criterion_kind, set())
            matches = [evidence[eid] for eid in refs if eid in valid_evidence
                       and evidence[eid].get("kind") in allowed
                       and evidence[eid].get("result") == "pass"
                       and same_target(evidence[eid], desired)]
            if not matches:
                err(f"{where}: pass requires valid actual evidence matching kind and target")
            if item.get("critical"):
                text(item, "expectation_basis", where)

    # Stage00 uses a separate, explicitly scoped context observation. These
    # fields are optional for legacy records that do not select stage00.
    intake_criteria = [c for c in criteria.values() if c.get("kind") == "intake"]
    applicable_intake = [c for c in intake_criteria if c.get("status") != "不适用"]
    intake_passed = bool(applicable_intake) and all(c.get("status") == "通过" for c in applicable_intake)
    if "00" in stages:
        if not intake_criteria:
            err("stage 00 requires at least one intake criterion")
        meta = data.get("intake")
        if not isinstance(meta, dict):
            err("intake: object required for selected stage 00")
            meta = {}

        def strings(obj: dict[str, Any], key: str, where: str, nonempty: bool = False) -> list[str]:
            value = obj.get(key)
            if (not isinstance(value, list) or
                    any(not isinstance(x, str) or not x.strip() for x in value)):
                err(f"{where}.{key}: non-empty strings list required")
                return []
            if nonempty and not value:
                err(f"{where}.{key}: at least one item required")
            if len(value) != len(set(value)):
                err(f"{where}.{key}: duplicate value")
            return value

        text(meta, "goal", "intake")
        strings(meta, "non_goals", "intake")
        strings(meta, "stop_conditions", "intake", intake_passed)
        context = indexed(meta.get("context_index"), "intake.context_index")
        seen_context = False
        for key, entry in context.items():
            where = f"intake.context_index[{key}]"
            for field in ("source", "authority", "read_scope", "reuse"):
                text(entry, field, where)
            if "version" not in entry or (entry["version"] is not None and
                    (not isinstance(entry["version"], str) or not entry["version"].strip())):
                err(f"{where}.version: non-empty string or explicit null required")
            if entry.get("read_status") not in ("observed", "excerpt", "not_accessible", "not_read"):
                err(f"{where}.read_status: unsupported")
            seen_context = seen_context or entry.get("read_status") in ("observed", "excerpt")
            strings(entry, "conflicts", where)
        if intake_passed and not seen_context:
            err("passed intake requires at least one actually read context source")
        statements = indexed(meta.get("statements"), "intake.statements")
        for key, entry in statements.items():
            where = f"intake.statements[{key}]"
            text(entry, "statement", where)
            if entry.get("category") not in ("fact", "assumption", "preference", "decision", "to_verify"):
                err(f"{where}.category: unsupported")
            if entry.get("category") in ("fact", "decision", "preference"):
                text(entry, "basis", where)
            elif "basis" not in entry or (entry["basis"] is not None and not isinstance(entry["basis"], str)):
                err(f"{where}.basis: string or explicit null required")
        if intake_passed and not statements:
            err("passed intake requires classified statements, not a blank checklist")
        unknowns = indexed(meta.get("unknowns"), "intake.unknowns")
        for key, entry in unknowns.items():
            where = f"intake.unknowns[{key}]"
            for field in ("question", "impact", "next_step"):
                text(entry, field, where)
            strings(entry, "blocks", where)
        # An explicit capability scope must be a current target, not an old
        # evidence target relabelled as current. Without an override, use the
        # unique intake context (which can differ from a mixed task's software
        # target). Different contexts require a real, scoped reuse observation.
        intake_targets: list[dict[str, Any]] = []
        for criterion in applicable_intake:
            current = criterion.get("target", task)
            if isinstance(current, dict) and not any(same_target(current, old) for old in intake_targets):
                intake_targets.append(current)
        current_targets = [task, *intake_targets]
        caps = indexed(meta.get("capabilities"), "intake.capabilities")
        for key, entry in caps.items():
            where = f"intake.capabilities[{key}]"
            text(entry, "name", where)
            text(entry, "basis", where)
            state = entry.get("status")
            if not isinstance(state, str) or state not in CAPABILITY_STATES:
                err(f"{where}.status: unsupported capability state")
            refs = strings(entry, "evidence_ids", where)
            if any(eid not in evidence for eid in refs):
                err(f"{where}: unknown capability evidence")

            desired = None
            if "verification_target" in entry:
                candidate = entry["verification_target"]
                if not isinstance(candidate, dict):
                    err(f"{where}.verification_target: object required")
                elif target(candidate, where + ".verification_target", state == "available_verified"):
                    if not any(same_target(candidate, current) for current in current_targets):
                        err(f"{where}.verification_target: must match a current task or intake target")
                    else:
                        desired = candidate
            elif len(intake_targets) == 1:
                desired = intake_targets[0]
            elif state == "available_verified" or entry.get("reuse_reviews"):
                err(f"{where}.verification_target: ambiguous intake targets; explicit current target required")

            supported = any(
                eid in valid_evidence and evidence[eid].get("kind") in ACTUAL
                and evidence[eid].get("result") == "pass" and desired is not None
                and same_target(evidence[eid], desired) for eid in refs)
            reuse_reviews = entry.get("reuse_reviews", [])
            if not isinstance(reuse_reviews, list):
                err(f"{where}.reuse_reviews: list required")
                reuse_reviews = []
            seen_reviews: set[tuple[str, str]] = set()
            for index, review in enumerate(reuse_reviews):
                review_where = f"{where}.reuse_reviews[{index}]"
                if not isinstance(review, dict):
                    err(f"{review_where}: object required")
                    continue
                start_errors = len(errors)
                usable = [text(review, field, review_where)
                          for field in ("evidence_id", "review_evidence_id", "reason")]
                if not all(usable):
                    continue
                source_id, review_id = review["evidence_id"], review["review_evidence_id"]
                pair = (source_id, review_id)
                if pair in seen_reviews:
                    err(f"{review_where}: duplicate reuse review")
                seen_reviews.add(pair)
                if source_id == review_id:
                    err(f"{review_where}: reuse review must have a distinct evidence id")
                if source_id not in refs:
                    err(f"{review_where}: source must be in capability evidence_ids")
                source = evidence.get(source_id, {})
                if (source_id not in valid_evidence or source.get("kind") not in ACTUAL
                        or source.get("result") != "pass"):
                    err(f"{review_where}: reuse source requires valid actual passed evidence")
                observation = evidence.get(review_id, {})
                if (review_id not in valid_evidence
                        or observation.get("kind") not in {"observation", "human_decision"}
                        or observation.get("result") != "pass" or desired is None
                        or not same_target(observation, desired)):
                    err(f"{review_where}: reuse review requires actual passed observation/decision matching its verification target")
                if len(errors) == start_errors:
                    supported = True
            if state == "available_verified":
                if not supported:
                    err(f"{where}: available_verified requires actual evidence matching its verification target or a valid reuse review")
        strategies = indexed(meta.get("strategy"), "intake.strategy")
        for key, entry in strategies.items():
            where = f"intake.strategy[{key}]"
            for field in ("mechanism", "reason", "trigger", "cost", "fallback"):
                text(entry, field, where)
            deps = strings(entry, "dependencies", where)
            if any(dep not in caps for dep in deps):
                err(f"{where}: unknown capability dependency")
        if intake_passed and (not caps or not strategies):
            err("passed intake requires capabilities and a minimal strategy")
        reliable = meta.get("reliability")
        if not isinstance(reliable, dict):
            err("intake.reliability: object required")
        else:
            for key in ("sources", "premise_check", "independent_checks", "uncertainty_and_tool_state"):
                text(reliable, key, "intake.reliability")
        route = meta.get("route")
        if not isinstance(route, dict):
            err("intake.route: object required")
        else:
            stage = route.get("next_stage")
            unresolved = "next_stage" in route and stage is None
            if "next_stage" not in route:
                err("intake.route.next_stage: explicit stage or null required")
            elif not unresolved and (not isinstance(stage, str) or stage not in STAGES - {"00"}):
                err("intake.route.next_stage: 01..15 required; not a preparation loop")
            for key in ("reason", "next_action", "authorization_basis", "verification"):
                text(route, key, "intake.route")
            strings(route, "inputs", "intake.route", intake_passed)
            required = strings(route, "required_capabilities", "intake.route")
            gaps = strings(route, "gaps", "intake.route")
            readiness = route.get("readiness")
            if readiness not in ("ready", "gaps_explicit"):
                err("intake.route.readiness: ready/gaps_explicit required")
            if any(cap not in caps for cap in required):
                err("intake.route: unknown required capability")
            if readiness == "ready":
                if gaps or any(caps.get(cap, {}).get("status") != "available_verified" for cap in required):
                    err("intake.route: ready action cannot depend on unverified/unavailable capabilities or gaps")
            elif readiness == "gaps_explicit" and not gaps:
                err("intake.route: gaps_explicit requires concrete gaps")
            if unresolved:
                if (task.get("status") not in ("未开始", "进行中", "待验证", "阻塞")
                        or intake_passed or readiness != "gaps_explicit"):
                    err("intake.route: unresolved route requires unfinished intake/task and explicit gaps")
                text(route, "unresolved_reason", "intake.route")
            if (intake_passed or unresolved) and isinstance(handoff, dict) and route.get("next_action") != handoff.get("next_action"):
                err("intake.route.next_action: must agree with handoff for passed or unresolved intake")
        if task.get("status") == "通过":
            if not intake_passed:
                err("passed task selecting 00 requires passed intake criteria")
            later_stages = set(stages) - {"00"}
            if task.get("target_type") == "context" and later_stages:
                err("context-only intake pass cannot complete later stages")
            for stage in later_stages:
                if not any(c.get("stage") == stage and c.get("kind") != "intake"
                           and c.get("status") == "通过" for c in criteria.values()):
                    err(f"stage {stage}: intake pass cannot replace a later-stage criterion")
    elif "intake" in data or intake_criteria:
        err("intake metadata/criteria require selecting stage 00")
    if task.get("target_type") == "context" and "00" not in stages:
        err("context task requires selected stage 00")

    # Reverse traceability also checked in the other direction.
    for eid, item in evidence.items():
        refs = item.get("criterion_ids", [])
        if isinstance(refs, list):
            for cid in refs:
                if isinstance(cid, str) and cid in criteria:
                    ids = criteria[cid].get("evidence_ids", [])
                    if not isinstance(ids, list) or eid not in ids:
                        err(f"evidence[{eid}]: reverse link missing in criterion {cid}")

    if task.get("status") == "通过":
        if not active:
            err("passed task needs at least one applicable criterion")
        if any(item.get("status") != "通过" for item in active):
            err("passed task has applicable criteria not passed")
        if task.get("risk") == "high" and set(stages) & {"10", "11"}:
            recovery = data.get("recovery")
            if not isinstance(recovery, dict) or type(recovery.get("data_change")) is not bool:
                err("high-risk delivery requires recovery.data_change boolean and strategy")
            else:
                text(recovery, "strategy", "recovery")
                if recovery["data_change"]:
                    ids = recovery.get("restore_evidence_ids")
                    if not isinstance(ids, list) or not ids or any(not isinstance(x, str) for x in ids):
                        err("data-changing delivery requires restore_evidence_ids")
                    else:
                        for eid in ids:
                            ev = evidence.get(eid, {})
                            if (eid not in valid_evidence or ev.get("kind") != "execution" or
                                    ev.get("result") != "pass" or ev.get("purpose") != "restore"):
                                err(f"recovery: {eid} is not valid passed execution evidence for restore")
                            if not ev.get("criterion_ids"):
                                err(f"recovery: {eid} must trace to an acceptance criterion")
    return {"checker_version": VERSION, "record_consistent": not errors,
            "software_verified": False,
            "intake_claim_consistent": (intake_passed and not errors) if "00" in stages else None,
            "errors": errors, "warnings": warnings, "counts": counters}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", type=Path, help="JSON record path within root")
    parser.add_argument("--root", required=True, type=Path, help="trusted local evidence root")
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve(strict=True)
        if not root.is_dir():
            raise InputError("root must be a directory")
        record = args.record if args.record.is_absolute() else Path.cwd() / args.record
        result = validate_record(load_record(record, root), root)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["record_consistent"] else 1
    except (InputError, OSError, ValueError, RecursionError) as exc:
        print(json.dumps({"record_consistent": False, "software_verified": False,
                          "input_error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
