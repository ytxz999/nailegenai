# -*- coding: utf-8 -*-
"""把 docs/06-项目报告.md 转成排版好的 Word（A4、宋体正文、黑体标题、表格与插图）。

只服务于这一份报告：处理它实际用到的 markdown 子集
（# / ## / ### 标题、管道表、``` 代码块、![图](路径) 插图、> 引用、
 - / 1. 列表、--- 分隔线、**粗体** / `代码` 行内标记）。
"""
import re
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "06-项目报告.md"
DST = ROOT / "docs" / "06-项目报告.docx"

HEI = "黑体"
SONG = "宋体"
MONO = "Consolas"


# ---------- 基础排版工具 ----------

def set_run_font(run, name_latin=SONG, name_east=SONG, size=12, bold=None, color=None):
    run.font.name = name_latin
    run.font.size = Pt(size)
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), name_latin)
    rfonts.set(qn("w:hAnsi"), name_latin)
    rfonts.set(qn("w:eastAsia"), name_east)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def shade(element, fill):
    """给段落或表格单元加底色。"""
    pr = element.get_or_add_tcPr() if hasattr(element, "get_or_add_tcPr") else element.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pr.append(shd)


def add_page_number_footer(section):
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    run._element.addnext(fld)
    set_run_font(run, size=9, color=RGBColor(0x66, 0x66, 0x66))


INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


def add_inline(paragraph, text, size=12, east=SONG, latin=SONG, color=None):
    """写一段带 **粗体** / `代码` 的行内文本。"""
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = paragraph.add_run(part[2:-2])
            set_run_font(run, name_latin=latin, name_east=east, size=size, bold=True, color=color)
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            run = paragraph.add_run(part[1:-1])
            set_run_font(run, name_latin=MONO, name_east=east, size=size - 1,
                         color=RGBColor(0xB0, 0x36, 0x2A))
        else:
            run = paragraph.add_run(part)
            set_run_font(run, name_latin=latin, name_east=east, size=size, color=color)


# ---------- 文档骨架 ----------

doc = Document()

sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2.4)
sec.top_margin = Cm(2.5)
sec.bottom_margin = Cm(2.3)
add_page_number_footer(sec)

normal = doc.styles["Normal"]
normal.font.name = SONG
normal.font.size = Pt(12)
normal.element.rPr.rFonts.set(qn("w:eastAsia"), SONG)

for lvl, size, before, after in ((1, 20, 18, 12), (2, 15, 14, 8), (3, 13, 10, 6)):
    st = doc.styles[f"Heading {lvl}"]
    st.font.name = HEI
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
    rpr = st.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:ascii"), HEI)
    rf.set(qn("w:hAnsi"), HEI)
    rf.set(qn("w:eastAsia"), HEI)
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.first_line_indent = Pt(0)
    st.paragraph_format.keep_with_next = True

TEXT_W = Cm(21 - 2.4 * 2)   # 正文可用宽度
MAX_IMG_H = Cm(19.5)        # 单张图的最大高度：给图题留出位置


def body_para(text, indent=True, size=12, color=None, align=None, after=6):
    p = doc.add_paragraph()
    fmt = p.paragraph_format
    fmt.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    fmt.space_after = Pt(after)
    fmt.space_before = Pt(0)
    fmt.first_line_indent = Pt(24) if indent else Pt(0)
    if align is not None:
        p.alignment = align
    add_inline(p, text, size=size, color=color)
    return p


def code_block(lines):
    for i, line in enumerate(lines):
        p = doc.add_paragraph()
        fmt = p.paragraph_format
        fmt.line_spacing = 1.0
        fmt.space_before = Pt(0)
        fmt.space_after = Pt(0)
        fmt.left_indent = Cm(0.6)
        fmt.first_line_indent = Pt(0)
        shade(p._element, "F2F2F2")
        run = p.add_run(line if line else " ")
        set_run_font(run, name_latin=MONO, name_east=MONO, size=9)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)


def quote(lines):
    for line in lines:
        p = doc.add_paragraph()
        fmt = p.paragraph_format
        fmt.left_indent = Cm(0.8)
        fmt.line_spacing = 1.25
        fmt.space_after = Pt(2)
        fmt.first_line_indent = Pt(0)
        shade(p._element, "F7F7F2")
        add_inline(p, line, size=11, color=RGBColor(0x44, 0x44, 0x44))


def list_item(text, numbered, index):
    p = doc.add_paragraph()
    fmt = p.paragraph_format
    fmt.left_indent = Cm(1.0)
    fmt.first_line_indent = Cm(-0.6)
    fmt.line_spacing = 1.4
    fmt.space_after = Pt(3)
    prefix = f"{index}. " if numbered else "· "
    run = p.add_run(prefix)
    set_run_font(run, size=12)
    add_inline(p, text, size=12)


def add_image(md_alt, path, caption):
    target = (SRC.parent / path).resolve()
    if not target.exists():
        body_para(f"[缺图：{path}]", indent=False, color=RGBColor(0xC0, 0x00, 0x00))
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.first_line_indent = Pt(0)
    # 先按正文宽放，超过可用高度就按高度缩——否则图会单独占满一页、图题被挤到下一页
    from PIL import Image as _Img
    with _Img.open(target) as im:
        w_px, h_px = im.size
    max_w = TEXT_W.cm
    max_h = MAX_IMG_H.cm
    scale = min(max_w / w_px, max_h / h_px)
    run = p.add_run()
    run.add_picture(str(target), width=Cm(w_px * scale))


def add_caption(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fmt = p.paragraph_format
    fmt.space_before = Pt(0)
    fmt.space_after = Pt(10)
    fmt.first_line_indent = Pt(0)
    fmt.line_spacing = 1.2
    add_inline(p, text, size=10)


def _column_widths(rows, ncols):
    """按每列文字量分配列宽：长文本列给宽，短编号列给窄。

    同时考虑"最长不可断词的英文标识符"（如 ShuffleCommand）——
    否则窄列会把标识符从中间折断，看起来像拼写错误。
    """
    weight = []
    for j in range(ncols):
        texts = [r[j] for r in rows if j < len(r)]
        lens = [len(t) for t in texts]
        avg = sum(lens) / max(1, len(lens))
        tokens = []
        for t in texts:
            tokens.extend(re.findall(r"[A-Za-z_][A-Za-z0-9_.]{5,}", t))
        longest = max((len(t) for t in tokens), default=0)
        # 0.7 次幂：让长列明显更宽，但不至于把短列挤成一条线
        weight.append(max(avg ** 0.7, longest * 1.05, 1.0))
    total = sum(weight)
    total_cm = TEXT_W.cm
    widths = [total_cm * w / total for w in weight]
    # 每列至少 1.5cm，超出部分从最宽列里扣
    min_cm = 1.5
    for _ in range(ncols * 2):
        deficit = sum(min_cm - w for w in widths if w < min_cm)
        if deficit <= 0:
            break
        widths = [max(w, min_cm) for w in widths]
        widest = widths.index(max(widths))
        widths[widest] -= deficit
    return [Cm(w) for w in widths]


def _mark_header_row(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def _no_split(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:cantSplit")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def add_table(rows):
    header = rows[0]
    body = rows[1:]
    ncols = len(header)
    widths = _column_widths([header] + body, ncols)

    table = doc.add_table(rows=1 + len(body), cols=ncols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False          # 关掉自动布局：否则 Word 会按内容重新拉，列宽不受控
    for j, w in enumerate(widths):
        table.columns[j].width = w

    size = 9 if ncols <= 4 else 8.5
    for j, cell_text in enumerate(header):
        cell = table.rows[0].cells[j]
        cell.width = widths[j]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.first_line_indent = Pt(0)
        p.paragraph_format.space_after = Pt(1)
        add_inline(p, cell_text, size=size, east=HEI, latin=HEI)
        for run in p.runs:
            run.bold = True
        shade(cell._element, "EDF2F6")
    _mark_header_row(table.rows[0])

    for i, row in enumerate(body):
        tr = table.rows[i + 1]
        _no_split(tr)
        for j in range(ncols):
            cell = tr.cells[j]
            cell.width = widths[j]
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.15
            add_inline(p, row[j] if j < len(row) else "", size=size)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)


# ---------- 主解析循环 ----------

lines = SRC.read_text(encoding="utf-8").splitlines()
i = 0
first_h1_seen = False
pending_caption = None

while i < len(lines):
    line = lines[i].rstrip()
    stripped = line.strip()

    if not stripped:
        i += 1
        continue

    # 代码块
    if stripped.startswith("```"):
        i += 1
        buf = []
        while i < len(lines) and not lines[i].strip().startswith("```"):
            buf.append(lines[i].rstrip("\n"))
            i += 1
        i += 1
        code_block(buf)
        continue

    # 分隔线
    if re.fullmatch(r"-{3,}", stripped):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        i += 1
        continue

    # 表格
    if stripped.startswith("|"):
        block = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            block.append(lines[i].strip())
            i += 1
        parsed = []
        for row in block:
            if re.fullmatch(r"\|[\s:\-|]+\|", row):
                continue
            cells = [c.strip() for c in row.strip("|").split("|")]
            parsed.append(cells)
        if parsed:
            add_table(parsed)
        continue

    # 图片
    m = re.match(r"!\[(.*?)\]\((.+?)\)", stripped)
    if m:
        alt, path = m.group(1), m.group(2)
        caption = None
        # 向后找紧跟的图题（**图 x-x　…**）
        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j < len(lines) and lines[j].strip().startswith("**图 "):
            caption = lines[j].strip()
            i = j
        add_image(alt, path, caption)
        if caption:
            add_caption(caption)
            i += 1
        else:
            i += 1
        continue

    # 标题
    if stripped.startswith("#"):
        level = len(stripped) - len(stripped.lstrip("#"))
        text = stripped[level:].strip()
        if level == 1 and not first_h1_seen:
            first_h1_seen = True
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            fmt = p.paragraph_format
            fmt.space_before = Pt(24)
            fmt.space_after = Pt(18)
            fmt.first_line_indent = Pt(0)
            run = p.add_run(text)
            set_run_font(run, name_latin=HEI, name_east=HEI, size=24, bold=True)
        else:
            h = doc.add_heading(level=min(level, 3))
            h.paragraph_format.first_line_indent = Pt(0)
            run = h.add_run(text)
            set_run_font(run, name_latin=HEI, name_east=HEI,
                         size={1: 20, 2: 15, 3: 13}[min(level, 3)], bold=True)
        i += 1
        continue

    # 引用
    if stripped.startswith(">"):
        buf = []
        while i < len(lines) and lines[i].strip().startswith(">"):
            buf.append(lines[i].strip().lstrip(">").strip())
            i += 1
        quote(buf)
        continue

    # 列表
    m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
    if m:
        list_item(m.group(2), True, m.group(1))
        i += 1
        continue
    if stripped.startswith("- "):
        list_item(stripped[2:], False, 0)
        i += 1
        continue

    # 图题（前面没有图时按普通段落居中）
    if stripped.startswith("**图 "):
        add_caption(stripped)
        i += 1
        continue

    body_para(stripped)
    i += 1

doc.core_properties.title = "奶了个奶 —— 基于 AI 分步协作的三消堆叠消除游戏"
doc.core_properties.author = "ytxz999"
doc.core_properties.comments = "《面向对象设计与分析》课程大作业报告"

doc.save(DST)
print("saved", DST, round(DST.stat().st_size / 1024), "KB")
print("paragraphs", len(doc.paragraphs), "tables", len(doc.tables),
      "images", len(doc.inline_shapes))
