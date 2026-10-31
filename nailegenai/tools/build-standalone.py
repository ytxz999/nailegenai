"""把 nailegenai/index.html 打成一个自包含的单文件 HTML。

做三件事：
  1. <link rel="stylesheet"> → 内联 <style>（CSS 里的 ../assets/bg-nai.png 换成 data URI）
  2. <script src> → 内联 <script>
  3. JS 里的 assets/nai/<key>.png → data URI

这么做的原因：GitHub 网页上的 index.html 链接只能看到源码、单文件下载下来又缺
CSS/JS/图片，所以给一个"下载这一个文件、双击就能玩"的版本。
"""
import base64
import mimetypes
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # 仓库根：nailegenai/tools/ 往上两级
SRC = ROOT / "nailegenai"
OUT = ROOT / "nailegenai-standalone.html"


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix == ".png":
        mime = "image/png"
    return "data:%s;base64,%s" % (mime, base64.b64encode(path.read_bytes()).decode("ascii"))


def main() -> int:
    html = (SRC / "index.html").read_text(encoding="utf-8")

    # 1) 样式表内联
    def css_sub(match: re.Match) -> str:
        href = match.group(1)
        css = (SRC / href).read_text(encoding="utf-8-sig")  # 去掉 BOM：内联后 BOM 会让 :root 那条规则被丢弃
        css = re.sub(
            r'url\("\.\./assets/([^"]+)"\)',
            lambda m: 'url("%s")' % data_uri(SRC / "assets" / m.group(1)),
            css,
        )
        return "<style>\n/* %s */\n%s</style>" % (href, css)

    html, n_css = re.subn(
        r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', css_sub, html
    )

    # 2) 脚本内联
    def js_sub(match: re.Match) -> str:
        src = match.group(1)
        code = (SRC / src).read_text(encoding="utf-8-sig")
        if "</script" in code:
            raise SystemExit("脚本里出现了 </script：%s" % src)
        return "<script>\n/* %s */\n%s</script>" % (src, code)

    html, n_js = re.subn(r'<script\s+src="([^"]+)"></script>', js_sub, html)

    # 3) 牌面图 data URI
    icons = sorted((SRC / "assets" / "nai").glob("*.png"))
    for png in icons:
        html = html.replace("assets/nai/%s" % png.name, data_uri(png))

    # 注释里还留着 "assets/nai/*.png" 这样的字样，所以只校验真正的图片引用
    leftover = re.findall(r'["\'](assets/[^"\']+\.png)["\']', html)
    assert not leftover, "还有没内联的图片引用：%s" % sorted(set(leftover))[:5]
    assert html.count("data:image/png;base64,") >= len(icons) + 1, "牌面或背景没内联全"

    OUT.write_text(html, encoding="utf-8")
    print(
        "ok %s  %.2f MB  (css=%d js=%d icons=%d)"
        % (OUT, OUT.stat().st_size / 1024 / 1024, n_css, n_js, len(icons))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

