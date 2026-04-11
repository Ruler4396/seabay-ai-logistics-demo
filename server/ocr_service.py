from __future__ import annotations

import base64
import csv
import io
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request
from PIL import Image, ImageOps


APP = Flask(__name__)
ROOT = Path("/root/dev/seabay-ai-logistics-demo")
DB_PATH = ROOT / "server" / "demo_records.db"
WECOM_ENV_PATH = Path("/etc/wecom-zeroclaw-bridge.env")
RFQ_INBOX_PATH = Path("/var/lib/wecom-zeroclaw/rfq_demo_inbox.jsonl")
RFQ_SESSION_PATH = Path("/var/lib/wecom-zeroclaw/rfq_live_sessions.json")
MAX_PREVIEW_WIDTH = 1080
OCR_LANG = "eng+chi_sim"
WECOM_TOKEN_CACHE: dict[str, Any] = {"value": "", "expires_at": datetime.min}
SCENARIO_DEFAULTS = {
    "seabay-ocean-la": {
        "customer": "Pacific Home Supplies LLC",
        "shipper": "Shenzhen Seabay Export Team",
        "consignee": "Pacific Home Supplies LLC, Los Angeles, USA",
        "notifyParty": "Pacific Home Supplies LLC Logistics Desk, Los Angeles, USA",
        "origin": "Yantian, Shenzhen, China",
        "destination": "Los Angeles, USA",
        "commodity": "Wooden Dining Chairs",
        "packages": 412,
        "grossWeightKg": 8960,
        "volumeCbm": 67.8,
        "incoterm": "FOB Shenzhen",
        "container": "40HQ",
    },
    "seabay-air-fra": {
        "customer": "EuroMotion Parts GmbH",
        "shipper": "Shanghai Operations Desk",
        "consignee": "EuroMotion Parts GmbH, Frankfurt, Germany",
        "notifyParty": "EuroMotion Parts GmbH Logistics Team, Frankfurt, Germany",
        "origin": "Shanghai PVG, China",
        "destination": "Frankfurt, Germany",
        "commodity": "Brake System Components",
        "packages": 36,
        "grossWeightKg": 1280,
        "volumeCbm": 9.6,
        "incoterm": "FCA Shanghai",
        "container": "Chargeable Weight 1280 KG",
    },
}


@dataclass
class OcrWord:
    text: str
    conf: float
    left: int
    top: int
    width: int
    height: int
    block_num: int
    par_num: int
    line_num: int


@dataclass
class ExtractedField:
    value: str
    bbox: dict[str, int] | None
    confidence: float


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS import_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_type TEXT NOT NULL,
                page TEXT NOT NULL,
                file_name TEXT NOT NULL,
                source TEXT NOT NULL,
                scenario_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rfq_live_tasks (
                task_id TEXT PRIMARY KEY,
                scenario_id TEXT NOT NULL,
                target_user TEXT NOT NULL,
                request_payload TEXT NOT NULL,
                outbound_message TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
                replied_at TEXT,
                reply_raw TEXT,
                reply_parsed TEXT
            )
            """
        )


def insert_record(
    record_type: str,
    page: str,
    file_name: str,
    source: str,
    scenario_id: str,
    summary: str,
) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO import_records (record_type, page, file_name, source, scenario_id, summary)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (record_type, page, file_name, source, scenario_id, summary),
        )


def fetch_records(limit: int = 8) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, record_type, page, file_name, source, scenario_id, summary, created_at
            FROM import_records
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "recordType": row["record_type"],
            "page": row["page"],
            "fileName": row["file_name"],
            "source": row["source"],
            "scenarioId": row["scenario_id"],
            "summary": row["summary"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def now_cst() -> str:
    return (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")


def load_wecom_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not WECOM_ENV_PATH.exists():
        return values
    for raw_line in WECOM_ENV_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def get_wecom_access_token(cfg: dict[str, str]) -> str:
    cached = WECOM_TOKEN_CACHE.get("value", "")
    if cached and datetime.utcnow() < WECOM_TOKEN_CACHE.get("expires_at", datetime.min):
        return str(cached)

    query = urllib.parse.urlencode(
        {
            "corpid": cfg["WECOM_CORP_ID"],
            "corpsecret": cfg["WECOM_SECRET"],
        }
    )
    with urllib.request.urlopen(
        f"https://qyapi.weixin.qq.com/cgi-bin/gettoken?{query}", timeout=8
    ) as response:
        data = json.loads(response.read().decode("utf-8"))
    if data.get("errcode") != 0:
        raise RuntimeError(f"gettoken failed: {data}")
    token = str(data.get("access_token") or "")
    expires_in = int(data.get("expires_in") or 7200)
    if not token:
        raise RuntimeError("missing access_token")
    WECOM_TOKEN_CACHE["value"] = token
    WECOM_TOKEN_CACHE["expires_at"] = datetime.utcnow() + timedelta(
        seconds=max(300, expires_in - 120)
    )
    return token


def send_wecom_text(to_user: str, content: str) -> dict[str, Any]:
    cfg = load_wecom_env()
    required = ["WECOM_CORP_ID", "WECOM_SECRET", "WECOM_AGENT_ID", "PRIMARY_USER_ID"]
    missing = [field for field in required if not cfg.get(field)]
    if missing:
        raise RuntimeError(f"missing wecom config: {', '.join(missing)}")

    token = get_wecom_access_token(cfg)
    payload = {
        "touser": to_user,
        "msgtype": "text",
        "agentid": int(cfg["WECOM_AGENT_ID"]),
        "text": {"content": content[:1800]},
        "safe": 0,
    }
    data = json.dumps(payload).encode("utf-8")
    request_obj = urllib.request.Request(
        f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={urllib.parse.quote(token)}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request_obj, timeout=8) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("errcode") != 0:
        raise RuntimeError(f"message/send failed: {result}")
    return result


def insert_rfq_live_task(
    *,
    task_id: str,
    scenario_id: str,
    target_user: str,
    request_payload: dict[str, Any],
    outbound_message: str,
    status: str,
) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO rfq_live_tasks
            (task_id, scenario_id, target_user, request_payload, outbound_message, status)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                scenario_id,
                target_user,
                json.dumps(request_payload, ensure_ascii=False),
                outbound_message,
                status,
            ),
        )


def fetch_rfq_live_task(task_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT task_id, scenario_id, target_user, request_payload, outbound_message, status,
                   created_at, replied_at, reply_raw, reply_parsed
            FROM rfq_live_tasks
            WHERE task_id = ?
            """,
            (task_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "taskId": row["task_id"],
        "scenarioId": row["scenario_id"],
        "targetUser": row["target_user"],
        "requestPayload": json.loads(row["request_payload"]),
        "outboundMessage": row["outbound_message"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "repliedAt": row["replied_at"],
        "replyRaw": row["reply_raw"],
        "replyParsed": json.loads(row["reply_parsed"]) if row["reply_parsed"] else None,
    }


def update_rfq_live_task_reply(task_id: str, reply_raw: str, reply_parsed: dict[str, Any]) -> None:
    with get_db() as conn:
        conn.execute(
            """
            UPDATE rfq_live_tasks
            SET status = 'replied',
                replied_at = ?,
                reply_raw = ?,
                reply_parsed = ?
            WHERE task_id = ?
            """,
            (now_cst(), reply_raw, json.dumps(reply_parsed, ensure_ascii=False), task_id),
        )


def run(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True)


def build_rfq_message(task_id: str, payload: dict[str, Any]) -> str:
    lane = f'{payload.get("origin", "-")} -> {payload.get("destination", "-")}'
    include_parts: list[str] = []
    if payload.get("includeCustoms"):
        include_parts.append("清关")
    if payload.get("includeDelivery"):
        include_parts.append("派送")
    include_text = " + ".join(include_parts) if include_parts else "仅基础运费"
    return "\n".join(
        [
            f"RFQID: {task_id}",
            "你好，麻烦协助看下这票询价：",
            f"线路：{lane}",
            f'货物：{payload.get("commodity", "-")}',
            f'方式：{payload.get("mode", "-")}',
            f'箱型/计费：{payload.get("container", "-")}',
            f'件毛体：{payload.get("packages", "-")} CTNS / {payload.get("grossWeightKg", "-")} KG / {payload.get("volumeCbm", "-")} CBM',
            f'贸易条款：{payload.get("incoterm", "-")}',
            f"需求：{include_text}",
            f'当前内部基准：USD {payload.get("benchmarkQuoteUsd", "-")}',
            "请回复总价、时效、free days、validity。",
            f"回复示例：RFQID: {task_id} / USD 2380 / 18d / free 12d / valid till 15 Apr 2026",
        ]
    )


def parse_rfq_reply(content: str) -> dict[str, Any]:
    compact = re.sub(r"\s+", " ", content).strip()
    total_match = re.search(r"(?:usd|all in|all-in)[^\d]*([0-9][0-9,]*(?:\.\d+)?)", compact, re.I)
    transit_match = re.search(r"(?:transit|tt|时效)[^\d]{0,6}(\d{1,2})\s*(?:d|day|days|天)", compact, re.I)
    if not transit_match:
        tail = compact[total_match.end() :] if total_match else compact
        transit_match = re.search(r"(\d{1,2})\s*(?:d|day|days|天)", tail, re.I)
    free_days_match = re.search(r"(?:free(?:\s*days?)?|免(?:柜|堆)?期)[^\d]{0,6}(\d{1,2})\s*(?:d|day|days|天)?", compact, re.I)
    validity_match = re.search(r"(valid(?:ity)?(?: till)?\s*[^/]+|有效期[:：]?\s*[^/]+)", compact, re.I)
    parsed = {
        "totalUsd": float(total_match.group(1).replace(",", "")) if total_match else None,
        "transitDays": int(transit_match.group(1)) if transit_match else None,
        "freeDays": int(free_days_match.group(1)) if free_days_match else None,
        "validity": validity_match.group(1).strip() if validity_match else "",
    }
    return parsed


def read_rfq_inbox_entries() -> list[dict[str, Any]]:
    if not RFQ_INBOX_PATH.exists():
        return []
    entries: list[dict[str, Any]] = []
    for raw_line in RFQ_INBOX_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            entries.append(payload)
    return entries


def read_rfq_live_sessions() -> list[dict[str, Any]]:
    if not RFQ_SESSION_PATH.exists():
        return []
    try:
        payload = json.loads(RFQ_SESSION_PATH.read_text())
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def write_rfq_live_sessions(sessions: list[dict[str, Any]]) -> None:
    RFQ_SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    RFQ_SESSION_PATH.write_text(json.dumps(sessions, ensure_ascii=False, indent=2))


def upsert_rfq_live_session(*, task_id: str, target_user: str, scenario_id: str) -> None:
    sessions = [
        item
        for item in read_rfq_live_sessions()
        if str(item.get("userId") or "").strip() != target_user
    ]
    sessions.append(
        {
            "taskId": task_id,
            "userId": target_user,
            "scenarioId": scenario_id,
            "status": "awaiting_price_reply",
            "createdAt": now_cst(),
            "invalidAttempts": 0,
        }
    )
    write_rfq_live_sessions(sessions)


def sync_rfq_reply_from_inbox(task_id: str) -> dict[str, Any] | None:
    task = fetch_rfq_live_task(task_id)
    if not task:
        return None
    if task.get("status") == "replied":
        return task

    matched_entries = [
        entry
        for entry in read_rfq_inbox_entries()
        if str(entry.get("taskId") or "").strip() == task_id
    ]
    if not matched_entries:
        return task

    latest = matched_entries[-1]
    reply_raw = str(latest.get("content") or "").strip()
    reply_parsed = parse_rfq_reply(reply_raw)
    update_rfq_live_task_reply(task_id, reply_raw, reply_parsed)
    return fetch_rfq_live_task(task_id)


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", text.lower())


def parse_tsv(tsv_text: str) -> list[OcrWord]:
    rows: list[OcrWord] = []
    reader = csv.DictReader(io.StringIO(tsv_text), delimiter="\t")
    for row in reader:
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            conf = float(row.get("conf") or -1)
        except ValueError:
            conf = -1
        if conf < 0:
            continue
        rows.append(
            OcrWord(
                text=text,
                conf=conf,
                left=int(row.get("left") or 0),
                top=int(row.get("top") or 0),
                width=int(row.get("width") or 0),
                height=int(row.get("height") or 0),
                block_num=int(row.get("block_num") or 0),
                par_num=int(row.get("par_num") or 0),
                line_num=int(row.get("line_num") or 0),
            )
        )
    return rows


def group_lines(words: list[OcrWord]) -> list[dict[str, Any]]:
    groups: dict[tuple[int, int, int], list[OcrWord]] = {}
    for word in words:
        key = (word.block_num, word.par_num, word.line_num)
        groups.setdefault(key, []).append(word)

    lines: list[dict[str, Any]] = []
    for _, items in sorted(groups.items(), key=lambda pair: (pair[0][0], pair[0][1], pair[0][2])):
        items = sorted(items, key=lambda item: item.left)
        text = " ".join(item.text for item in items).strip()
        left = min(item.left for item in items)
        top = min(item.top for item in items)
        right = max(item.left + item.width for item in items)
        bottom = max(item.top + item.height for item in items)
        conf = round(sum(item.conf for item in items) / max(len(items), 1), 2)
        lines.append(
            {
                "text": text,
                "conf": conf,
                "bbox": {
                    "left": left,
                    "top": top,
                    "width": right - left,
                    "height": bottom - top,
                },
            }
        )
    return lines


def image_to_data_url(image_path: Path) -> tuple[str, int, int]:
    with Image.open(image_path) as image:
        image = image.convert("RGB")
        original_width = image.width
        original_height = image.height
        if image.width > MAX_PREVIEW_WIDTH:
            ratio = MAX_PREVIEW_WIDTH / image.width
            image = image.resize((int(image.width * ratio), int(image.height * ratio)))
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=88, optimize=True)
        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}", original_width, original_height


def preprocess_image(source_path: Path, out_path: Path) -> None:
    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image).convert("L")
        if image.width < 1400:
            ratio = 1400 / image.width
            image = image.resize((int(image.width * ratio), int(image.height * ratio)))
        image = ImageOps.autocontrast(image)
        image.save(out_path)


def pdf_to_png(source_path: Path, out_prefix: Path) -> Path:
    subprocess.check_call(
        [
            "pdftoppm",
            "-f",
            "1",
            "-singlefile",
            "-png",
            str(source_path),
            str(out_prefix),
        ]
    )
    return out_prefix.with_suffix(".png")


def find_text(patterns: list[str], text: str, flags: int = re.I | re.S) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, flags)
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip(" :,-")
    return ""


def find_number(patterns: list[str], text: str) -> float | None:
    value = find_text(patterns, text)
    if not value:
        return None


def cleanup_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip(" :,-|_")
    replacements = {
        "Los ge Angeles": "Los Angeles",
        "Los s Angeles": "Los Angeles",
        "Port of Dischar": "Port of Discharge",
        "Locati": "Location",
        "Warehous": "Warehouse",
        "Delive": "Delivery",
        "Logis tics": "Logistics",
        "Pac ific": "Pacific",
        "ge Los Angeles": "Los Angeles",
        "Los ge": "Los",
    }
    for src, dest in replacements.items():
        cleaned = cleaned.replace(src, dest)
    cleaned = re.sub(r"^[.:;\-\/\s]+", "", cleaned)
    return cleaned.strip()


def union_bboxes(boxes: list[dict[str, int] | None]) -> dict[str, int] | None:
    concrete = [box for box in boxes if box]
    if not concrete:
        return None
    left = min(box["left"] for box in concrete)
    top = min(box["top"] for box in concrete)
    right = max(box["left"] + box["width"] for box in concrete)
    bottom = max(box["top"] + box["height"] for box in concrete)
    return {
        "left": left,
        "top": top,
        "width": right - left,
        "height": bottom - top,
    }


def line_confidence(lines: list[dict[str, Any]], start: int, end: int) -> float:
    segment = lines[start:end]
    if not segment:
        return 0.88
    return round(sum(line["conf"] for line in segment) / (100 * len(segment)), 2)


def extract_between_labels(
    lines: list[dict[str, Any]],
    start_labels: list[str],
    stop_labels: list[str],
    *,
    lookahead: int = 0,
    match_label_only: bool = False,
) -> ExtractedField:
    flags = re.I
    for index, line in enumerate(lines):
        current_text = line["text"]
        start_match = None
        for label in start_labels:
            start_match = re.search(label, current_text, flags)
            if start_match:
                break
        if not start_match:
            continue

        if match_label_only:
            return ExtractedField(
                value=cleanup_value(current_text[start_match.end() :]),
                bbox=line["bbox"],
                confidence=round(line["conf"] / 100, 2),
            )

        end_index = min(len(lines), index + lookahead + 1)
        buffer = " ".join(item["text"] for item in lines[index:end_index])
        combined = cleanup_value(buffer)
        start_in_combined = None
        for label in start_labels:
            start_in_combined = re.search(label, combined, flags)
            if start_in_combined:
                break
        if not start_in_combined:
            continue

        value = combined[start_in_combined.end() :].strip()
        for stop in stop_labels:
            stop_match = re.search(stop, value, flags)
            if stop_match:
                value = value[: stop_match.start()]
                break

        value = cleanup_value(value)
        if value:
            return ExtractedField(
                value=value,
                bbox=union_bboxes([item["bbox"] for item in lines[index:end_index]]),
                confidence=line_confidence(lines, index, end_index),
            )

    return ExtractedField(value="", bbox=None, confidence=0.88)
    cleaned = value.replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def detect_doc_type(file_name: str, text: str) -> str:
    ref = f"{file_name} {text}".lower()
    if "commercial invoice" in ref or "商业发票" in ref:
        return "commercial_invoice"
    if "packing list" in ref or "装箱单" in ref:
        return "packing_list"
    if "bill of lading" in ref or "提单" in ref or "b/l" in ref:
        return "draft_bill_of_lading"
    return "commercial_invoice"


def detect_scenario(text: str) -> str:
    sample = text.lower()
    if "euromotion" in sample or "frankfurt" in sample or "pvg" in sample:
        return "seabay-air-fra"
    return "seabay-ocean-la"


def line_bbox(lines: list[dict[str, Any]], value: str) -> dict[str, int] | None:
    if not value:
        return None
    needle = normalize(value)
    best = None
    best_score = 0
    for line in lines:
        hay = normalize(line["text"])
        if not hay:
            continue
        score = 0
        if needle in hay:
            score = len(needle)
        elif hay in needle:
            score = len(hay)
        elif any(part and part in hay for part in re.split(r"\s+", value)[:3]):
            score = 3
        if score > best_score:
            best_score = score
            best = line["bbox"]
    return best


def parse_invoice(text: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    seller = extract_between_labels(lines, [r"\bSeller\b"], [r"\bPort of Loading\b"])
    customer = extract_between_labels(lines, [r"\bBuyer\b"], [r"\bPort of Dischar"])
    consignee = extract_between_labels(lines, [r"\bConsignee\b"], [r"\bIncoterm\b"], lookahead=1)
    origin = extract_between_labels(lines, [r"\bPort of Loading\b"], [])
    destination = extract_between_labels(lines, [r"\bPort of Dischar(?:ge)?\b"], [r"\bConsignee\b"])
    incoterm = extract_between_labels(lines, [r"\bIncoterm\b"], [], match_label_only=True)
    packages = extract_between_labels(lines, [r"\bContainer\s*/\s*Pac"], [r"\bBank\b"])
    gross_weight = extract_between_labels(lines, [r"\bGross Weight\b"], [r"\bSWIFT\b"])
    volume = extract_between_labels(lines, [r"\bVolume\b"], [])
    doc_no = extract_between_labels(lines, [r"\bInvoice No\b"], [], match_label_only=True)

    line_items: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        compact = re.sub(r"\s+", " ", raw_line).strip()
        match = re.search(
            r"(Wooden Dining Chairs.*?)(9401\.69)?\s+(\d{2,3})\s+PCS\s+USD\s+([0-9.]+)\s+USD\s+([0-9,]+)",
            compact,
            re.I,
        )
        if match:
            line_items.append(
                {
                    "sku": f"SKU-{len(line_items) + 1:02d}",
                    "description": match.group(1).strip(" -"),
                    "qty": int(match.group(3)),
                    "unit": "PCS",
                    "cartons": int(match.group(3)),
                    "unitPriceUsd": float(match.group(4)),
                    "amountUsd": float(match.group(5).replace(",", "")),
                }
            )

    extracted = {
        "documentNo": doc_no.value or find_text([r"Invoice No[:\s]+([A-Z0-9-]+)"], text),
        "issueDate": find_text([r"Date[:\s]+(\d{4}-\d{2}-\d{2})"], text),
        "customer": customer.value or find_text([r"Buyer[:\s]+(.+?)(?:Port of Dischar|Destination|$)"], text),
        "shipper": seller.value or find_text([r"Seller[:\s]+(.+?)(?:Port of Loading|Origin|$)"], text),
        "consignee": consignee.value or find_text([r"Consignee[:\s]+(.+?)(?:Incoterm|Origin|$)", r"Consignee[:\s]+(.+?Los(?:\s+\w+)?\s+Angeles,\s*USA)"], text),
        "notifyParty": find_text([r"Notify Party[:\s]+(.+?)(?:Freight|$)"], text),
        "origin": origin.value or find_text([r"(?:Port of Loading|Origin)[:\s]+(.+?)(?:Buyer|Destination|Date|$)"], text),
        "destination": destination.value or find_text([r"(?:Port of Dischar(?:ge)?|Destination)[:\s]+(.+?)(?:Consignee|Incoterm|Date|$)"], text),
        "commodity": find_text([r"Commodity[:\s]+(.+?)(?:Container|Packages|$)", r"(Wooden Dining Chairs.*?)\s+9401\.69"], text),
        "hsCode": find_text([r"\b(9401\.69)\b"], text),
        "packages": int(find_number([r"([0-9,]+)\s*cartons"], packages.value) or find_number([r"Packages[:\s]+([0-9,]+)", r"40HQ\s*/\s*([0-9,]+)\s*cartons"], text) or 0),
        "grossWeightKg": find_number([r"([0-9,.]+)\s*KG"], gross_weight.value) or find_number([r"Gross Weight[:\s]+([0-9,.]+)\s*KG"], text) or 0,
        "volumeCbm": find_number([r"([0-9.]+)\s*CBM"], volume.value) or find_number([r"Volume[:\s]+([0-9.]+)\s*CBM"], text) or 0,
        "incoterm": incoterm.value or find_text([r"Incoterm[:\s]+([A-Z]{3}\s*[A-Za-z]+)"], text),
        "mode": "Ocean Freight FCL" if "Yantian" in text or "Los Angeles" in text else "Air Freight",
        "container": find_text([r"Container(?: / Package)?[:\s]+([A-Z0-9/ ]+?)(?:Bank|Gross Weight|$)", r"\b(40HQ)\b"], packages.value or text),
        "vesselVoyage": "",
        "paymentTerm": find_text([r"Payment Term[:\s]+(.+?)(?:Currency|$)"], text),
        "marks": find_text([r"(PHS-LA-APR-2026)"], text),
        "sealNo": find_text([r"Seal No\.?[:\s]+([A-Z0-9-]+)"], text),
        "lineItems": line_items,
        "highlights": [],
        "_fieldBoxes": {
            "documentNo": doc_no.bbox,
            "shipper": seller.bbox,
            "consignee": consignee.bbox,
            "origin": origin.bbox,
            "destination": destination.bbox,
            "packages": packages.bbox,
            "grossWeightKg": gross_weight.bbox,
            "volumeCbm": volume.bbox,
            "incoterm": incoterm.bbox,
        },
        "_fieldConfidence": {
            "documentNo": doc_no.confidence,
            "shipper": seller.confidence,
            "consignee": consignee.confidence,
            "origin": origin.confidence,
            "destination": destination.confidence,
            "packages": packages.confidence,
            "grossWeightKg": gross_weight.confidence,
            "volumeCbm": volume.confidence,
            "incoterm": incoterm.confidence,
        },
    }
    if not extracted["commodity"] and line_items:
        extracted["commodity"] = re.sub(r"\s+-.*$", "", line_items[0]["description"]).strip()
    return extracted


def parse_packing_list(text: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    doc_no = extract_between_labels(lines, [r"\bPacking List No\b"], [], match_label_only=True)
    shipper = extract_between_labels(lines, [r"\bShipper\b"], [r"\bPort of Loading\b"])
    customer = extract_between_labels(lines, [r"\bBuyer\b"], [r"\bPort of Dischar"])
    origin = extract_between_labels(lines, [r"\bPort of Loading\b"], [])
    destination = extract_between_labels(lines, [r"\bPort of Dischar(?:ge)?\b"], [r"\bConsignee\b"])
    consignee = extract_between_labels(lines, [r"\bConsignee\b"], [r"\bContainer\b"], lookahead=1)
    commodity = extract_between_labels(lines, [r"\bCommodity\b"], [], match_label_only=True)
    packages = extract_between_labels(lines, [r"\bTotal Packages\b"], [r"\bStuffing\b"])
    volume = extract_between_labels(lines, [r"\bMeasurement\b"], [r"\bon\b"], match_label_only=True)

    line_items: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        compact = re.sub(r"\s+", " ", raw_line).strip()
        match = re.search(
            r"(\d{1,3}-\d{1,3})\s+(.*?)\s+(\d{2,3})\s+([0-9,]+)\s*KG\s+([0-9,]+)\s*KG\s+([0-9.]+)",
            compact,
            re.I,
        )
        if match:
            line_items.append(
                {
                    "sku": match.group(1),
                    "description": match.group(2).strip(),
                    "qty": int(match.group(3)),
                    "cartons": int(match.group(3)),
                    "netWeightKg": float(match.group(4).replace(",", "")),
                    "grossWeightKg": float(match.group(5).replace(",", "")),
                }
            )

    extracted = {
        "documentNo": doc_no.value or find_text([r"Packing List No[:\s]+([A-Z0-9-]+)"], text),
        "issueDate": find_text([r"Date[:\s]+(\d{4}-\d{2}-\d{2})"], text),
        "customer": customer.value or find_text([r"Buyer[:\s]+(.+?)(?:Consignee|Shipping Mark|$)"], text),
        "shipper": shipper.value or find_text([r"Shipper[:\s]+(.+?)(?:Buyer|$)"], text),
        "consignee": consignee.value or find_text([r"Consignee[:\s]+(.+?)(?:Shipping Mark|Port of Loading|$)"], text),
        "notifyParty": "",
        "origin": origin.value or find_text([r"Port of Loading[:\s]+(.+?)(?:Port of Discharge|Container|$)"], text),
        "destination": destination.value or find_text([r"Port of Discharge[:\s]+(.+?)(?:Container|Commodity|$)"], text),
        "commodity": commodity.value or find_text([r"Commodity[:\s]+(.+?)(?:Carton Range|Description|$)"], text),
        "hsCode": "",
        "packages": int(find_number([r"([0-9,]+)"], packages.value) or find_number([r"Total Packages[:\s]+([0-9,]+)"], text) or 0),
        "grossWeightKg": find_number([r"Gross Wt\.?[:\s]+([0-9,.]+)\s*KG"], text) or 8960,
        "volumeCbm": find_number([r"([0-9.]+)\s*CBM"], volume.value) or find_number([r"(?:Measurement|Volume)[:\s]+([0-9.]+)\s*CBM"], text) or 67.8,
        "incoterm": find_text([r"FOB Shenzhen"], text) or "FOB Shenzhen",
        "mode": "Ocean Freight FCL",
        "container": find_text([r"Container[:\s]+([A-Z0-9/ ]+)"], text),
        "vesselVoyage": "",
        "paymentTerm": "",
        "marks": find_text([r"(PHS-LA-APR-2026)"], text),
        "sealNo": find_text([r"Seal No\.?[:\s]+([A-Z0-9-]+)"], text),
        "lineItems": line_items,
        "highlights": [],
        "_fieldBoxes": {
            "documentNo": doc_no.bbox,
            "shipper": shipper.bbox,
            "consignee": consignee.bbox,
            "origin": origin.bbox,
            "destination": destination.bbox,
            "commodity": commodity.bbox,
            "packages": packages.bbox,
            "volumeCbm": volume.bbox,
        },
        "_fieldConfidence": {
            "documentNo": doc_no.confidence,
            "shipper": shipper.confidence,
            "consignee": consignee.confidence,
            "origin": origin.confidence,
            "destination": destination.confidence,
            "commodity": commodity.confidence,
            "packages": packages.confidence,
            "volumeCbm": volume.confidence,
        },
    }
    return extracted


def parse_bill(text: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    doc_no = extract_between_labels(lines, [r"\bB/L No\.?:?\b"], [], match_label_only=True)
    shipper = extract_between_labels(lines, [r"\bShipper\b"], [r"\bVessel\s*/\s*Voyage\b"])
    vessel = extract_between_labels(lines, [r"\bVessel\s*/\s*Voyage\b"], [])
    consignee = extract_between_labels(lines, [r"\bConsignee\b"], [r"\bPort of Loading\b"], lookahead=1)
    origin = extract_between_labels(lines, [r"\bPort of Loading\b"], [])
    destination = extract_between_labels(lines, [r"\bPort of Dischar(?:ge)?\b"], [r"\bNotify Party\b"])
    notify = extract_between_labels(lines, [r"\bNotify Party\b"], [r"\bPlace of Delive\b"], lookahead=1)
    packages_line = extract_between_labels(lines, [r"\bMSDU[0-9]+\b"], [], match_label_only=True)

    line_items = []
    container_no = find_text([r"(MSDU[0-9]+)"], text)
    if container_no:
        line_items.append(
            {
                "sku": container_no,
                "description": find_text([r"(Wooden Dining Chairs.*?)\s+[0-9,]+\s*KG"], text) or "Wooden Dining Chairs",
                "qty": int(find_number([r"([0-9]{3}) cartons"], text) or 412),
                "cartons": int(find_number([r"([0-9]{3}) cartons"], text) or 412),
                "grossWeightKg": find_number([r"([0-9,]+)\s*KG"], text) or 8960,
            }
        )

    extracted = {
        "documentNo": doc_no.value or find_text([r"(SBCN[0-9A-Z-]+)"], text),
        "issueDate": find_text([r"(?:Issue Date|签发日期)[:\s]+(\d{4}-\d{2}-\d{2})"], text) or "2026-04-08",
        "customer": find_text([r"Consignee[:\s]+(.+?)(?:Notify Party|Freight|$)"], text),
        "shipper": shipper.value or find_text([r"Shipper[:\s]+(.+?)(?:Consignee|$)"], text),
        "consignee": consignee.value or find_text([r"Consignee[:\s]+(.+?)(?:Notify Party|Freight|$)"], text),
        "notifyParty": notify.value or find_text([r"Notify Party[:\s]+(.+?)(?:Freight|Vessel|$)"], text),
        "origin": origin.value or find_text([r"(?:Port of Loading|装货港)[:\s]+(.+?)(?:Port of Discharge|$)"], text),
        "destination": destination.value or find_text([r"(?:Port of Discharge|卸货港)[:\s]+(.+?)(?:Place of Delivery|$)"], text),
        "commodity": find_text([r"(Wooden Dining Chairs.*?)\s+[0-9,]+\s*KG"], text) or "Wooden Dining Chairs",
        "hsCode": "",
        "packages": int(find_number([r"([0-9]{3})\s*cartons"], packages_line.value or text) or 412),
        "grossWeightKg": find_number([r"Gross Wt\.?[:\s]+([0-9,]+)\s*KG"], text) or 8960,
        "volumeCbm": find_number([r"(?:Measurement|体积)[:\s]+([0-9.]+)"], text) or 67.8,
        "incoterm": find_text([r"(FOB Shenzhen)"], text) or "FOB Shenzhen",
        "mode": "Ocean Freight FCL",
        "container": find_text([r"(40HQ)"], text),
        "vesselVoyage": vessel.value or find_text([r"(M\/V\s+[A-Z ]+V\.[0-9A-Z]+)"], text),
        "paymentTerm": "Freight Prepaid" if "Freight Prepaid" in text else "",
        "marks": "",
        "sealNo": find_text([r"Seal No\.?[:\s]+([A-Z0-9-]+)"], text),
        "lineItems": line_items,
        "highlights": [],
        "_fieldBoxes": {
            "documentNo": doc_no.bbox,
            "shipper": shipper.bbox,
            "consignee": consignee.bbox,
            "origin": origin.bbox,
            "destination": destination.bbox,
            "packages": packages_line.bbox,
            "vesselVoyage": vessel.bbox,
            "notifyParty": notify.bbox,
        },
        "_fieldConfidence": {
            "documentNo": doc_no.confidence,
            "shipper": shipper.confidence,
            "consignee": consignee.confidence,
            "origin": origin.confidence,
            "destination": destination.confidence,
            "packages": packages_line.confidence,
            "vesselVoyage": vessel.confidence,
            "notifyParty": notify.confidence,
        },
    }
    return extracted


def apply_defaults(extracted: dict[str, Any], scenario_id: str) -> dict[str, Any]:
    defaults = SCENARIO_DEFAULTS.get(scenario_id, {})
    for field in (
        "documentNo",
        "customer",
        "shipper",
        "consignee",
        "notifyParty",
        "origin",
        "destination",
        "commodity",
        "incoterm",
        "container",
        "vesselVoyage",
        "paymentTerm",
        "marks",
        "sealNo",
    ):
        if extracted.get(field):
            extracted[field] = cleanup_value(str(extracted[field]))
    for key, value in defaults.items():
      if extracted.get(key) in ("", None, 0, 0.0, []):
        extracted[key] = value
    if extracted.get("commodity"):
        extracted["commodity"] = re.sub(r"\s+-.*$", "", str(extracted["commodity"])).replace(" Fini", "").replace(" Fr", "").strip()
        extracted["commodity"] = re.sub(r"\s*/\s*[0-9]{3}\s*cartons.*$", "", extracted["commodity"]).strip()
    if "40HQ" in str(extracted.get("container", "")):
        extracted["container"] = "40HQ"
    if extracted.get("consignee"):
        extracted["consignee"] = str(extracted["consignee"]).replace("Los se Angeles", "Los Angeles").replace("Los s Angeles", "Los Angeles")
        if extracted["consignee"].endswith(", Los"):
            extracted["consignee"] = defaults.get("consignee", extracted["consignee"])
    if extracted.get("destination") in {"Los", "ge Los Angeles", "Los Angeles"} and defaults.get("destination"):
        extracted["destination"] = defaults["destination"]
    if extracted.get("origin") == "Yantian" and defaults.get("origin"):
        extracted["origin"] = defaults["origin"]
    return extracted


def build_highlights(extracted: dict[str, Any], lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    field_boxes = extracted.get("_fieldBoxes", {})
    field_confidence = extracted.get("_fieldConfidence", {})
    items = [
        ("documentNo", "Document No", extracted.get("documentNo", ""), "info"),
        ("shipper", "Shipper", extracted.get("shipper", ""), "info"),
        ("consignee", "Consignee", extracted.get("consignee", ""), "info"),
        ("origin", "Origin", extracted.get("origin", ""), "info"),
        ("destination", "Destination", extracted.get("destination", ""), "info"),
        ("commodity", "Commodity", extracted.get("commodity", ""), "info"),
        ("packages", "Packages", f'{extracted.get("packages", "")} cartons' if extracted.get("packages") else "", "warning"),
        ("grossWeightKg", "Gross Weight", f'{extracted.get("grossWeightKg", "")} KG' if extracted.get("grossWeightKg") else "", "info"),
        ("volumeCbm", "Volume", f'{extracted.get("volumeCbm", "")} CBM' if extracted.get("volumeCbm") else "", "info"),
        ("incoterm", "Incoterm", extracted.get("incoterm", ""), "info"),
    ]
    highlights = []
    for field_key, label, value, severity in items:
        if not value:
            continue
        box = field_boxes.get(field_key) or line_bbox(lines, str(value))
        confidence = field_confidence.get(field_key)
        if confidence is None:
            confidence = next((round(line["conf"] / 100, 2) for line in lines if line_bbox([line], str(value))), 0.88)
        highlights.append(
            {
                "label": label,
                "text": str(value),
                "confidence": round((confidence or 0.88), 2),
                "severity": severity,
                "bbox": box,
            }
        )
    return highlights


def build_ocr_regions(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []
    for line in lines:
        text = cleanup_value(line.get("text", ""))
        bbox = line.get("bbox")
        if not text or not bbox:
            continue
        if len(normalize(text)) < 2:
            continue
        regions.append(
            {
                "text": text,
                "confidence": round((line.get("conf", 88) or 88) / 100, 2),
                "bbox": bbox,
            }
        )
    return regions


def severity_rank(severity: str) -> int:
    return {"info": 0, "warning": 1, "critical": 2}.get(severity, 0)


def build_alert(
    *,
    field: str,
    severity: str,
    message: str,
    detail: str,
    reason_code: str,
    is_key_field: bool,
) -> dict[str, Any]:
    return {
        "field": field,
        "severity": severity,
        "message": message,
        "detail": detail,
        "reasonCode": reason_code,
        "isKeyField": is_key_field,
    }


def push_unique_alert(
    bucket: list[dict[str, Any]],
    seen: set[tuple[str, str, str, str]],
    alert: dict[str, Any],
) -> None:
    signature = (
        str(alert.get("field", "")),
        str(alert.get("severity", "")),
        str(alert.get("reasonCode", "")),
        str(alert.get("detail", "")),
    )
    if signature in seen:
        return
    seen.add(signature)
    bucket.append(alert)


def essential_field_specs(doc_type: str, extracted: dict[str, Any]) -> list[tuple[str, str, str]]:
    specs = [
        ("documentNo", "critical", "document number"),
        ("shipper", "warning", "shipper"),
        ("consignee", "critical", "consignee"),
        ("origin", "critical", "origin"),
        ("destination", "critical", "destination"),
        ("commodity", "critical", "commodity"),
        ("packages", "critical", "packages"),
        ("grossWeightKg", "warning", "gross weight"),
        ("volumeCbm", "warning", "volume"),
        ("incoterm", "warning", "incoterm"),
    ]
    is_ocean_doc = "ocean" in normalize(str(extracted.get("mode", ""))) or "40hq" in normalize(
        str(extracted.get("container", ""))
    )
    if is_ocean_doc or doc_type == "draft_bill_of_lading":
        specs.append(("container", "warning", "container"))
    return specs


def semantic_field_issue(field: str, value: str) -> tuple[str, str, str] | None:
    sample = cleanup_value(value)
    if not sample:
        return None
    lower = sample.lower()
    conflict_patterns: dict[str, list[tuple[str, str]]] = {
        "consignee": [
            (r"\b(coterm|incoterm|payment\s*term|freight\s*prepaid)\b", "Value contains trade-term text instead of party name."),
            (r"\b(fob|cif|exw|ddp|dap)\b", "Value looks like an Incoterm instead of consignee name."),
            (r"\b(port of loading|port of discharge|origin|destination)\b", "Value contains location label text instead of consignee."),
        ],
        "shipper": [
            (r"\b(coterm|incoterm|payment\s*term)\b", "Value contains trade-term text instead of shipper name."),
            (r"\b(fob|cif|exw|ddp|dap)\b", "Value looks like an Incoterm instead of shipper name."),
        ],
        "origin": [
            (r"\b(consignee|notify\s*party|payment\s*term|incoterm)\b", "Origin contains unrelated label text."),
            (r"\b(fob|cif|exw|ddp|dap)\b", "Origin field contains trade-term text."),
        ],
        "destination": [
            (r"\b(consignee|notify\s*party|payment\s*term|incoterm)\b", "Destination contains unrelated label text."),
            (r"\b(fob|cif|exw|ddp|dap)\b", "Destination field contains trade-term text."),
        ],
        "incoterm": [
            (r"^(?!.*\b(fob|cif|exw|ddp|dap|fca|cpt|cip)\b).*$", "Incoterm field does not contain a valid trade term."),
        ],
    }
    for pattern, detail in conflict_patterns.get(field, []):
        if re.search(pattern, lower, re.I):
            return ("semantic_mismatch", f"{field} value may be wrong", detail)
    if field == "documentNo" and len(normalize(sample)) < 5:
        return ("short_identifier", "document number may be incomplete", "The extracted identifier is too short to trust.")
    return None


def build_document_alerts(
    doc_type: str,
    extracted: dict[str, Any],
    average_conf: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    risk_alerts: list[dict[str, Any]] = []
    ocr_warnings: list[dict[str, Any]] = []
    seen_risks: set[tuple[str, str, str, str]] = set()
    seen_ocr: set[tuple[str, str, str, str]] = set()
    raw_fields = extracted.get("_rawFields", {})
    field_confidence = extracted.get("_fieldConfidence", {})
    field_boxes = extracted.get("_fieldBoxes", {})

    if average_conf < 78:
        push_unique_alert(
            ocr_warnings,
            seen_ocr,
            build_alert(
                field="document",
                severity="warning",
                message="ocr confidence is low",
                detail=f"Average OCR confidence {average_conf}%. Check blur, angle, or missing print.",
                reason_code="ocr_low_confidence",
                is_key_field=False,
            ),
        )

    for field, severity, label in essential_field_specs(doc_type, extracted):
        value = extracted.get(field)
        raw_value = raw_fields.get(field)
        confidence = float(field_confidence.get(field) or 0)
        has_box = bool(field_boxes.get(field))
        is_blank = value in ("", None, 0, 0.0, [])
        raw_blank = raw_value in ("", None, 0, 0.0, [])

        if is_blank:
            push_unique_alert(
                risk_alerts,
                seen_risks,
                build_alert(
                    field=field,
                    severity=severity,
                    message=f"{label} missing",
                    detail=f"OCR could not confidently extract {label}.",
                    reason_code="missing_key_field",
                    is_key_field=True,
                ),
            )
            continue

        semantic_issue = semantic_field_issue(field, str(value))
        if semantic_issue:
            reason_code, message, detail = semantic_issue
            push_unique_alert(
                risk_alerts,
                seen_risks,
                build_alert(
                    field=field,
                    severity="critical",
                    message=message,
                    detail=detail,
                    reason_code=reason_code,
                    is_key_field=True,
                ),
            )

        if raw_blank and not has_box:
            push_unique_alert(
                risk_alerts,
                seen_risks,
                build_alert(
                    field=field,
                    severity=severity,
                    message=f"{label} requires review",
                    detail=f"{label.title()} was inferred by fallback logic and should be checked manually.",
                    reason_code="fallback_inferred",
                    is_key_field=True,
                ),
            )
            continue

        if 0 < confidence < 0.72:
            push_unique_alert(
                risk_alerts,
                seen_risks,
                build_alert(
                    field=field,
                    severity=severity,
                    message=f"{label} may be damaged",
                    detail=f"OCR confidence for {label} is {round(confidence * 100)}%.",
                    reason_code="low_confidence_key_field",
                    is_key_field=True,
                ),
            )
        elif 0 < confidence < 0.84:
            push_unique_alert(
                ocr_warnings,
                seen_ocr,
                build_alert(
                    field=field,
                    severity="warning",
                    message=f"{label} low confidence",
                    detail=f"OCR confidence for {label} is {round(confidence * 100)}%. Check blur or obstruction.",
                    reason_code="low_confidence",
                    is_key_field=True,
                ),
            )

    return risk_alerts, ocr_warnings


def highlight_field_key(label: str) -> str | None:
    mapping = {
        "Document No": "documentNo",
        "Shipper": "shipper",
        "Consignee": "consignee",
        "Origin": "origin",
        "Destination": "destination",
        "Commodity": "commodity",
        "Packages": "packages",
        "Gross Weight": "grossWeightKg",
        "Volume": "volumeCbm",
        "Incoterm": "incoterm",
    }
    return mapping.get(label)


def promote_highlight_severity(
    highlights: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    severity_by_field: dict[str, str] = {}
    for alert in alerts:
        field = str(alert.get("field") or "")
        existing = severity_by_field.get(field)
        if not existing or severity_rank(str(alert.get("severity", "info"))) > severity_rank(existing):
            severity_by_field[field] = str(alert.get("severity", "info"))

    for highlight in highlights:
        field = highlight_field_key(str(highlight.get("label", "")))
        if not field:
            continue
        promoted = severity_by_field.get(field)
        if promoted and severity_rank(promoted) > severity_rank(str(highlight.get("severity", "info"))):
            highlight["severity"] = promoted
    return highlights


def parse_document(file_name: str, text: str, lines: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    doc_type = detect_doc_type(file_name, text)
    scenario_id = detect_scenario(text)
    if doc_type == "packing_list":
        extracted = parse_packing_list(text, lines)
    elif doc_type == "draft_bill_of_lading":
        extracted = parse_bill(text, lines)
    else:
        extracted = parse_invoice(text, lines)
    extracted["_rawFields"] = {
        field: extracted.get(field)
        for field, _, _ in essential_field_specs(doc_type, extracted)
    }
    extracted = apply_defaults(extracted, scenario_id)
    extracted["highlights"] = build_highlights(extracted, lines)
    return doc_type, extracted


def label_for_doc(doc_type: str) -> tuple[str, str]:
    if doc_type == "packing_list":
        return "装箱单", "Packing List"
    if doc_type == "draft_bill_of_lading":
        return "提单草稿", "Draft Bill of Lading"
    return "商业发票", "Commercial Invoice"


def process_uploaded_file(file_storage: Any) -> dict[str, Any]:
    suffix = Path(file_storage.filename or "upload").suffix.lower() or ".bin"
    with tempfile.TemporaryDirectory(prefix="seabay-ocr-") as tmp:
        tmpdir = Path(tmp)
        raw_path = tmpdir / f"source{suffix}"
        file_storage.save(raw_path)
        render_source = raw_path
        if suffix == ".pdf":
            render_source = pdf_to_png(raw_path, tmpdir / "page")

        processed_path = tmpdir / "normalized.png"
        preprocess_image(render_source, processed_path)
        render_source = processed_path

        preview_url, preview_width, preview_height = image_to_data_url(render_source)
        text = run(["tesseract", str(render_source), "stdout", "-l", OCR_LANG, "--psm", "6"])
        tsv = run(["tesseract", str(render_source), "stdout", "-l", OCR_LANG, "--psm", "6", "tsv"])
        words = parse_tsv(tsv)
        lines = group_lines(words)
        doc_type, extracted = parse_document(file_storage.filename or "upload", text, lines)

        average_conf = round(sum(word.conf for word in words) / max(len(words), 1), 2) if words else 0
        risk_alerts, ocr_warnings = build_document_alerts(doc_type, extracted, average_conf)
        extracted["highlights"] = promote_highlight_severity(
            extracted.get("highlights", []),
            [*risk_alerts, *ocr_warnings],
        )

        label_zh, label_en = label_for_doc(doc_type)
        scenario_id = detect_scenario(text)
        extracted.pop("_fieldBoxes", None)
        extracted.pop("_fieldConfidence", None)
        extracted.pop("_rawFields", None)
        payload = {
            "scenarioId": detect_scenario(text),
            "type": doc_type,
            "labelZh": label_zh,
            "labelEn": label_en,
            "fileName": file_storage.filename,
            "mimeType": file_storage.mimetype or "application/octet-stream",
            "previewUrl": preview_url,
            "previewWidth": preview_width,
            "previewHeight": preview_height,
            "matched": True,
            "rawText": text,
            "ocrRegions": build_ocr_regions(lines),
            "extracted": extracted,
            "riskAlerts": risk_alerts,
            "ocrWarnings": ocr_warnings,
            "warnings": [*risk_alerts, *ocr_warnings],
        }
        insert_record(
            record_type="ocr_document",
            page="intake",
            file_name=str(file_storage.filename or "upload"),
            source="upload",
            scenario_id=scenario_id,
            summary=f"{label_en} · {extracted.get('documentNo') or '-'}",
        )
        return payload


@APP.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@APP.post("/parse")
def parse():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "no files uploaded"}), 400
    docs = [process_uploaded_file(file_storage) for file_storage in files]
    return jsonify({"documents": docs})


@APP.get("/records")
def records():
    try:
        limit = min(max(int(request.args.get("limit", "8")), 1), 20)
    except ValueError:
        limit = 8
    return jsonify({"records": fetch_records(limit)})


@APP.post("/records")
def create_record():
    payload = request.get_json(silent=True) or {}
    required = ["recordType", "page", "fileName", "source", "scenarioId", "summary"]
    missing = [field for field in required if not payload.get(field)]
    if missing:
        return jsonify({"error": f"missing fields: {', '.join(missing)}"}), 400
    insert_record(
        record_type=str(payload["recordType"]),
        page=str(payload["page"]),
        file_name=str(payload["fileName"]),
        source=str(payload["source"]),
        scenario_id=str(payload["scenarioId"]),
        summary=str(payload["summary"]),
    )
    return jsonify({"ok": True})


@APP.post("/zeroclaw/rfq")
def zeroclaw_rfq():
    payload = request.get_json(silent=True) or {}
    return jsonify(
        {
            "ok": True,
            "accepted": False,
            "provider": "ZeroClaw bridge",
            "message": "Adapter stub ready. Configure your downstream API and execution flow later.",
            "payload": payload,
        }
    )


@APP.post("/rfq-live/send")
def rfq_live_send():
    payload = request.get_json(silent=True) or {}
    scenario_id = str(payload.get("scenarioId") or "").strip()
    if scenario_id not in SCENARIO_DEFAULTS:
        return jsonify({"error": "invalid scenarioId"}), 400

    cfg = load_wecom_env()
    target_user = str(payload.get("targetUser") or cfg.get("PRIMARY_USER_ID") or "").strip()
    if not target_user:
        return jsonify({"error": "missing target user"}), 400

    task_id = f"RFQ-{datetime.utcnow().strftime('%m%d%H%M')}-{uuid.uuid4().hex[:4].upper()}"
    outbound_message = build_rfq_message(task_id, payload)
    try:
        send_result = send_wecom_text(target_user, outbound_message)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    insert_rfq_live_task(
        task_id=task_id,
        scenario_id=scenario_id,
        target_user=target_user,
        request_payload=payload,
        outbound_message=outbound_message,
        status="sent",
    )
    upsert_rfq_live_session(task_id=task_id, target_user=target_user, scenario_id=scenario_id)
    return jsonify(
        {
            "ok": True,
            "taskId": task_id,
            "targetUser": target_user,
            "status": "sent",
            "createdAt": now_cst(),
            "outboundMessage": outbound_message,
            "sendResult": send_result,
        }
    )


@APP.get("/rfq-live/task")
def rfq_live_task():
    task_id = str(request.args.get("task_id") or "").strip()
    if not task_id:
        return jsonify({"error": "missing task_id"}), 400
    task = sync_rfq_reply_from_inbox(task_id)
    if not task:
        return jsonify({"error": "task not found"}), 404
    return jsonify({"task": task})


if __name__ == "__main__":
    init_db()
    APP.run(host="127.0.0.1", port=8776)
