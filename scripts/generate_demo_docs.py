from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path("/root/dev/seabay-ai-logistics-demo")
OUT_DIR = ROOT / "generated-docs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PAGE_W = 1240
PAGE_H = 1754
MARGIN = 72
CONTENT_W = PAGE_W - MARGIN * 2

TEXT = "#1d2730"
MUTED = "#5b6972"
LINE = "#9cadb8"
ACCENT = "#153c49"
LIGHT = "#f4f7f9"
LIGHTER = "#fafcfd"
WARN = "#8e3328"

FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
FONT_TITLE = ImageFont.truetype(FONT_PATH, 42)
FONT_H2 = ImageFont.truetype(FONT_PATH, 30)
FONT_BODY = ImageFont.truetype(FONT_PATH, 22)
FONT_SMALL = ImageFont.truetype(FONT_PATH, 19)
FONT_TINY = ImageFont.truetype(FONT_PATH, 16)


@dataclass
class DocContext:
    seller: str = "Shenzhen Seabay Export Team"
    buyer: str = "Pacific Home Supplies LLC"
    consignee: str = "Pacific Home Supplies LLC, Los Angeles, USA"
    notify: str = "Pacific Home Supplies LLC Logistics Desk, Los Angeles, USA"
    origin: str = "Yantian, Shenzhen, China"
    destination: str = "Los Angeles, USA"
    commodity_en: str = "Wooden Dining Chairs"
    commodity_zh: str = "木质餐椅"
    hs_code: str = "9401.69"
    incoterm: str = "FOB Shenzhen"
    container: str = "40HQ"
    invoice_packages: str = "410 cartons"
    packing_packages: str = "412 cartons"
    gross_weight: str = "8,960 KG"
    net_weight: str = "8,120 KG"
    volume: str = "67.8 CBM"
    invoice_no: str = "CI-2026-0408-001"
    packing_no: str = "PL-2026-0408-001"
    bl_no: str = "SBCN260408LA01"
    date: str = "2026-04-08"
    po_no: str = "PO-PHS-2026-118"
    marks: str = "PHS-LA-APR-2026"
    vessel: str = "M/V PACIFIC BRIDGE V.026E"
    pol: str = "Yantian"
    pod: str = "Los Angeles"
    place_delivery: str = "Los Angeles Warehouse Zone B"
    seal_no: str = "SB402691"
    container_no: str = "MSDU4826612"
    currency: str = "USD"
    bank_name: str = "Bank of China Shenzhen Branch"
    bank_account: str = "7425-1188-2290"
    bank_swift: str = "BKCHCNBJ45A"


CTX = DocContext()


def new_page() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (PAGE_W, PAGE_H), "white")
    return image, ImageDraw.Draw(image)


def line(draw: ImageDraw.ImageDraw, y: int, x1: int = MARGIN, x2: int = PAGE_W - MARGIN, width: int = 2) -> None:
    draw.line((x1, y, x2, y), fill=LINE, width=width)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    if not text:
      return [""]

    lines: list[str] = []
    paragraph = ""
    for ch in text:
        test = paragraph + ch
        if draw.textlength(test, font=font) <= width:
            paragraph = test
        else:
            if paragraph:
                lines.append(paragraph)
            paragraph = ch
    if paragraph:
        lines.append(paragraph)
    return lines or [text]


def draw_paragraph(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    width: int,
    fill: str = TEXT,
    line_gap: int = 8,
) -> int:
    lines = wrap_text(draw, text, font, width)
    cy = y
    for line_text in lines:
        draw.text((x, cy), line_text, font=font, fill=fill)
        cy += font.size + line_gap
    return cy


def draw_header(
    draw: ImageDraw.ImageDraw,
    title: str,
    number_label: str,
    number_value: str,
    date_label: str,
    date_value: str,
) -> int:
    draw.text((MARGIN, 58), title, font=FONT_TITLE, fill=ACCENT)
    draw.text((PAGE_W - 390, 72), f"{number_label}: {number_value}", font=FONT_BODY, fill=TEXT)
    draw.text((PAGE_W - 390, 106), f"{date_label}: {date_value}", font=FONT_BODY, fill=TEXT)
    line(draw, 154)
    return 176


def box_height(
    draw: ImageDraw.ImageDraw,
    rows: Iterable[tuple[str, str]],
    label_width: int,
    value_width: int,
    row_gap: int = 10,
) -> int:
    total = 18
    for label, value in rows:
        label_lines = wrap_text(draw, label, FONT_SMALL, label_width)
        value_lines = wrap_text(draw, value, FONT_SMALL, value_width)
        total += max(len(label_lines), len(value_lines)) * (FONT_SMALL.size + 6) + row_gap
    return total + 10


def draw_kv_box(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    width: int,
    rows: list[tuple[str, str]],
    fill: str = LIGHT,
) -> int:
    label_width = 150
    value_width = width - label_width - 48
    height = box_height(draw, rows, label_width, value_width)
    draw.rounded_rectangle((x, y, x + width, y + height), radius=14, outline=LINE, width=2, fill=fill)

    cy = y + 16
    for label, value in rows:
        label_lines = wrap_text(draw, label, FONT_SMALL, label_width)
        value_lines = wrap_text(draw, value, FONT_SMALL, value_width)
        row_lines = max(len(label_lines), len(value_lines))
        for idx, line_text in enumerate(label_lines):
            draw.text((x + 16, cy + idx * (FONT_SMALL.size + 6)), line_text, font=FONT_SMALL, fill=MUTED)
        for idx, line_text in enumerate(value_lines):
            draw.text((x + 16 + label_width + 10, cy + idx * (FONT_SMALL.size + 6)), line_text, font=FONT_SMALL, fill=TEXT)
        cy += row_lines * (FONT_SMALL.size + 6) + 10
    return y + height


def row_height_for_cells(draw: ImageDraw.ImageDraw, values: list[str], widths: list[int], font: ImageFont.FreeTypeFont) -> int:
    max_lines = 1
    for idx, value in enumerate(values):
        lines = wrap_text(draw, value, font, widths[idx] - 18)
        max_lines = max(max_lines, len(lines))
    return max(42, max_lines * (font.size + 6) + 18)


def draw_table(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    col_widths: list[int],
    headers: list[str],
    rows: list[list[str]],
    font: ImageFont.FreeTypeFont = FONT_SMALL,
) -> int:
    total_w = sum(col_widths)
    header_h = 48
    draw.rectangle((x, y, x + total_w, y + header_h), outline=LINE, width=2, fill=LIGHT)
    cx = x
    for idx, header in enumerate(headers):
        draw_paragraph(draw, cx + 10, y + 9, header, FONT_SMALL, col_widths[idx] - 18, fill=ACCENT, line_gap=4)
        cx += col_widths[idx]
        if idx < len(headers) - 1:
            draw.line((cx, y, cx, y + header_h), fill=LINE, width=2)

    current_y = y + header_h
    for row in rows:
        rh = row_height_for_cells(draw, row, col_widths, font)
        draw.rectangle((x, current_y, x + total_w, current_y + rh), outline=LINE, width=1, fill="white")
        cx = x
        for idx, cell in enumerate(row):
            draw_paragraph(draw, cx + 10, current_y + 9, cell, font, col_widths[idx] - 18, fill=TEXT, line_gap=4)
            cx += col_widths[idx]
            if idx < len(row) - 1:
                draw.line((cx, current_y, cx, current_y + rh), fill=LINE, width=1)
        current_y += rh
    return current_y


def draw_footer(draw: ImageDraw.ImageDraw, note: str) -> None:
    line(draw, PAGE_H - 105)
    draw_paragraph(draw, MARGIN, PAGE_H - 92, note, FONT_TINY, CONTENT_W, fill=MUTED, line_gap=4)


def save_pdf(name: str, pages: list[Image.Image]) -> None:
    pages[0].save(OUT_DIR / name, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])


def commercial_invoice_pages(zh: bool) -> list[Image.Image]:
    title = "商业发票" if zh else "COMMERCIAL INVOICE"
    number_label = "发票号" if zh else "Invoice No"
    date_label = "日期" if zh else "Date"
    seller_label = "卖方" if zh else "Seller"
    buyer_label = "买方" if zh else "Buyer"
    consignee_label = "收货人" if zh else "Consignee"
    origin_label = "起运港" if zh else "Port of Loading"
    destination_label = "目的港" if zh else "Port of Discharge"
    incoterm_label = "贸易条款" if zh else "Incoterm"
    payment_label = "付款方式" if zh else "Payment Term"
    po_label = "采购单号" if zh else "PO No."
    currency_label = "币种" if zh else "Currency"
    commodity = CTX.commodity_zh if zh else CTX.commodity_en

    page1, d1 = new_page()
    y = draw_header(d1, title, number_label, CTX.invoice_no, date_label, CTX.date)
    left_rows = [
        (seller_label, CTX.seller),
        (buyer_label, CTX.buyer),
        (consignee_label, CTX.consignee),
        (po_label, CTX.po_no),
    ]
    right_rows = [
        (origin_label, CTX.origin),
        (destination_label, CTX.destination),
        (incoterm_label, CTX.incoterm),
        (payment_label, "T/T 30% deposit, 70% before shipment" if not zh else "T/T 预付 30%，出货前付 70%"),
        (currency_label, CTX.currency),
    ]
    left_bottom = draw_kv_box(d1, MARGIN, y, 515, left_rows)
    right_bottom = draw_kv_box(d1, 653, y, 515, right_rows)
    y = max(left_bottom, right_bottom) + 22

    headers = ["序号", "品名", "海关编码", "数量", "单位", "单价", "金额"] if zh else [
        "Item",
        "Description",
        "HS Code",
        "Qty",
        "Unit",
        "Unit Price",
        "Amount",
    ]
    rows = [
        ["1", commodity + (" - Oak Finish" if not zh else "（橡木色）"), CTX.hs_code, "180", "件" if zh else "PCS", "USD 78", "USD 14,040"],
        ["2", commodity + (" - Walnut Finish" if not zh else "（胡桃木色）"), CTX.hs_code, "132", "件" if zh else "PCS", "USD 82", "USD 10,824"],
        ["3", commodity + (" - Black Frame" if not zh else "（黑框款）"), CTX.hs_code, "100", "件" if zh else "PCS", "USD 72.72", "USD 7,272"],
    ]
    y = draw_table(d1, MARGIN, y, [70, 340, 120, 95, 95, 140, 160], headers, rows)

    draw_kv_box(
        d1,
        MARGIN,
        y + 18,
        548,
        [
            ("箱型 / 件数" if zh else "Container / Package", f"{CTX.container} / {'410 箱（发票申报）' if zh else CTX.invoice_packages}"),
            ("毛重" if zh else "Gross Weight", CTX.gross_weight),
            ("净重" if zh else "Net Weight", CTX.net_weight),
            ("体积" if zh else "Volume", CTX.volume),
            ("价格条款" if zh else "Price Basis", "FOB Shenzhen / mixed SKU quotation"),
        ],
    )
    draw_kv_box(
        d1,
        620,
        y + 18,
        548,
        [
            ("收款银行" if zh else "Bank", CTX.bank_name),
            ("账号" if zh else "Account", CTX.bank_account),
            ("SWIFT", CTX.bank_swift),
            ("开票备注" if zh else "Invoice Note", "用于 AI 录单与报价演示" if zh else "Prepared for AI intake and quotation demo"),
        ],
        fill=LIGHTER,
    )

    warning = (
        "声明：本页件数故意填写为 410 箱，用于与装箱单 412 箱形成差异校验。"
        if zh
        else "Declaration: invoice package count is intentionally set to 410 cartons to trigger cross-document validation against the packing list."
    )
    draw_paragraph(d1, MARGIN, y + 278, warning, FONT_SMALL, CONTENT_W, fill=WARN, line_gap=6)
    draw_paragraph(
        d1,
        MARGIN,
        y + 340,
        "签字 / Signature: ________________________    公司盖章 / Company Chop: ________________________"
        if zh
        else "Authorized Signature: ________________________    Company Stamp: ________________________",
        FONT_SMALL,
        CONTENT_W,
    )
    draw_footer(
        d1,
        "本文件根据公开商业发票字段结构整理生成，仅用于演示和打印，不对应真实客户订单。"
        if zh
        else "Generated from public commercial invoice field references for sanitized demo and printing use.",
    )
    return [page1]


def packing_list_pages(zh: bool) -> list[Image.Image]:
    title = "装箱单" if zh else "PACKING LIST"
    number_label = "装箱单号" if zh else "Packing List No"
    date_label = "日期" if zh else "Date"
    shipper_label = "发货人" if zh else "Shipper"
    marks_label = "唛头" if zh else "Shipping Mark"
    container_label = "箱型" if zh else "Container"
    commodity = CTX.commodity_zh if zh else CTX.commodity_en

    page1, d1 = new_page()
    y = draw_header(d1, title, number_label, CTX.packing_no, date_label, CTX.date)
    left_bottom = draw_kv_box(
        d1,
        MARGIN,
        y,
        515,
        [
            (shipper_label, CTX.seller),
            ("买方" if zh else "Buyer", CTX.buyer),
            ("收货人" if zh else "Consignee", CTX.consignee),
            (marks_label, CTX.marks),
        ],
    )
    right_bottom = draw_kv_box(
        d1,
        653,
        y,
        515,
        [
            ("起运港" if zh else "Port of Loading", CTX.pol),
            ("目的港" if zh else "Port of Discharge", CTX.pod),
            (container_label, CTX.container),
            ("品名" if zh else "Commodity", commodity),
        ],
    )
    y = max(left_bottom, right_bottom) + 22
    headers = (
        ["箱号区间", "品名", "数量", "净重", "毛重", "体积", "备注"]
        if zh
        else ["Carton Range", "Description", "Qty", "Net Wt.", "Gross Wt.", "CBM", "Remark"]
    )
    rows = [
        ["1-80", commodity + (" A款" if zh else " Type A"), "80", "1,580 KG", "1,742 KG", "12.9", "Oak finish"],
        ["81-160", commodity + (" A款" if zh else " Type A"), "80", "1,575 KG", "1,738 KG", "12.8", "Oak finish"],
        ["161-240", commodity + (" B款" if zh else " Type B"), "80", "1,565 KG", "1,730 KG", "12.7", "Walnut finish"],
        ["241-320", commodity + (" B款" if zh else " Type B"), "80", "1,560 KG", "1,725 KG", "12.6", "Walnut finish"],
        ["321-380", commodity + (" C款" if zh else " Type C"), "60", "1,205 KG", "1,330 KG", "9.2", "Black frame"],
        ["381-412", commodity + (" C款" if zh else " Type C"), "32", "635 KG", "695 KG", "7.6", "Black frame"],
    ]
    y = draw_table(d1, MARGIN, y, [120, 250, 90, 120, 120, 100, 192], headers, rows)
    draw_kv_box(
        d1,
        MARGIN,
        y + 18,
        548,
        [
            ("总件数" if zh else "Total Packages", "412 箱" if zh else CTX.packing_packages),
            ("总体积" if zh else "Measurement", CTX.volume),
            ("封条号" if zh else "Seal No.", CTX.seal_no),
            ("装箱方式" if zh else "Loading Type", "无托盘 / 地板装箱" if zh else "Floor loaded / no pallets"),
        ],
    )
    draw_kv_box(
        d1,
        620,
        y + 18,
        548,
        [
            ("装柜地点" if zh else "Stuffing Location", "Shenzhen Seabay Export Warehouse"),
            ("装柜日期" if zh else "Stuffing Date", CTX.date),
            ("仓库复核" if zh else "Warehouse Check", "仓库复核为 412 箱" if zh else "Warehouse verified 412 cartons"),
            ("备注" if zh else "Remarks", "用于 OCR 与自动录单流程演示" if zh else "Prepared for OCR and automated intake demo"),
        ],
        fill=LIGHTER,
    )
    draw_paragraph(
        d1,
        MARGIN,
        y + 258,
        "签字 / Checked by: ________________________    装柜员 / Stuffed by: ________________________"
        if zh
        else "Checked by: ________________________    Stuffed by: ________________________",
        FONT_SMALL,
        CONTENT_W,
    )
    draw_footer(
        d1,
        "本文件根据公开装箱单字段结构整理生成，仅用于演示和打印。"
        if zh
        else "Generated from public packing list field references for sanitized demo and printing use.",
    )
    return [page1]


def bill_of_lading_pages(zh: bool) -> list[Image.Image]:
    title = "提单草稿" if zh else "BILL OF LADING"
    number_label = "提单号" if zh else "B/L No."
    date_label = "签发日期" if zh else "Issue Date"
    commodity = CTX.commodity_zh if zh else CTX.commodity_en

    page1, d1 = new_page()
    y = draw_header(d1, title, number_label, CTX.bl_no, date_label, CTX.date)
    left_bottom = draw_kv_box(
        d1,
        MARGIN,
        y,
        515,
        [
            ("托运人" if zh else "Shipper", CTX.seller),
            ("收货人" if zh else "Consignee", CTX.consignee),
            ("通知方" if zh else "Notify Party", CTX.notify),
            ("运费条款" if zh else "Freight", "运费预付" if zh else "Freight Prepaid"),
        ],
    )
    right_bottom = draw_kv_box(
        d1,
        653,
        y,
        515,
        [
            ("船名 / 航次" if zh else "Vessel / Voyage", CTX.vessel),
            ("装货港" if zh else "Port of Loading", CTX.pol),
            ("卸货港" if zh else "Port of Discharge", CTX.pod),
            ("交货地" if zh else "Place of Delivery", CTX.place_delivery),
        ],
    )
    y = max(left_bottom, right_bottom) + 22
    headers = (
        ["箱号", "封条号", "箱型", "货物描述", "毛重", "体积"]
        if zh
        else ["Container No.", "Seal No.", "Size/Type", "Description of Goods", "Gross Wt.", "Measurement"]
    )
    rows = [
        [CTX.container_no, CTX.seal_no, CTX.container, f"{commodity} / 412 {'箱' if zh else 'cartons'}", CTX.gross_weight, CTX.volume],
        ["T/S", "-", "Freight Prepaid", "Non-hazardous cargo / No wood fumigation issue" if not zh else "非危险品 / 木制品已按要求处理", "-", "-"],
    ]
    y = draw_table(d1, MARGIN, y, [150, 120, 145, 385, 130, 150], headers, rows)
    draw_kv_box(
        d1,
        MARGIN,
        y + 18,
        548,
        [
            ("正本提单份数" if zh else "No. of Original B/L", "3/3 正本" if zh else "3/3 originals"),
            ("贸易条款" if zh else "Incoterm", CTX.incoterm),
            ("已装船批注" if zh else "Shipped on Board", "2026-04-08 已装船" if zh else "On board 08 Apr 2026"),
            ("订舱号" if zh else "Booking No.", "SB-LAX-260408-09"),
        ],
    )
    draw_kv_box(
        d1,
        620,
        y + 18,
        548,
        [
            ("签发地及日期" if zh else "Place and Date of Issue", "中国深圳 / 2026-04-08" if zh else "Shenzhen, China / 08 Apr 2026"),
            ("目的港指令" if zh else "Destination Instruction", "到港后通知收货人物流团队安排提货。" if zh else "Notify consignee logistics desk upon arrival for pickup arrangement."),
            ("演示说明" if zh else "Demo Note", "用于 AI 自动录单、OCR 识别和字段审核演示。" if zh else "Prepared for AI intake, OCR parsing, and field review demo."),
        ],
        fill=LIGHTER,
    )
    draw_paragraph(
        d1,
        MARGIN,
        y + 250,
        "承运人签章 / Carrier Signature: ________________________    托运人确认 / Shipper Confirmation: ________________________"
        if zh
        else "Carrier Signature: ________________________    Shipper Confirmation: ________________________",
        FONT_SMALL,
        CONTENT_W,
    )
    draw_footer(
        d1,
        "本文件根据公开提单字段结构整理生成，仅用于演示和打印。"
        if zh
        else "Generated from public bill of lading field references for sanitized demo and printing use.",
    )
    return [page1]


def main() -> None:
    save_pdf("commercial-invoice-en.pdf", commercial_invoice_pages(False))
    save_pdf("commercial-invoice-zh.pdf", commercial_invoice_pages(True))
    save_pdf("packing-list-en.pdf", packing_list_pages(False))
    save_pdf("packing-list-zh.pdf", packing_list_pages(True))
    save_pdf("bill-of-lading-en.pdf", bill_of_lading_pages(False))
    save_pdf("bill-of-lading-zh.pdf", bill_of_lading_pages(True))
    for path in sorted(OUT_DIR.glob("*.pdf")):
        print(path.name)


if __name__ == "__main__":
    main()
