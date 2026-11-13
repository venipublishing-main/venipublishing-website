"""Standard-library checks; no network, account scripts or browser execution."""
import unittest
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
PLAYGROUND = "https://vf-reserve-playground.veni-reserve.workers.dev/playground"
RESERVE = "https://vf-reserve-app-preview.veni-reserve.workers.dev/"
class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(); self.links=[]; self.ids=[]; self.canonical=[]; self.reserve_links=[]; self.depth=0
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if a.get("id"): self.ids.append(a["id"])
        if tag=="a": self.links.append(a.get("href", ""))
        if tag=="link" and a.get("rel")=="canonical": self.canonical.append(a["href"])
class Discovery(unittest.TestCase):
    def test_both_entries_are_direct_truthful_and_preserve_routes(self):
        for path, prefix, canonical in [("index.html", "", "/"), ("platforms/index.html", "../", "/platforms/")]:
            with self.subTest(path=path):
                text=(ROOT/path).read_text(encoding="utf-8"); p=Page(text)
                self.assertEqual(p.canonical,["https://venipublishing.co.za"+canonical])
                self.assertEqual(p.links.count(PLAYGROUND),1)
                self.assertEqual(p.links.count(RESERVE),1)
                self.assertIn("non-production review",text)
                self.assertEqual(p.ids.count("reserve-title"),1)
                self.assertIn("Software in development",text); self.assertIn("Simulation only",text)
                self.assertIn("not yet launched",text)
                self.assertNotIn("localhost",text); self.assertNotIn("127.0.0.1",text)
                for route in ["kids/","platforms/","account/","releases/","about/","contact/","privacy/","terms/","ai-geopolitic/","faithful/","mythos/","buza/"]:
                    self.assertIn(prefix+route,p.links)
                self.assertTrue((ROOT/(prefix+"assets/css/reserve-discovery.css") if not prefix else ROOT/"assets/css/reserve-discovery.css").is_file())
    def test_home_has_prominent_direct_discovery(self):
        text=(ROOT/"index.html").read_text(encoding="utf-8")
        self.assertIn('href="#veni-reserve"',text)
        self.assertLess(text.index('id="veni-reserve"'),text.index('class="value-strip"'))
    def test_scoped_responsive_styles_and_no_signup_destination(self):
        text=(ROOT/"assets/css/reserve-discovery.css").read_text()
        self.assertIn("max-width: 760px",text); self.assertIn(":focus-visible",text)
        for path in ["index.html","platforms/index.html"]:
            source=(ROOT/path).read_text(encoding="utf-8")
            section=source[source.index('<section class="section-sm reserve-discovery"'):].split('</section>',1)[0]
            self.assertEqual(Page(section).links,[RESERVE,PLAYGROUND])
            self.assertNotIn('<script',section); self.assertNotIn('<form',section)
if __name__=="__main__": unittest.main()
