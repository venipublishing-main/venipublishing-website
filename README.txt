VENI PUBLISHING — v1.11 COLOUR FIX — LEFT JOIN MICRO PATCH

This patch changes exactly ONE SVG path in index.html.

It extends the left-hand start of orbit-front-c along the same ellipse so the
front segment overlaps the rear ellipse cleanly.

Nothing else changes:
- no CSS
- no colour
- no line weight
- no icon placement
- no other orbit geometry

Use:
1. Extract into:
   E:\Dev\veni-websites\venipublishing-website

2. Run:
   .\fix-orbit-left-join.ps1

3. Hard refresh localhost with Ctrl+F5.
