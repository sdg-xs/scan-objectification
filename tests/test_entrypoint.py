from html.parser import HTMLParser
from pathlib import Path


def test_home_page_opens_bim_gaussian_viewer_immediately():
    class Page(HTMLParser):
        refresh = None
        links = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "meta" and attrs.get("http-equiv", "").lower() == "refresh":
                self.refresh = attrs.get("content")
            if tag == "a":
                self.links.append(attrs.get("href"))

    page = Page()
    page.feed((Path(__file__).resolve().parents[1] / "web/index.html").read_text(encoding="utf-8"))
    assert page.refresh == "0;url=/viewer.html"
    assert page.links == []
