# Mandelbrot Cross-Stitch Visualizer

## Purpose
The user is making a **cross stitch of the Mandelbrot set** (half stitches `/`, kanavatyö on **Penelope canvas**, Taito shop, 39 holes/10 cm; likely 2 strands of ohut Pirkka or
similar — see `yarn-options.md`). This is a local web app for
finding a spot in the set, choosing colors, and previewing and exporting the result as a real stitch pattern in **DMC stranded cotton, Pirkka wool or Rauma
Finull wool** (the **Yarn** switch). The final piece is **120 × 90 cm at 7.8 stitches/cm = 936 × 702 stitches** (petit point over single
threads of the 3.9/cm Penelope canvas; earlier plans used 3.9/cm = 468 × 351).

## Working with this user
- Requests are short and iterative ("make X better", "this broke"). Act on them and show evidence (measurements,
  screenshots, thread counts). Keep the reply summary short and concrete.
- **They explore in fullscreen**, so every control they need must work in fullscreen (floating panels, the H key, …).
- They care about **the look of the fractal** ("the soul"). Never post-process stitches in ways that erase fine
  detail. Cleanliness must come from sampling and mapping, not repainting.
- **Performance matters:** the UI must never freeze. The app was built to handle 4680 × 3510 (16.4M stitches) and must
  keep working at that size even though the default is now 936 × 702.
- **In the stitching view (work.html), a thread in 10-point and the same thread in 20-point are always separate
  items**, because the user has to rethread between them just as when changing color. Every list, highlight, filter,
  flood, count and visualization there works per item (kind = thread · 2 + 1 for 10-point). Assume this for all
  future stitching-view features.
- When something "doesn't work", suspect a **stale browser cache** first (see Running), then reproduce it in headless
  Chrome with realistic input (click jitter, fullscreen constraints).

## Rejected / don't do
- **Speck/confetti removal** (repainting small islands): built, then rejected because it "removes the soul from the
  fractal". Removed entirely. Don't reintroduce stitch-repainting cleanup.
- **Bright fabric showing at stitch corners** (white dots): the user liked the idea, but the tiny bright specks aliased.
  The corner gaps are a dark hole color instead.
- **Plain drag drawing the selection:** the user wanted drag = pan. Selection drawing is Shift-drag / ▭ Select area.
- Linear/log mapped over 0..maxIter: collapses to ~2 colors (most points escape early). Always fit to the selection.
- A hard ΔE cut-off when separating outside colors from the inside color: it caused dark "halo" rings. Use the smooth one.
- "Keep width" or "keep top-left" on resize: it made views shift after fullscreen. Use the remembered-box logic.

## Features (current UI)
**Page layout** (normal view is an overview; ≥1100 px wide):
- Header: title and **💾 Save / 📂 Load** (Cmd+S saves; drop a .json anywhere to load).
- Left: sticky **🎨 Color panel** (`#colorPanel`), toggled by 🎨 Colors buttons in both view headers (`state.colorsOpen`).
- Right: **Explorer** (`#explorerStage`) and **Stitch preview** (`#stitchStage`) side by side as equal 4:3 windows.
  Under the stitch preview: a compact strip of stitch controls, the **Threads along the gradient** panel
  (`#spectrumPanel`), and the thread list (scrolls in a 260 px box).
- Each view has **⛶ Fullscreen**. In fullscreen the view fills the screen and its controls float (drag by the ⠿ grip,
  Hide/Show). The color panel is **moved by JS into whichever view is fullscreen** (floats right). In stitch fullscreen
  the stitch controls float left and the thread list floats bottom-right.
- **The spectrum panel floats in both fullscreen views:**
  - **Position:** along the bottom, left of the thread list (stitch view) or left of the color panel (explorer).
    It can be resized from its corner.
  - **Explorer:** JS moves it into the explorer stage when that view is fullscreen.
  - **Room for it:** the stitch controls get `max-height: calc(100vh - 250px)`.
- **Fit avoids floating panels:** `PatternView` `getFreeRect` → `largestFreeRect` (the largest rectangle clear of
  every visible absolutely-positioned panel over the canvas, with an 8 px margin). The view refits while it's still
  fitted, after a panel drag, Hide/Show, the colors toggle, or entering/leaving fullscreen.

**Explorer**
- Drag = pan. Two-finger scroll / trackpad pinch (ctrl+wheel) / touch pinch = zoom at the cursor.
- **Selection** rectangle (aspect locked to stitch W:H):
  - **Draw:** Shift-drag or the one-shot **▭ Select area** button (Esc cancels).
  - **Resize and move:** corner handles resize, the `⠿ W × H` size tag moves it.
  - **Rotate:** drag the round knob (Shift snaps to 15°), or use the "Rotation °" box (double-click resets).
  - **Ignore click jitter:** handles, knob and tag ignore movement under 4 px.
- **Deselect** (`state.selVisible`): any plain click (not on a handle/knob/tag), **H** (toggle; works in fullscreen,
  where the browser takes Esc), Esc, or the "Hide selection" button. While hidden, the selection is invisible and inert,
  and the stitch pattern keeps the last selection. Shift-drag / Select area draws a new one and shows it.
- **Framing guides** (`js/guides.js`, `state.guide` / `state.guideOrient`):
  - **Guides:** rule of thirds, golden ratio grid, golden spiral, golden triangles, diagonals, harmonic armature,
    center cross.
  - **Where:** drawn inside the selection (clipped, rotating with it) and over the whole stitch preview. Shapes are
    defined in unit frame coordinates and mapped through the frame's corner and edge vectors. Perpendiculars use the
    real W:H aspect, and the spiral is stretched to the frame.
  - **Controls:** a Guide select plus ⟲ in both view headers. The spiral and triangles have 4 flip orientations.
    **F** cycles the guides and **Shift+F** turns them, which works in fullscreen.
- **Header:** max iterations box, Guide, Hide selection, Select area, Zoom to selection (fits the rotated bounding box),
  Reset view, 🎨, ⛶.

**Color panel**
- **Random palette:** a style dropdown (19 styles + "Surprise me", `generate.js`, OKLCH-based plus 3 real-DMC-thread
  styles), 🎲 Generate (**G** key), ↶ Back (100-step history), ★ Save to a persisted "Saved" gallery group.
  "Also randomize cycle length & phase" is an option.
- **Palette library:** a gallery of 61 presets in 9 groups (`PRESET_GROUPS` in `palettes.js`).
- **Gradient stops:** color pickers, + Stop, Reverse.
- **Threads along the gradient** is **the thread selector** (`js/spectrum.js` `SpectrumView`, in its own panel
  `#spectrumPanel`, see Stitch preview):
  - **Top band:** the gradient (LUT).
  - **2nd band:** the nearest yarn of the selected yarn set at each position (`plan.nearestOfLut`), i.e. what a
    sample there would pick.
  - **3rd band:** one segment per thread.
  - **Sample lines with markers:** **click or drag anywhere** (not on an edge) to move the sample point of the
    segment under the pointer. Its thread becomes the nearest yarn at that spot. Clicking no longer highlights; use
    the thread list for that.
  - **Dashed segment edges:** **drag one to move gradient positions, and so stitches, between neighbours.** An edge
    stays between the two sample points.
  - **Bottom bars:** stitches per gradient position in the thread color (`pattern.usage`, scaled to the 98th
    percentile). This is what the mapping sliders move.
  - **Readout:** hover shows "click → <yarn>" when a click would change the thread, and the stitch % on each side
    of an edge. Edges ignore movement under 4 px.
  - **"Auto threads"** discards the edits.
- **Depth mapping:** Cyclic, Linear, Logarithmic, Balanced, **"Balanced to max depth · crisp edge"** (`edge`), and
  **"Single pass · detail balance"** (`spectrum`). See Color mapping.
- **Mapping controls:**
  - "Fit gradient to the selected area" (linear/log).
  - Iterations per cycle / gradient length: log slider 1–1,000,000 plus a box.
  - Phase (cyclic).
  - Edge band width (edge mode).
  - Detail balance (spectrum mode).
  - Band bunching (non-cyclic).
  - Depth bands (0 = smooth).
  - Inside-the-set color.

**Stitch preview**
- **Header:** Enabled switch (off = no pattern computation, `state.stitchEnabled`), **/ Stitches | ▦ Pixels** look toggle,
  🎲 Palette + ↶ (so palettes can be changed without the color panel), 🎨, ⛶. The status and progress bar (with ETA for
  long renders) sit under the canvas.
- **Viewport:** pannable and zoomable (drag, wheel, pinch), with an overview inset when zoomed in. Hover shows column,
  row and thread. Re-fits on resize until the user zooms or pans.
- **Stitch controls:**
  - **Calculation depth** (max iterations, log slider 20–1,000,000 plus a box, recomputes on release; synced with the
    explorer box via `setMaxIter`).
  - **Pattern size:** stitches/cm, width/height in cm, width/height in stitches (linked; cap 20,000 per side and
    `MAX_STITCHES` = 40M in total).
  - **Threads:**
    - **Yarn** (`state.yarn`: `dmc` | `pirkka` | `rauma`) picks the thread catalog the pattern uses, and the thread list
      header follows it.
    - **Yarn amount** (`<details>`, per yarn: `state.yarnSpec[yarn] = {m, g, strands, strandsBig, extra}`):
      - **Defaults:** 1 strand, +15%. Per ball: Pirkka ohut 400 m / 100 g (tex 125 × 2); DMC the same (the user
        asked for that, editable); Rauma Finull 175 m / 50 g.
      - **Per stitch:** `s·(√2 + 1)·strands·(1 + extra)` for a 20-point stitch (s = stitch size: the front diagonal
        plus the back step), and twice as long × `strandsBig` for a 10-point stitch. Measured as yarn off the ball.
      - **Fractional strands:** 0.5 means one ply of a 2-ply strand.
      - **The user's Pirkka plan:** half a strand for small stitches, doubled for big ones (`YARN_SPEC_DEFAULTS.pirkka`
        = 0.5 / 2). Old saved Pirkka settings without `strandsBig` are migrated to that.
      - **Result:** at 7.8/cm that's ≈ 0.18 cm per 20-point and ≈ 1.42 cm per 10-point stitch, so a 10-point area
        uses ~2× the yarn per area of a 20-point one.
    - Max thread colors (2–80).
  - **Sampling:** see Rendering.
  - **Label in stitches** (`state.label`, `js/label.js`): text stamped into the pattern itself near the lower edge,
    so it gets stitched.
    - **Text:** empty = `coordinateLabel(sel)`, i.e. center and zoom, with digits growing with zoom depth. The user
      wanted the coordinates *in the final product*; a DOM overlay strip was rejected.
    - **Font** (`label.font`), times a size of 1×, 2× or 3× (shrinks to fit):
      - 7 tall: 5×7.
      - 5 tall: 3×5.
      - 3 tall: tiny, with some look-alikes, and ÄÖÅ fall back to A/O/A.
      - Every font has A–Z, digits and punctuation. `i` after a digit is the imaginary unit.
    - **Placement:** bottom left, center or right, 5 stitches from the edges.
    - **Threads:** text and background threads are chosen from the pattern's own threads (auto = lightest on
      darkest), so no extra yarn is needed.
    - **Background:** none, a 1-stitch outline, or a band.
    - **Where it happens:** stamped in `buildPattern` after the thread mapping and before counting, so the thread
      list and yarn amounts include it. It uses `stitchSel`, the selection the field was computed from.
  - **Preview:** show grid, Fit, Zoom to stitches, PNG export (1 px per stitch, or the current view).
- **Thread list:** swatch, code, name, stitches, %, **estimated meters and grams** (the `yarnUse()` estimate), plus
  a total line `#yarnTotal` (m, g, balls rounded up per color). **Always lists every chosen thread**: threads the mapping
  doesn't reach show 0 stitches in the alert color (`--alert`), and the header counts them as "N unused". Click a thread to highlight where it goes. **Usage | Palette** sort
  (`state.legendSort`). Palette order places each thread by the start of its longest run of LUT entries after
  reduction, with the inside thread first (this handles cyclic wrap).

## Stitching view (`work.html`, `work.css`, `js/work.js`)
A separate page for *doing* the stitching. The designer header links to it (🪡), and it links back (✏️).
- **Input:** opens a stitch chart (🧵 Final export) via 📂 or drop. Chart threads map back to `THREADS` by yarn + code,
  and the view is rendered by the same `PatternView` (10-point blocks from `tenPointRows`, Stitches or Pixels look).
- **Storage (IndexedDB `mandel-stitch-work`, store `kv`):** `chart` holds the last chart text (reopened on load), and
  `progress:<name|WxH|exportedAt>` holds a Uint8Array of done cells. View preferences are in localStorage
  `mandel-stitch-work-prefs`.
- **Items:** each thread's 10-point and 20-point stitches are separate items (`chart.kinds`, `kindOf(k)`,
  `hlKind`).
  - **The list:** grouped by thread. A thread header row (both types together) is followed by its item rows, each
    with stitches, meters (split by the chart's strand settings via `kindMeters`) and a large Done bar with a %.
  - **Progress block:** a large total % at the top of Progress.
  - **Counting:** progress is in **stitches** (a 10-point stitch = 4 cells counts once).
  - **Layout:** the side panel is 460 px wide.
- **Helpers:**
  - Click an item to highlight it. Everything else fades, including the same thread's other stitch type:
    `PatternView.setHighlight(t, 'big' | 'small')`, whose faded variants use color index t + F in the renderer and
    are per cell in the tiles.
  - Chart symbols at ≥ 12 px/stitch, one large symbol per 10-point stitch.
  - Row and column rulers every 10, 50 or 100, with the pointer's row and column in red.
  - A crosshair band on the hovered row and column.
  - The hover readout gives the row, column, thread, stitch type, and done state.
- **Progress tools:** ✋ Move, ✔ Mark / ⌫ Unmark (drag a square **brush**, 1–61 stitches: `BRUSHES`, slider or [ ],
  with a dashed outline), and 🪣 **Flood**.
  - **Flood:** click to mark the connected same-thread patch, across edges or also corners (`floodConn`). Flooding
    from a finished stitch unmarks the patch.
  - **Filters** (all tools): colors (`filterColor`: all, or the highlighted thread only) and stitch type
    (`filterStyle`: both, 10-point only, 20-point only). Flood spreads through the whole same-color patch but marks
    only the stitches that pass.
  - **10-point stitches** are always marked whole (`addStitch` adds the 2 × 2 block, which can reach a cell past the
    brush).
  - Undo holds 100 steps. Finished stitches are faded by a 1-px-per-cell overlay (`doneLayer`).
  - There are per-thread and total progress bars, and 🔍 Next undone jumps to the next unfinished stitch of the
    highlighted (or any) color.
- **Visualizations** ("Color stitches by", **V** cycles; `VISUALS` in work.js, which is built to take more):
  - **How they draw:** each visualization maps a cached per-cell value to a color in a 1-px-per-cell overlay
    (`visualLayer`, 88% opaque, under the done fade). With a thread highlighted, only its stitches are colored.
    Legend and hover text come from `legend` / `describe`.
  - **What a stitch is:** a 20-point cell or a whole 10-point block. "Same stitch" = same thread **and** same type.
  - **`distance`:** the gap to the nearest other same stitch, in stitches (0 = touching by an edge or a corner).
    `nearestGaps` searches square rings outward, up to 40 (≈ 25 ms at 936 × 702).
    - **Colors:** 0 is dull gray, then yellow → orange → red at 20+, and deep red = none within 40.
    - **Finding:** the band edges show staircases of single 20-point stitches one cell apart.
- **Keys and fullscreen:** 1–4 tools, [ ] brush size, Space+drag moves, Cmd+Z undo, N next, F fit, S symbols, Esc clears the
  highlight. Fullscreen is the whole page, so every control stays available.
- **PatternView hooks** (unused by the designer): `afterDraw(ctx, view)` for overlays, and `paint` = `{ active(e),
  stroke(phase, cell) }` to paint instead of pan; `cellAt(e)`.
- **The user plans to add more helpers here.**

## Color mapping (`js/palettes.js` `makeMapper(state, depthStats)`)
- **Depth** = smooth escape count `n + 1 − log2(log|z|)`, or −1 inside.
- **LUT:** gradient stops go into a 1024-entry lookup table (cyclic gradients wrap the last stop into the first), and
  depth maps to a LUT index, then to a DMC thread.
- `sampleDepthStats` gives 257 depth quantiles of the selection (a 128-wide sample, ~10 ms). It's refreshed on
  selection, size or maxIter change, and used by fit, balanced and edge.
- **cyclic:** `t = frac(v / period + offset)`.
- **linear / log:** with fit on (`state.fitRange`) they span the 2nd–98th percentile of selection depths; otherwise 0..period.
- **balanced:** histogram-equalized (CDF over the quantiles), so each color covers ~equal area.
- **edge ("Balanced to max depth · crisp edge"):**
  - **Balanced, anchored at maxIter:** q[256] = max(q[256], maxIter), so the deepest points (the set's boundary) get
    the last color.
  - **Crisp edge:** outside LUT colors are pushed ≥ ΔE 22 from the inside color by **changing lightness only**, with a
    smooth soft-max `(d⁴ + E⁴)^¼` that keeps the gradient order. The inside DMC thread is **protected**: outside stitches
    never use it, and `pickThreads(…, protect)` never merges it.
  - **Edge band width** `state.edgeWidth` (−2…2): γ = 4^−edgeWidth on the balanced position.
- **spectrum ("Single pass · detail balance"):** one pass of the gradient, from the outer area to the set's edge,
  with the same crisp-edge separation and inside-thread protection as `edge`. Balanced crowds the deep tail near the
  inside into 1–2 colors because it covers little area, and log flattens the outer area.
  - **The blend:** quantile segment k gets a gradient share `Δu_k^s`, with u = log depth and
    s = `state.detailBalance` (0…1, default 0.5, double-click resets).
  - **Endpoints:** s = 0 is exactly balanced, and s = 1 is exactly log over [q0, q256]. Depths past q256 get the last color.
- **Band bunching** `state.bunch` (−1…1, all non-cyclic modes): `f(t) = (e^{kt} − 1)/(e^k − 1)`, k = 8·bunch.
  Right packs bands toward the edge. Both sliders snap to 0 near the centre and reset on double-click.
- **Bands** quantize t into N flat bands.
- **Thread plan** (`threadPlan()` in main.js):
  - **Segments:** the 1024 LUT entries are split into segments `{start, end, sample, thread}`.
  - **Automatic:** `autoSegments` (below). Runs shorter than 3 entries join the closer-colored neighbour, unless they
    are the thread's only run.
  - **Edited:** `state.threadEdit = { key, segs: [{end, sample (0…1), dmc code}] }` (via `editThreads`).
  - **When edits apply:** only while `key` (= `gradientKey`: stops, inside color, cyclic, crisp edge, maxColors)
    matches. A new palette or max-threads change shows the automatic plan, and going back brings the edits back.
  - **Saved as** `render.threadEdits` (`false` = automatic).
- **Thread choice** (`autoSegments` + `pickThreads` in `quantize.js`):
  - **From the gradient, not the stitches.** Each of the 1024 LUT entries counts once, so the thread set depends only
    on the stops, inside color, crisp edge (and cyclic wrap) and maxColors.
  - **Why:** the user asked for this. When threads were weighted by stitch count, moving detail balance or bunching
    swapped the threads, which made editing hard.
  - **Algorithm:** nearest DMC in CIELAB, then greedy merging of the pair with the lowest (min weight × ΔE) down to
    maxColors, then a remap to the nearest survivor.
  - **Inside thread:** protected (its own slot) whenever the selection has inside points (`depthStats.insideShare`).
  - **Caching:** the plan is cached by that key.

## Rendering
- **Sampling** (`renderRows` in `mandelbrot.js`, `state.supersample`):
  - **Basic modes:** 1 = stitch center; 2×2 / 3×3 = mean depth (slightly noisier than 1!).
  - **Ultra clean** 8×8 / 16×16 / 32×32 = 64 / 256 / 1024 samples per stitch. Samples are jittered with a
    deterministic hash (reproducible), and the stitch takes the **median** outside depth (quickselect). A stitch is
    inside if most samples are. `grid.clean = ss >= 8`.
  - **Timings at 468 × 351:** 1 sample ≈0 s, 64 ≈0.1 s, 256 ≈0.5 s, 1024 ≈1.7 s. At 16.4M stitches, 64 samples ≈12 s.
  - **Not restored on reload:** sampling ≥ 8 resets to 1 on reload, except when a loaded save file asks for it (a
    sessionStorage flag).
- **Iterations:** 20–1,000,000. Deep maxIter is cheap thanks to cardioid/bulb checks and **periodicity detection**
  (inside points exit early). Double precision limits zoom to ~1e-13.
- **Half stitch look** ("/ Stitches", **at every zoom**, including the fullscreen Fit view):
  - **Shape:** each `/` is an **oval** from corner to corner, width ≈ **75% of length**. The outline has semi-axes
    `reach` × 0.50, where reach = 0.77 − 0.10·open. The thread is 0.06 shorter × 0.45, plus a thin sheen. Passes are
    drawn in order: outline, thread, sheen.
  - **Coverage:** neighbouring diagonals (0.71 cell apart) overlap, so no fabric shows along stitches.
  - **Corners:** the ovals pinch there, and the gaps show a **dark hole color `#2e261e`**, forming row and column lines.
    The pinch opens with zoom (`open` = 0 below ~6 px/stitch, 1 from ~16) to avoid aliasing.
  - **Rasterized, not vector** (`drawStitchImage` / `renderStitchImage` / `cellMap` in stitch.js):
    - **Cell map:** for a cell size of k device px, `cellMap(k, open)` records per pixel which of the 9 cells (own
      + neighbours) shows and in which pass, from 4 × 4 subsamples. Edge pixels are blended.
    - **Filling:** the image is filled per pixel from that map. Cells whose 8 neighbours share their thread copy a
      cached block.
    - **k:** k = max(3, round(z·dpr)), capped by `STITCH_BUDGET` (16M device px). If k would drop below 2 (huge
      patterns zoomed out), the bitmap tiles are used instead.
    - **Below 2 device px per stitch:** it renders at k = 2 and shrinks exactly 2:1 (`avg`), giving each stitch's
      average color. The texture would only alias into moiré there.
    - **Caching:** the image covers the view plus a quarter-view margin, and is reused while panning. After a zoom
      change the old image is shown scaled, then re-rendered after 150 ms of rest (`srForce`). `version` bumps on
      pattern or highlight change.
    - **Measured** at 936 × 702, dpr 2, 1500 × 900 view: the old vector ellipses took 1,435 ms per frame at 5 px/stitch,
      292 ms at 8 and 61 ms at 16. The raster version takes 80–105 ms for the first render and 8–20 ms to redraw or
      pan; fit takes 78 ms first, then cached.
  - **10-point blocks** (`state.grosPoint`, default on; the Preview checkbox; `PatternView.setGros`):
    - **What it does:** the Penelope canvas takes 20-point (petit point over single threads) and 10-point (one stitch
      over a 2 × 2 block). A 2 × 2 block whose 4 cells share a thread is drawn as **one big stitch** (the same oval at
      2× scale); mixed blocks keep 4 small stitches.
    - **Fixed block grid:** blocks are anchored at the pattern's top-left (columns 0–1, 2–3, …) and never shift.
      The user explicitly wanted a grid that can't skew.
    - **Cell map geometry:** `cellMap(k, open, geom)` has geom = (cell position in its block)·16 + (which of the 4
      nearby blocks are big). There are 64 geometries, built lazily and cached. Owners are 0–8 (fine neighbours) and
      9–12 (big stitches of the own, horizontal, vertical and diagonal blocks).
    - **Island splitting** (`state.islandMax`, default 1; 0 = off):
      - **What:** the user found scattered single 10-point stitches fiddly to stitch. An island is a group of
        same-thread big blocks connected by an edge or a corner (8-neighbours, "separated by no more than one
        diagonal"). Islands of ≤ islandMax blocks go back to four 20-point stitches each.
      - **One source of truth:** `tenPointBlocks(indices, W, H, islandMax)` in main.js computes the final block map
        once (`pattern.blocks = { BW, BH, t, split, splitBlocks }`). Both the counting and the renderer read it.
      - **On the default pattern:** 1 splits 422 islands, 2 splits 555 and 20 splits 775.
    - **Counting** (`buildPattern` → `pattern.stitches`: thread → `{ big, small }`): each same-thread block is
      one 10-point stitch. Cells of mixed or incomplete edge blocks are 20-point stitches, so big·4 + small = cells.
      The thread list shows 10-pt and 20-pt columns (or one Stitches column when the toggle is off), and the total
      line gives both counts. The toggle recounts (a buildPattern call). The PNG export is still per cell.
    - **Measured:** first renders take 48–112 ms (the most when maps are built at high zoom), redraws 8–22 ms.
  - **Count lines:** bold lines every 10 stitches when they're ≥ 20 px apart (every 100 when those are).
    - **Zoomed out** (< 6 px/stitch): subtle.
    - **Zoomed in:** a light halo under a dark core, so they read on black and pale alike, 1, 2 or 3 px wide
      (from 12 and 24 px/stitch). The user asked for them to be more noticeable at large zoom.
    - **From 16 px/stitch:** dashed 5-stitch lines, also haloed.
- **Zoomed-out / Pixels look:** a 1-px-per-stitch bitmap in 2048² tiles (canvas limits); Pixels mode adds cell lines.

## Performance architecture (keep these properties)
- **All Mandelbrot math runs in Web Workers** (`pool.js` + `worker.js`, one worker per core, row chunks).
  - **Two channels:** 'explorer' and 'pattern'. A new job cancels the previous one on its channel, and explorer chunks
    jump the queue.
  - **Nothing heavy on the main thread** except `buildPattern` (depth → DMC → reduce, ~120 ms at 16M) and the tile bitmaps.
- **Depth is cached.** Palette, mapping or thread-count changes only re-map (no fractal recompute). Recompute happens on
  selection commit (end of drag), size, sampling or maxIter change.
- **Explorer:** progressive rows from workers drawn over the previous render, which is transformed to the current view,
  so pan and zoom preview instantly.
- **Consistent views across resize/fullscreen:** the explorer keeps `state.view.boxW/boxH` (complex units) and
  `PatternView.box` keeps center + size (stitches). These change only on user pan/zoom. On resize, the view keeps the
  center and fits the box ("contain").
- **Inputs:** number inputs commit on `change`, and range sliders use `input` (except the depth slider: preview on input,
  commit on change).
- **Measured:** 16.4M stitches computed + built in ~0.4 s on the user's 10-core Mac (Chrome).

## Save files (`js/savefile.js`)
- **Save:** 💾 Save / Cmd+S opens the `#saveDialog` modal.
  - **A name is required.** Save stays disabled until the name has a file-safe character. The dialog starts empty,
    and the last name is offered as a suggestion.
  - **Why a modal `<dialog>`:** it sits in the top layer, so it works in fullscreen (unlike `prompt()`).
  - **Download:** `<name> - <W>x<H> - <YYYYMMDD-HHMM>.json`. `fileSafe` strips `\ / : * ? " < > |` and control
    characters, and keeps ä/ö.
  - **The name is stored** as the top-level `name` field (↔ `state.saveName`), and loading shows it.
  - **Structure:**
    `{ format: "mandelbrot-cross-stitch", version: 1, name, savedAt, app, selection, view, size, colors, render, threads }`,
  with readable names (`colors.mapping`, `render.maxIterations`, …). `threads` is informational only.
- **Final export** (🧵 in the header and by the PNG exports; `exportChart` in main.js): the stitch-by-stitch chart
  used to make the piece.
  - **Naming:** the same name-required dialog as Save (`openSaveDialog('chart')`), downloading
    `<name> - stitch chart - WxH - <stamp>.json` (~0.8 MB at 936 × 702).
  - **Format** (`format: "mandelbrot-stitch-chart"`, version 1):
    - `threads`: a one-character `symbol` (most used first, from `CHART_SYMBOLS`, never '.'), plus yarn, code, name,
      preview color, cells, stitches10pt/20pt, meters and grams.
    - `rows`: H strings of W symbols, the cell threads including the label.
    - `tenPointRows`: BH strings of BW characters on the fixed 2 × 2 grid; a symbol = one big stitch, '.' = four
      20-point stitches (after island splitting).
    - Also: `size`, `yarn`, `tenPoint`, `totals`, a `howToRead` sentence, and `settings` (the full save file).
  - **Loading it back:** Load accepts a chart and applies its `settings`.
  - **Round-trip test:** rows, symbols and per-thread cells verified against the app, 10-point blocks checked against
    their 4 cells, and the reload restored the same thread list.
- **Load:** 📂 Load or dropping a file applies it by writing the merged state to localStorage and reloading.
  Autosave is suspended during the load.
- **Must stay tolerant as the format grows:**
  - **One table:** every setting is one line in `FIELDS` (file path ↔ state key + validator).
  - **Field by field:** missing, unknown or invalid values are skipped (the current value is kept), numbers are clamped,
    newer versions load with a note, unknown sections are ignored, and the internal localStorage shape is accepted too.
  - **Adding a setting:** add a FIELDS line and don't bump `version`. Bump it only for incompatible renames, and then
    keep reading the old path too.

## Hosting, phone and offline
- **Live on GitHub Pages:** https://kristianroth.github.io/kanavatyo/ (designer) and `…/work.html` (stitching view).
  The repo is `git@github.com:KristianRoth/kanavatyo.git`, branch `main`, served from the root; `.nojekyll` serves
  files as-is. Everything is relative and static, so Netlify Drop also works.
- **Commits:** the user must be the **only author**, with no Claude co-author trailers. Confirm before pushing.
- **The user stitches on an Android phone in Firefox.** The stitching view is an installable PWA:
  - `manifest.webmanifest` (start_url `work.html`, standalone) and `icons/icon-192.png` / `icon-512.png`.
  - `sw.js` is **network-first**: online requests always hit the network, and the cache is only the offline fallback.
    It precaches the stitching view's files. Bump `CACHE` when that list changes.
  - `work.js` registers the SW except on localhost (`?sw=1` forces it), and calls `navigator.storage.persist()`
    after opening a chart.
- **Phone layout** (`work.css`, `@media (max-width: 900px), (pointer: coarse)`, `PHONE` in work.js):
  - The canvas fills the screen. The top bar (`#mPct`, `#mInfo`) shows the total % and the tapped stitch's readout.
  - The bottom toolbar (`.mobile-tools`) has Move, Mark, Unmark, Flood, Undo, Next and ☰.
  - The side panel becomes a slide-up sheet (`body.sheet-open`) with an extra "Chart" section (Open, Fullscreen,
    Designer). Tapping an item highlights it and closes the sheet.
  - `PatternView` gets `budget: 6e6` and `miniSize: 96` on phones.
- **Touch** (`PatternView` options, unused by the designer):
  - `onTap(cell)` fires on a press released within 8 px (touch has no hover), and it sets the readout and crosshair.
  - A second finger during a Mark/Unmark stroke sends `paint.stroke('cancel')`: work.js reverts the stroke with no
    undo entry, and both fingers become a pinch.
  - **Flood acts on tap** (not pointerdown), so dragging with Flood moves the view and a pinch never floods.
- **Progress files** (⬇ Save progress / ⬆ Load progress): `{ format: "mandelbrot-stitch-progress", version: 1,
  chartId, name, W, H, savedAt, doneCells, done }`, with `done` as base-36 run lengths starting with a run of 0s
  (~6 KB). Loading asks when the chart id differs but W × H match. This is the backup, and the way to move progress
  between devices.
- **Tested:**
  - Phone emulation (412 × 915, dpr 2.6, touch pointer events): stroke, cancel-to-pinch, tap readout, flood tap, the
    progress round trip.
  - Offline: SW with `?sw=1`, then stop the server and reload; the page, the chart and the progress all load.

## Running
ES modules don't load from `file://`. Use the **no-cache dev server** (plain `http.server` let the browser keep stale
modules, which made the user think a feature was broken):
```
python3 serve.py          # http://localhost:8765, sends Cache-Control: no-store
```
If the user reports that something doesn't work right after a change, ask them to do a hard reload once (Cmd+Shift+R).
App state persists in localStorage key `mandel-stitch-v2`. Bump it only if the state shape changes incompatibly.

## Testing recipe (headless Chrome; the Claude-in-Chrome extension was never connected)
- **Chrome:** `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --user-data-dir=<fresh dir>
  --window-size=1500,1700 http://localhost:8765/_bench.html &`, then kill it by its profile dir name.
- **Bench page:**
  - **Page:** write a temporary `_bench.html` **in the project root** (same origin, so workers load). Always start it
    with `<meta charset="utf-8">`: without it, non-ASCII text in the test script ("·", "×") gets garbled.
  - **Load and wait:** iframe `index.html`, then wait until `#legend tr` rows exist.
  - **Drive:** use the UI (set values and dispatch `change`/`input` events, `.click()`).
  - **Delete it afterwards.**
- **Reading results:** log with `fetch('/_log?' + encodeURIComponent(msg))`. The request lines appear in the server's
  output file; decode them with `urllib.parse.unquote`.
- **Images:** POST `canvas.toBlob()` to a tiny local receiver (a Python `BaseHTTPRequestHandler` on 127.0.0.1:8766 with
  CORS that writes the body to the scratchpad), then view the PNG. To capture an export, override
  `HTMLAnchorElement.prototype.click` in the iframe and fetch `this.href`.
- **Pointer events:** stub `HTMLCanvasElement.prototype.setPointerCapture = () => {}` before dispatching synthetic
  `PointerEvent`s, and add 1 px of jitter to simulate real clicks.
- **Fullscreen can't be triggered headless:** simulate it by copying `style.css` with `:fullscreen` → `.fs-sim`,
  **disabling the original stylesheet** (its `:not(:fullscreen)` rules otherwise still match), adding that class, plus `position: fixed; inset: 0` (and moving `#colorPanel` into the stage as the JS does).
- **`--screenshot` mode throttles workers** (renders look half done). Prefer capturing canvases as above.
- **Node checks:** Node is v16 (no `structuredClone`, no WebSocket). Syntax-check modules by copying them to a `.mjs`,
  and run pipeline tests by copying `js/*.js` into a scratch dir with `{"type":"module"}` package.json.

## File map
- `serve.py`: no-cache static dev server.
- `work.html`, `work.css`, `js/work.js`: the stitching view (see Stitching view, and Hosting, phone and offline).
- `manifest.webmanifest`, `sw.js`, `icons/`: PWA files for the stitching view.
- `README.md`, `.gitignore`, `.nojekyll`: repo and GitHub Pages files.
- `yarn-options.md`: yarn research (candidates, prices, strands for the canvas, Pirkka dokka order).
- `index.html`: layout (header with save/load, color panel, explorer stage, stitch stage).
- `style.css`: styles; light/dark via CSS variables; fullscreen floating panels; stage layout.
- `js/main.js`: state (DEFAULTS, localStorage), explorer rendering, pattern pipeline (`computePattern`, `buildPattern`),
  all control wiring, fullscreen, save/load, keyboard shortcuts (G, H, F, Esc, Cmd+S).
- `js/mandelbrot.js`: `escapeValue`, `renderRows` (rotated grids, supersampling, clean median), `selectionGrid`,
  `sampleDepthStats`.
- `js/worker.js`, `js/pool.js`: worker entry, and a pool with channels/priority/cancellation.
- `js/palettes.js`: `PRESET_GROUPS`/`PRESETS`, LUT, `makeMapper` (all mappings, crisp-edge separation, edge width, bunching).
- `js/generate.js`: random palette `STYLES`, `generatePalette(style)`, `oklch()`.
- `js/dmc.js`: thread catalogs.
  - **Data:** 441 DMC threads (approximate screen RGB), and `DMC` / `DMC_LAB`, still used by generate.js's DMC styles.
  - **Combined table:** `THREADS` = DMC, then Pirkka, then Rauma, each `{code, name, rgb, brand}`, and `THREAD_LAB`. Pattern
    indices point into THREADS, and DMC indices are unchanged.
  - **Per-yarn lookups:** `YARNS` / `yarnOf(key)` give the per-yarn `ids`. `nearestThread(r, g, b, yarn)` is cached
    per yarn, and `nearestThreadLab(lab, candidates)`.
  - **Codes aren't unique across yarns** (DMC 310 Black vs Pirkka 310 Kuusi), so thread edits are keyed per yarn
    (the yarn is in `gradientKey`).
- `js/rauma.js`: 137 Rauma Finull colors, scraped from raumagarn.no/nb-NO/produkter/finull. Names are translated to
  English (melert = heather, lyng = heath); the codes are Rauma's own, so order by code.
  - **Source:** the embedded product JSON's `variants`, `"<name> - <code>"`. Only 13 color cards are in the HTML;
    the rest load lazily.
  - **Colors:** sampled from each variant's `secondThumbnail`, a knitted close-up, fetched as 256 px through
    `/_next/image` (the 35–85th lightness percentile of the central 80%).
- `js/pirkka.js`: 75 Pirkka wool colors, sampled from the 2024 shade card photo (`~/Downloads/23_pirkka_2024.jpg`,
  the mean of the 35–85th lightness percentile of each swatch center). Approximate.
- `js/quantize.js`: `pickThreads(weights, maxColors, protect)` → `{ threads, remap }`.
- `js/guides.js`: framing guides (`GUIDES`, `ORIENTED`, `drawGuide(ctx, kind, orient, o, U, V, aspect)`).
- `js/label.js`: pixel fonts (`FONTS` 7/5/3 tall), `textBitmap`, `coordinateLabel`, `stampLabel` (the stitched label).
- `js/spectrum.js`: `SpectrumView` (the "Threads along the gradient" thread selector: draw, hit-test, drag).
- `js/selector.js`: explorer overlay and interactions (pan, pinch/wheel zoom, draw/move/resize/rotate, deselect), `wheelZoom`.
- `js/stitch.js`: `PatternView` (tiles, viewport, stitch/pixel looks, overview inset, remembered box, export) and `renderLegend`.
- `js/savefile.js`: `FIELDS`, `buildSave`, `readSave`.

## Conventions
- Plain HTML + CSS + vanilla JS ES modules. No build step, no dependencies, one concern per module. Match the existing
  comment style (short "why" comments).
- **Complex plane:** `view = {cx, cy, scale}`, where scale is complex units per pixel and the imaginary axis points up.
- **Selection:** `sel = {cx, cy, w, rot}` in complex units, height = `w·H/W`, and `rot` in radians counter-clockwise.
  The column axis is (cos, sin) and the row axis (downwards) is (sin, −cos). All sampling goes through
  `selectionGrid()` → `renderRows()` grids `{x0, y0, ux, uy, vx, vy}`.
- **Pattern arrays:** row-major from the top-left; `indices` is a Uint16Array of DMC indices; depth −1 = inside.
- **Default state:** 936 × 702 @ 7.8/cm, Classic palette, cyclic mapping, maxIter 400, 12 threads, 1 sample.
- **Thread colors:** RGB values are approximate screen colors (Pirkka's come from a photo), so real floss or yarn
  will look different.

## Possible next steps (not requested yet)
- Median sampling for the 2×2 / 3×3 modes (their mean is noisier than 1 sample).
- A printable chart export (symbols per thread) and a floss-amount estimate per thread.
- Split max iterations for the explorer vs. the pattern (currently shared on purpose, so the crisp edge matches).
