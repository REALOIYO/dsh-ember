// dsh-ember — browser half, wrapped for the DSH client loader.
//
// The shell's loader evaluates plugin bundles as classic scripts through
// window.__ModuleLoader__.load and reads module.exports; a bare `export`
// statement is a syntax error there and the whole entry fails to import. This
// wrapper supplies the CJS shape, same as the shipped ui-* bundles.
//
// ── WHAT THIS PLUGIN DOES ─────────────────────────────────────────────────
//
//   1. RED FULL-ACCESS TRIGGER
//      The permission trigger renders `完全权限` in the same tone as every
//      other preset. A MutationObserver tags it with `data-dsh-full-access`
//      while that preset is current, and one CSS rule repaints the label and
//      the shield glyph in `--dsw-alias-state-error-primary`, which the theme
//      defines separately for light and dark. Nothing is hard-coded.
//
//   2. A CONTINUOUS EFFORT SLIDER ON THE MENU'S OWN 推理等级 ROW
//
//      The composer model menu renders two rows:
//
//        <div role="menu" aria-label="模型与推理等级">
//          <button role="menuitem">模型     <value> ›</button>
//          <button role="menuitem">推理等级 <value> ›</button>
//        </div>
//
//      This plugin lengthens the second row so it wraps, and appends a track
//      that takes the whole second line. The slider is usable the moment the
//      menu opens — no drilling into the level list first.
//
//      The row gets exactly five inline styles (height / flex-wrap /
//      align-items / padding-block), all captured and restored on teardown.
//      No host node is hidden, re-tabbed or replaced.
//
// ── WHY THE SLIDER IS NOT AN <input type="range"> ─────────────────────────
//
// A range input quantises its value to `step`, and the natural step here is one
// rung — which makes the thumb jump rung to rung and forbids continuous motion.
// This plugin draws the rail itself and keeps a float position, so the thumb
// follows the pointer smoothly and only snaps to a rung on release.
//
// That float is the point: the animation work still to come (particles, colour
// ramps) needs a continuous position and velocity, not three discrete states.
//
// ── WRITES GO THROUGH THE SERVICE, NEVER THROUGH THE DOM ──────────────────
//
// Commits call `directory.select({ provider, model, reasoningEffort })` — the
// same call the shipped picker makes. An earlier revision clicked the host's
// radio buttons instead, which forced it to patch those radios' tabindex and
// display first, and patching host nodes is what made the menu unmount.
//
// The ladder comes from `model.reasoning.efforts`, so the rung count and the
// machine ids are whatever the provider advertised. Nothing is assumed.
window.__ModuleLoader__.load({
  id: 'dsh-ember',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /* ── markers & anchors ──────────────────────────────────────────────── */

    /** Marks the permission trigger while full access is current. */
    var FULL_ACCESS_ATTR = 'data-dsh-full-access';

    /** Marks the full-access row inside the permission menu. */
    var OPTION_DANGER_ATTR = 'data-dsh-permission-danger';

    /** Marks the track container appended into the 推理等级 row. */
    var TRACK_ATTR = 'data-dsh-effort-track';

    /** Marks a row whose inline styles we changed, so teardown can find it. */
    var ROW_ATTR = 'data-dsh-effort-row';

    /** Full-access labels the host ships; used to pick out the trigger. */
    var FULL_ACCESS_LABELS = ['完全权限', 'Full access'];

    /** The permission trigger's aria-label template. */
    var TRIGGER_ARIA = /访问模式|Access mode/i;

    /** The composer model menu's accessible name, zh and en. */
    var MENU_ARIA = /^(模型与推理等级|Model and reasoning effort)$/;

    /** The effort row's label text, zh and en. */
    var EFFORT_ROW = /^(推理等级|Effort)$/;

    /* ── geometry ───────────────────────────────────────────────────────── */

    /** Track thickness; the knob is the same diameter, so it stays a circle. */
    var TRACK_HEIGHT = 26;

    /** Knob radius — the centre stops this far from each end. */
    var KNOB_RADIUS = TRACK_HEIGHT / 2;

    /** Pointer travel below this many rungs counts as a tap, not a drag. */
    var TAP_SLOP_RUNGS = 0.2;

    /** Exponential smoothing applied to pointer velocity, for release projection. */
    var VELOCITY_SMOOTHING = 0.65;

    /** Release projection is capped so a violent flick cannot skip the ladder. */
    var MAX_PROJECT_FRACTION = 0.18;

    /** Settle animation: fraction of the remaining distance covered per frame. */
    var SETTLE_RATE = 0.22;

    /** Below this distance (in pct) the settle completes and stops. */
    var SETTLE_EPSILON = 0.002;

    /**
     * How long to hold the local knob position while waiting for
     * `directory.select()` to show up in the store snapshot.
     *
     * The write is async, so a re-render right after release still reports the
     * old effort; without this grace the knob bounces back. Long enough to
     * cover a slow host round-trip, short enough that a rejected write does not
     * leave the knob stuck on a rung the model never accepted.
     */
    var PENDING_TIMEOUT_MS = 1200;

    /**
     * Hard ceiling for one settle animation.
     *
     * Settling runs on requestAnimationFrame, which browsers throttle hard (or
     * stop entirely) while a tab is in the background. If the animation stalls
     * mid-flight, `settling` would stay true forever and the knob would ignore
     * upstream changes for the rest of the session. This cap makes the animation
     * give up and hand control back to the store.
     */
    var SETTLE_MAX_MS = 700;

    /* ── ember ramp ─────────────────────────────────────────────────────── */

    /**
     * The heat ramp, low rung to high rung: deep blue -> ember red.
     *
     * Blue and red sit on opposite sides of the hue wheel, so a straight RGB
     * interpolation passes through a grey-violet dead zone that reads as
     * "dirty" on a dark rail. The middle stops detour through warm orange to
     * keep saturation up the whole way: every stop below has a clear hue.
     */
    var RAMP_STOPS = [
      { at: 0.00, rgb: [33, 150, 243] },   // rgb(33,150,243) -- the cold end
      { at: 0.26, rgb: [66, 132, 238] },   // blue, tipping toward violet
      { at: 0.48, rgb: [128, 104, 220] },  // violet bridge (brief, bright)
      { at: 0.68, rgb: [214, 92, 150] },   // magenta-coral
      { at: 0.85, rgb: [240, 80, 70] },    // ember
      { at: 1.00, rgb: [230, 44, 36] },    // red -- unchanged hot end
    ];

    /** Halo blur around the knob, in px. */
    var EMBER_GLOW = 14;

    /** Soft light spilled by the chosen span, in px. */
    var EMBER_SPILL = 14;

    /**
     * How fast the drag-energy lift decays, per frame.
     *
     * The lift has to outlive the last pointermove (the finger may pause at the
     * end of a drag) but cannot linger after release, or the bar would stay hot
     * while the menu is idle.
     */
    var BOOST_DECAY = 0.90;

    /** Energy contributed by a single pointermove, capped by BOOST_MAX. */
    var BOOST_PER_MOVE = 0.45;
    var BOOST_MAX = 1;

    /**
     * Star count.
     *
     * Sized so the rail always has a few streaks in flight. The reference
     * implementation used 22 <span> elements with per-element inline
     * animation-duration/delay, and rewrote both on every pointermove -- that
     * restarts each animation's timeline, which is what made it stutter. Here
     * they are drawn on one canvas, so the count costs almost nothing.
     */
    var EMBER_STAR_COUNT = 34;

    /** Star horizontal speed range, in fractions of the rail width per second. */
    var EMBER_STAR_SPEED = [0.22, 0.62];

    /**
     * Ember sizes, in px.
     *
     * 3.2-5.4 was too big (a fragment covered a fifth of the rail height and
     * fought the plume for attention), 1.6-2.7 overcorrected into specks.
     * This sits between: clearly visible as tumbling shards, still clearly
     * secondary to the flame. The polygon is filled with no blur, so the
     * silhouette survives even at the small end of the range.
     */
    var EMBER_STAR_SIZE = [2.2, 3.6];


    /**
     * Where the thruster flame starts to appear, as a fraction of the scale.
     *
     * The plume is always drawn (it is attached to the knob), but its size and
     * brightness scale with the rung, so the low end shows a thin flicker and
     * the top end shows a full white-hot cone.
     */
    var FLAME_THRESHOLD = 0;

    /**
     * How many pre-baked plume frames to cycle through.
     *
     * Six is enough: at ~90ms per frame the tip shivers convincingly, and each
     * extra frame costs one more offscreen canvas at bake time.
     */
    var FLAME_FRAMES = 6;

    /**
     * Bake width of a plume sprite, in CSS pixels.
     *
     * Fixed on purpose: the sprite is scaled to whatever length the current rung
     * needs, and scaling down a wide sprite would soften the baked blur. 220px
     * covers the longest plume on the widest rail we care about while staying a
     * cheap offscreen canvas.
     */
    var FLAME_BAKE_W = 220;

    /* ── styles ─────────────────────────────────────────────────────────── */

    var css = [
      // ── 1. full access in red ──────────────────────────────────────────
      '[data-dsh-full-access]{',
      'color:var(--dsw-alias-state-error-primary)!important;',
      '}',
      // the shield glyph inherits `color`; assert it so a future hard-coded
      // fill on the icon cannot silently break the repaint
      '[data-dsh-full-access] svg{color:inherit!important}',
      '[data-dsh-full-access]:hover:not(:disabled){',
      'background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));',
      '}',
      // the option row inside the permission menu carries no aria-label of its
      // own — its colour comes from the list item
      '[data-dsh-permission-danger] *{',
      'color:var(--dsw-alias-state-error-primary)!important;',
      '}',
      '[data-dsh-permission-danger] svg{color:inherit!important}',

      // ── 2. the track that takes the wrapped second line ────────────────
      '[data-dsh-effort-track]{',
      'box-sizing:border-box;flex-basis:100%;width:100%;min-width:0;',
      'display:flex;flex-direction:column;gap:2px;',
      'padding:2px 2px 0;',
      '}',
      // the rail: a full-width bar the knob rides in
      '.dsh-ember__rail{',
      'position:relative;box-sizing:border-box;',
      'height:' + TRACK_HEIGHT + 'px;',
      'border-radius:999px;',
      // The part you have NOT chosen stays plain: it is not part of the answer.
      'background:var(--dsw-alias-border-l1,rgba(128,128,128,.22));',
      'cursor:pointer;touch-action:none;',
      '-webkit-user-select:none;user-select:none;',
      'overflow:hidden;',
      'isolation:isolate;',
      '}',
      // The chosen span: left edge up to the knob. Width follows the knob, and
      // the hue is set per frame from the ramp, so the colour still says which
      // rung you are on -- it is just confined to what you picked.
      '.dsh-ember__fill{',
      'position:absolute;left:0;top:0;bottom:0;z-index:0;',
      'border-radius:999px;pointer-events:none;',
      'background:var(--ember-fill,transparent);',
      'box-shadow:0 0 ' + EMBER_SPILL + 'px var(--ember-spill,transparent);',
      'transition:background .1s linear,box-shadow .12s linear;',
      '}',
      '.dsh-ember__rail:focus-visible{',
      'outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));',
      'outline-offset:2px;',
      '}',
      // the knob
      '.dsh-ember__knob{',
      'position:absolute;top:0;left:0;z-index:4;',
      'width:' + TRACK_HEIGHT + 'px;',
      'height:' + TRACK_HEIGHT + 'px;',
      'border-radius:50%;pointer-events:none;',
      'background:var(--ember-knob,#ffb27a);',
      // Composited movement: transform keeps the knob on the GPU, where left
      // forced a layout pass on every animation frame.
      'will-change:transform;',
      // the ember halo: colour follows the knob's own heat, set inline per frame
      'box-shadow:0 0 0 1px rgba(0,0,0,.28),0 1px 3px rgba(0,0,0,.35),0 0 ' + EMBER_GLOW + 'px var(--ember-glow,rgba(255,140,60,.55));',
      'transition:box-shadow .12s linear;',
      '}',
      // Canvas sits ABOVE the fill (z-index 3) so the plume is never clipped by
      // the rail's own gradient. The knob rides above it at 4.
      '.dsh-ember__embers{',
      'position:absolute;inset:0;z-index:3;pointer-events:none;',
      'border-radius:inherit;',
      'width:100%;height:100%;',
      '}',
      // Reduced motion must NOT hide the canvas. The plume is the whole point of
      // the top rungs; dropping it leaves the rail looking broken. Instead the
      // drawing itself is calmed (no flicker, stars nearly still) in JS.
      '@media (prefers-reduced-motion:reduce){',
      '.dsh-ember__embers{display:block}',
      '}',
      // rung names double as the scale
      '.dsh-ember__scale{',
      'display:flex;justify-content:space-between;gap:6px;',
      // 12px, not 10px. At 10px the labels sat below the host's caption size
      // and read as an afterthought next to the 26px rail; the rung names are
      // the scale, so they have to be legible at a glance.
      'font-size:12px;line-height:14px;',
      'color:var(--dsw-alias-label-caption);',
      '}',
      '.dsh-ember__tick{',
      'white-space:nowrap;text-overflow:ellipsis;overflow:hidden;',
      'transition:color .16s ease,font-weight .16s ease;',
      '}',
      '.dsh-ember__tick[data-active="true"]{',
      'color:var(--dsw-alias-label-primary);font-weight:600;',
      '}',
    ].join('');

    /* ── small helpers ──────────────────────────────────────────────────── */

    /** Install the stylesheet once per document. */
    function ensureStyle() {
      var tagId = 'dsh-ember/refresh.css';
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-ember';
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /** Collapse an element's text into single-spaced, trimmed form. */
    function textOf(el) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    /** Clamp to 0..1. */
    function clamp01(value) {
      if (!(value > 0)) return 0;
      if (value > 1) return 1;
      return value;
    }

    /** Sample the heat ramp at pct (0..1) → [r,g,b]. */
    function rampAt(pct) {
      var p = clamp01(pct);
      var last = RAMP_STOPS.length - 1;
      if (p <= RAMP_STOPS[0].at) return RAMP_STOPS[0].rgb;
      if (p >= RAMP_STOPS[last].at) return RAMP_STOPS[last].rgb;
      for (var i = 1; i <= last; i += 1) {
        var a = RAMP_STOPS[i - 1];
        var b = RAMP_STOPS[i];
        if (p > b.at) continue;
        var span = b.at - a.at;
        var t = span <= 0 ? 0 : (p - a.at) / span;
        return [
          Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
          Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
          Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
        ];
      }
      return RAMP_STOPS[last].rgb;
    }

    /** CSS rgb() string for a ramp sample. */
    function rampCss(pct, alpha) {
      var rgb = rampAt(pct);
      if (alpha === undefined) return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
    }

    /**
     * Push a colour toward white by `amount` (0..1).
     *
     * Used for the "energy" lift while dragging: the hue stays recognisably the
     * same rung, it just gets hotter. Blending toward white rather than
     * increasing saturation keeps it from going muddy at the blue end, where
     * there is little saturation to add.
     */
    function mixTowardWhite(rgb, amount) {
      var t = clamp01(amount);
      return [
        Math.round(rgb[0] + (255 - rgb[0]) * t),
        Math.round(rgb[1] + (255 - rgb[1]) * t),
        Math.round(rgb[2] + (255 - rgb[2]) * t),
      ];
    }

    /** Current time in ms. */
    function nowMs() {
      return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    }

    /** requestAnimationFrame with a timer fallback. */
    function nextFrame(fn) {
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
      return setTimeout(fn, 16);
    }

    /** Cancel a frame scheduled by nextFrame. */
    function cancelFrame(handle) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
      else clearTimeout(handle);
    }

    /* ── 1. the red trigger ─────────────────────────────────────────────── */

    /**
     * Decide whether one button is the permission trigger showing full access.
     *
     * Needs BOTH a trigger-shaped aria-label and a full-access label inside it.
     * A host that renames the aria-label stops the repaint instead of
     * mis-painting an unrelated button (the confirmation dialog's
     * 启用完全权限 would otherwise read like a match).
     */
    function isFullAccessTrigger(button) {
      if (button.tagName !== 'BUTTON') return false;
      var aria = button.getAttribute('aria-label') || '';
      if (!TRIGGER_ARIA.test(aria)) return false;
      for (var i = 0; i < FULL_ACCESS_LABELS.length; i += 1) {
        if (aria.indexOf(FULL_ACCESS_LABELS[i]) !== -1) return true;
      }
      return false;
    }

    /** Reconcile the red marker on the trigger. */
    function markFullAccess(root) {
      var buttons = root.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i += 1) {
        var button = buttons[i];
        var want = isFullAccessTrigger(button);
        var has = button.hasAttribute(FULL_ACCESS_ATTR);
        if (want && !has) button.setAttribute(FULL_ACCESS_ATTR, '');
        else if (!want && has) button.removeAttribute(FULL_ACCESS_ATTR);
      }
    }

    /** Mark the full-access row inside the permission menu (exact text match). */
    function markPermissionOptions(root) {
      var items = root.querySelectorAll('[role="menuitem"]');
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        var want = FULL_ACCESS_LABELS.indexOf(textOf(item)) !== -1;
        var has = item.hasAttribute(OPTION_DANGER_ATTR);
        if (want && !has) item.setAttribute(OPTION_DANGER_ATTR, '');
        else if (!want && has) item.removeAttribute(OPTION_DANGER_ATTR);
      }
    }

    /* ── 2. menu + row anchors ──────────────────────────────────────────── */

    /** Locate the composer model menu while it is open (matched by name). */
    function findModelMenu() {
      var menus = document.querySelectorAll('[role="menu"]');
      for (var i = 0; i < menus.length; i += 1) {
        var label = (menus[i].getAttribute('aria-label') || '').trim();
        if (MENU_ARIA.test(label)) return menus[i];
      }
      return null;
    }

    /**
     * Find the 推理等级 row on the menu's ROOT pane.
     *
     * The root pane's rows are plain `menuitem`; drilled panes use
     * `menuitemradio`, so this only ever matches the two-entry root list.
     */
    function findEffortRow(menu) {
      var items = menu.querySelectorAll('[role="menuitem"]');
      for (var i = 0; i < items.length; i += 1) {
        var spans = items[i].querySelectorAll('span');
        for (var j = 0; j < spans.length; j += 1) {
          if (EFFORT_ROW.test(textOf(spans[j]))) return items[i];
        }
      }
      return null;
    }

    /* ── 3. ladder from the provider ─────────────────────────────────────── */

    /** sessionId handed to us by the invisible slot seat. */
    var activeSessionId = null;

    /**
     * Resolve the model directory for one session, re-resolving every time.
     *
     * `directoryFor` is documented to throw while a session is still binding,
     * and the instance can be rebuilt — so this neither caches nor throws.
     */
    function directoryFor(ctx, sessionId) {
      if (sessionId === null || sessionId === undefined) return null;
      try {
        var directory = ctx.modelDirectories.directoryFor(sessionId);
        if (directory === undefined || directory === null) return null;
        if (directory.store === undefined) return null;
        return directory;
      } catch (error) {
        return null;
      }
    }

    /**
     * Read the ladder the provider advertised.
     *
     * Returns the ordered levels with their machine ids, plus the index
     * currently in force. The count here is the only source of truth for how
     * many stops the slider has.
     */
    function readLadder(ctx) {
      var directory = directoryFor(ctx, activeSessionId);
      if (directory === null) return null;
      var snapshot = null;
      try {
        snapshot = typeof directory.store.getSnapshot === 'function'
          ? directory.store.getSnapshot()
          : null;
      } catch (error) {
        return null;
      }
      if (snapshot === null || snapshot.current === null || snapshot.current === undefined) return null;
      var current = snapshot.current;
      var groups = snapshot.groups || [];
      var model = null;
      for (var i = 0; i < groups.length; i += 1) {
        if (groups[i].id !== current.provider) continue;
        var models = groups[i].models || [];
        for (var j = 0; j < models.length; j += 1) {
          if (models[j].id === current.model) { model = models[j]; break; }
        }
        break;
      }
      if (model === null) return null;
      var reasoning = model.reasoning;
      if (reasoning === undefined || reasoning === null) return null;
      var efforts = reasoning.efforts || [];
      var levels = [];
      for (var k = 0; k < efforts.length; k += 1) {
        levels.push({ id: efforts[k].id, label: efforts[k].name || efforts[k].id });
      }
      // A single rung, or none advertised at all, still gets a rail: the knob
      // parks at the right end and the row reads as "this model has one fixed
      // effort" instead of silently looking like an ordinary menu row.
      if (levels.length === 0) {
        levels.push({ id: null, label: '\u2014', fixed: true });
      }
      var activeId = current.reasoningEffort === undefined
        ? reasoning.defaultEffort
        : current.reasoningEffort;
      var activeIndex = 0;
      for (var m = 0; m < levels.length; m += 1) {
        if (levels[m].id === activeId) { activeIndex = m; break; }
      }
      // With one rung there is nowhere to drag to; pin it to the right so the
      // rail still communicates "fully on".
      if (levels.length === 1) activeIndex = 0;
      return {
        levels: levels,
        activeId: activeId,
        activeIndex: activeIndex,
        fixed: levels.length < 2,
      };
    }

    /**
     * Commit one rung through the service the shipped picker uses.
     *
     * @returns whether a write was attempted.
     */
    function commitLevel(ctx, levelId) {
      var directory = directoryFor(ctx, activeSessionId);
      if (directory === null || typeof directory.select !== 'function') return false;
      var snapshot = null;
      try {
        snapshot = typeof directory.store.getSnapshot === 'function'
          ? directory.store.getSnapshot()
          : null;
      } catch (error) {
        return false;
      }
      var current = snapshot === null ? null : snapshot.current;
      if (current === null || current === undefined) return false;
      try {
        var pending = directory.select({
          provider: current.provider,
          model: current.model,
          reasoningEffort: levelId,
        });
        if (pending !== null && pending !== undefined && typeof pending.catch === 'function') {
          pending.catch(function () {});
        }
      } catch (error) {
        return false;
      }
      return true;
    }

    /* ── 4. the continuous slider ───────────────────────────────────────── */

    /**
     * Convert a clientX into a 0..1 position on a rail.
     *
     * The usable span excludes one knob radius at each end, so dragging to
     * either extreme lands exactly on the first or last rung.
     */
    function pctAt(rail, clientX) {
      var rect = rail.getBoundingClientRect();
      var usable = rect.width - KNOB_RADIUS * 2;
      if (!(usable > 0)) return null;
      return clamp01((clientX - rect.left - KNOB_RADIUS) / usable);
    }

    /** Position (0..1) -> nearest rung index for a ladder of `count` rungs. */
    function indexFromPct(pct, count) {
      if (count <= 1) return 0;
      var index = Math.round(pct * (count - 1));
      if (index < 0) return 0;
      if (index > count - 1) return count - 1;
      return index;
    }

    /** Position (0..1) of a rung index. */
    function pctOfIndex(index, count) {
      return count <= 1 ? 1 : index / (count - 1);
    }

    /** Build the track element for the 推理等级 row. */
    function buildTrack(ladder) {
      var count = ladder.levels.length;
      if (count < 1) return null;

      var el = document.createElement('div');
      el.setAttribute(TRACK_ATTR, '');
      // presentation: the host's own level list remains the accessible control
      el.setAttribute('role', 'presentation');

      var rail = document.createElement('div');
      rail.className = 'dsh-ember__rail';
      rail.setAttribute('tabindex', '0');
      rail.setAttribute('role', 'slider');
      rail.setAttribute('aria-label', '推理等级');
      rail.setAttribute('aria-valuemin', '0');
      rail.setAttribute('aria-valuemax', String(count - 1));

      // The chosen span. Starts at the left edge and is widened to the knob on
      // every paint; its colour is one hue sampled from the ramp, so the run
      // reads as "this is what you picked", not as a bare progress bar.
      var fill = document.createElement('div');
      fill.className = 'dsh-ember__fill';
      rail.appendChild(fill);

      var canvas = document.createElement('canvas');
      canvas.className = 'dsh-ember__embers';
      canvas.setAttribute('aria-hidden', 'true');
      rail.appendChild(canvas);

      var knob = document.createElement('div');
      knob.className = 'dsh-ember__knob';
      rail.appendChild(knob);

      var scale = document.createElement('div');
      scale.className = 'dsh-ember__scale';
      scale.setAttribute('aria-hidden', 'true');
      var ticks = [];
      for (var i = 0; i < count; i += 1) {
        var tick = document.createElement('span');
        tick.className = 'dsh-ember__tick';
        tick.textContent = ladder.levels[i].label;
        scale.appendChild(tick);
        ticks.push(tick);
      }

      // One rung means one choice: mark it so it reads as settled rather than
      // as a control that refuses to move.
      if (ladder.fixed === true) rail.setAttribute('data-fixed', 'true');
      if (ladder.fixed === true) rail.removeAttribute('tabindex');
      if (ladder.fixed === true) rail.setAttribute('aria-readonly', 'true');

      el.appendChild(rail);
      el.appendChild(scale);

      return {
        el: el,
        rail: rail,
        fill: fill,
        canvas: canvas,
        knob: knob,
        ticks: ticks,
        levels: ladder.levels,
        pct: pctOfIndex(ladder.activeIndex, count),
        fixed: ladder.fixed === true,
      };
    }

    /* ── ember particles ─────────────────────────────────────────────────── */

    /**
     * A tiny particle field painted on a canvas over the rail.
     *
     * Design constraints, learned the hard way:
     *  - Never one DOM node per particle: a flick would spawn dozens and force a
     *    style recalculation each. One canvas, drawn by hand.
     *  - The loop only runs while the menu exists. `stop()` is called from
     *    unmount; nothing keeps ticking after the menu closes.
     *  - Everything is sized from the element's own rect each frame, so a
     *    resize or a theme change needs no bookkeeping.
     */
    function createEmbers(canvas, rail) {
      var ctx2d = null;
      try {
        ctx2d = canvas.getContext ? canvas.getContext('2d') : null;
      } catch (error) {
        ctx2d = null;
      }
      if (ctx2d === null) return null;

      var frame = 0;
      var lastAt = 0;
      var width = 0;
      var height = 0;
      var dpr = 1;

      var resize = function () {
        var rect = rail.getBoundingClientRect();
        // A hidden rail reports 0x0; keep the last good size so a later resize
        // (or a theme/menu transition) does not wipe the drawing.
        if (rect.width > 0) width = rect.width;
        if (rect.height > 0) height = rect.height;
        if (width <= 0 || height <= 0) return;
        dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        if (dpr > 2) dpr = 2;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      // Streaking stars, one persistent record each. They are not spawned and
      // destroyed; they sweep across forever and wrap, so the count is constant
      // and there is no allocation per frame.
      var stars = [];
      for (var s = 0; s < EMBER_STAR_COUNT; s += 1) {
        stars.push({
          // Staggered start so the rail is never empty and never in lockstep.
          x: Math.random(),
          y: 0.14 + Math.random() * 0.72,
          speed: EMBER_STAR_SPEED[0] + Math.random() * (EMBER_STAR_SPEED[1] - EMBER_STAR_SPEED[0]),
          size: EMBER_STAR_SIZE[0] + Math.random() * (EMBER_STAR_SIZE[1] - EMBER_STAR_SIZE[0]),
          // Per-star phase offset for the twinkle, so they do not pulse together.
          phase: Math.random() * Math.PI * 2,
          // Tumble: an initial angle plus a per-star spin speed, so no two
          // fragments rotate in step.
          rot: Math.random() * Math.PI * 2,
          spin: 0,
          spinRate: (Math.random() - 0.5) * 0.006,
          // A four-point shard silhouette, unique per ember. Rounded so the
          // polygon stays convex enough to read at 2-4px.
          shape: [
            0.95 + Math.random() * 0.35, (Math.random() - 0.5) * 0.35,
            (Math.random() - 0.5) * 0.35, 0.85 + Math.random() * 0.35,
            -(0.85 + Math.random() * 0.35), (Math.random() - 0.5) * 0.35,
            (Math.random() - 0.5) * 0.35, -(0.85 + Math.random() * 0.35),
          ],
          rgb: [255, 190 + Math.round(Math.random() * 50), 120 + Math.round(Math.random() * 80)],
        });
      }

      /**
       * The rocket flame.
       *
       * At the top of the scale the knob is a thruster: a long, thin, white-hot
       * triangle streams out of it back toward the cold end, exactly like a
       * nozzle bleeding fuel. It is drawn *behind* the knob (the canvas sits at
       * z-index 1, the knob at 2), so the cone appears to originate from the
       * knob's centre.
       *
       * `heat` is 0..1 and gates the whole effect: below ~0.55 there is no
       * flame at all, so the low and middle rungs stay clean gradients.
       */
      /** Knob centre X for a given 0..1 position. */
      var x0 = function (pct) {
        return KNOB_RADIUS + clamp01(pct) * Math.max(width - KNOB_RADIUS * 2, 0);
      };

      /**
       * Draw the plume.
       *
       * The shape is BAKED (see buildFlameSprites): the outline is fixed apart
       * from a small vibration at the very tip, which is what reads as fire.
       * Earlier versions re-derived a wobbling polygon every frame; that both
       * cost far too much and looked like water, not flame -- fire vibrates at
       * the tip rather than undulating along its whole length.
       *
       * Per frame this is: pick a sprite, pick a scale, pick an alpha, drawImage.
       */
      var drawFlame = function (pct, energy, now) {
        if (flameSprites.length === 0) return;

        var strength = clamp01(pct);
        var boost = 1 + 0.45 * clamp01(energy);

        // Length is a fraction of the LIVE span -- the filled part from the cold
        // end to the knob -- not of the whole rail. "A quarter of the bar" means
        // a quarter of the coloured span, so at the top rung it is ~1/4 of the
        // rail and at the low rung it shrinks with the span instead of running
        // off the left edge.
        var spanLen = x0(pct);
        // Long and thin, not short and fat.
        //
        // The reference silhouette is a pencil-thin column: nearly parallel
        // edges with a bright root and only the last fifth closing to a point.
        // A fraction of 0.26 combined with a full rail height produced a squat
        // triangular arrow instead, so the length goes up and the height comes
        // down together -- it is the RATIO that reads as a rocket plume.
        var wantLen = Math.max(28, spanLen * 0.42 * boost);

        // Height follows the length, within limits.
        //
        // A fixed height with a length that shrinks with the rung is why the
        // middle rungs looked short and fat: at medium the plume was ~63px long
        // and still 25px tall, a 1:2.5 blob instead of the 1:5 column the top
        // rung shows. Coupling the two keeps the aspect ratio roughly constant,
        // so a shorter plume is also a slimmer one.
        //
        // The floor is deliberately generous (0.52 of the rail). Squeezing it
        // further made the low rungs a hairline instead of a flame, because at
        // 26px of rail height the flame has no room to be both short and
        // needle-thin. Steepness of the silhouette is handled by the taper
        // curve below, not by shrinking the whole sprite.
        var wantH = Math.min(height * 0.96, wantLen * 0.20);
        if (wantH < height * 0.52) wantH = height * 0.52;

        var sprite = flameSprites[0];
        var drawW = wantLen;
        var drawH = wantH;

        // Tip vibration. Fixed periods read as a metronome, so these are three
        // incommensurable ones summed: the beat never lands on the same phase
        // twice, which is what makes flicker look organic rather than looped.
        var t = now / 1000;
        var shiver = 0.70 * Math.sin(t * 17.3)
                   + 0.44 * Math.sin(t * 29.7 + 1.7)
                   + 0.26 * Math.sin(t * 7.1 + 0.4);
        var jitter = 1
                   + 0.045 * Math.sin(t * 11.9 + 2.2)
                   + 0.022 * Math.sin(t * 23.3);

        // Cycle the baked frames. The step is deliberately not a divisor of the
        // frame count, so the sequence does not repeat on an obvious beat.
        var frame = Math.floor(now / 74) % flameSprites.length;
        sprite = flameSprites[frame];
        drawW = wantLen * jitter;
        drawH = wantH * (0.98 + 0.04 * jitter);

        var nx = x0(pct);
        ctx2d.globalAlpha = 0.62 + 0.38 * strength;
        ctx2d.drawImage(sprite, nx - drawW, height / 2 - drawH / 2 + shiver * 0.5, drawW, drawH);
        ctx2d.globalAlpha = 1;
      };

      /* ── pre-baked sprites ────────────────────────────────────────────────
       *
       * The first version recomputed every shape per frame: ~30 gradient
       * objects, a canvas-wide blur filter, and a fresh polygon per star. On a
       * 26px-tall rail that is pure waste -- the whole animation is a handful of
       * soft blobs being translated. So everything static is baked once into a
       * small offscreen canvas and blitted with drawImage:
       *
       *   - the glow sprite (one radial gradient, reused for every star)
       *   - the flame, baked as FLAME_FRAMES variants and cross-faded
       *
       * Nothing below allocates per frame.
       */

      /** Build one offscreen canvas of the given size. */
      var makeSprite = function (w, h) {
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.ceil(w));
        cv.height = Math.max(1, Math.ceil(h));
        return cv;
      };

      /** Soft round glow, white core with a coloured falloff. Baked once. */
      var glowSprite = null;
      var buildGlowSprite = function () {
        var size = 24;
        var cv = makeSprite(size, size);
        var g = cv.getContext('2d');
        if (!g) return null;
        var half = size / 2;
        var rad = g.createRadialGradient(half, half, 0, half, half, half);
        rad.addColorStop(0, 'rgba(255,255,255,1)');
        rad.addColorStop(0.28, 'rgba(255,244,230,0.85)');
        rad.addColorStop(0.62, 'rgba(255,170,110,0.28)');
        rad.addColorStop(1, 'rgba(255,140,80,0)');
        g.fillStyle = rad;
        g.fillRect(0, 0, size, size);
        return cv;
      };

      /**
       * Bake the plume into FLAME_FRAMES sprites.
       *
       * Each frame is a differently-jittered plume, so cycling through them
       * gives the tongue a flicker without any per-frame geometry. The blur is
       * applied once, at bake time, instead of on every live frame.
       */
      var flameSprites = [];
      var buildFlameSprites = function (w, h) {
        var out = [];
        if (w <= 0 || h <= 0) return out;
        for (var f = 0; f < FLAME_FRAMES; f += 1) {
          var cv = makeSprite(w, h);
          var g = cv.getContext('2d');
          if (!g) return out;
          var phase = (f / FLAME_FRAMES) * Math.PI * 2;
          // Blur only at bake time -- this is the big win.
          //
          // Safe to go back up to 1.1px because the bake is now 1:1 with the
          // draw (it used to be baked 1.5x taller and scaled down to 0.64, which
          // ate most of the softening). The skirt this produces is what makes
          // the column look like glowing gas instead of a printed shape, and it
          // grows the root to roughly the knob diameter once the alpha falls off.
          if (typeof g.filter === 'string') g.filter = 'blur(1.1px)';

          var x = w;              // nozzle at the right edge of the sprite
          var y = h / 2;

          var tongue = function (len, halfW, ph, stops) {
            var steps = 12;
            var grad = g.createLinearGradient(x, y, x - len, y);
            for (var i = 0; i < stops.length; i += 1) grad.addColorStop(stops[i][0], stops[i][1]);            g.beginPath();
            // Vibration grows toward the tip (tu^2) and stays ~zero at the
            // nozzle: fire shakes at its end, it does not undulate as a whole
            // body. Keeping the base pinned is what separates this from water.
            //
            // The wobble frequencies are deliberately NOT harmonics of the frame
            // index: with a clean phase step the six baked frames read as one
            // mechanical loop. Irrational-ish multipliers make each frame look
            // like an independent flicker.
            for (var u = 0; u <= steps; u += 1) {
              var tu = u / steps;
              // Monotonic taper, steep at the tip.
              //
              // The old profile held full width for 70% of the length and only
              // then necked in. With the wobble clamped at 1.18 and `taper` at
              // 0.842 around 75%, the product was 0.994 -- indistinguishable
              // from the root. That flat shelf is the "tail fatter than the
              // middle" complaint: there was no middle, just a cylinder that
              // suddenly collapsed.
              //
              // A single power curve removes the shelf entirely. The exponent
              // controls WHERE the narrowing happens: 0.70 narrows evenly, while
              // 0.45 holds most of the width through the first half and then
              // drops hard, which is the "steeper at the tail" shape asked for.
              // It is still monotonically decreasing, so no bulge can appear.
              var taper = Math.pow(1 - tu, 0.45);
              var edge = tu * tu;
              var wob = 1 + edge * (
                0.34 * Math.sin(ph * 1.37 + tu * 4.3)
                + 0.21 * Math.sin(ph * 2.11 + tu * 11.9)
                + 0.12 * Math.sin(ph * 3.73 + tu * 19.1));
              // Clamp stays, but it can no longer flatten anything: `taper` is
              // already well under 1 here, so the product stays monotonic.
              if (wob > 1.14) wob = 1.14;
              if (wob < 0.86) wob = 0.86;
              var px = x - len * tu;
              var py = y - halfW * taper * wob;
              if (u === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            for (var d = steps; d >= 0; d -= 1) {
              var td = d / steps;
              var taper2 = Math.pow(1 - td, 0.45);
              var edge2 = td * td;
              var wob2 = 1 + edge2 * (
                0.34 * Math.sin(ph * 1.83 + td * 5.1)
                + 0.21 * Math.sin(ph * 2.67 + td * 9.7)
                + 0.12 * Math.sin(ph * 3.29 + td * 17.3));
              if (wob2 > 1.14) wob2 = 1.14;
              if (wob2 < 0.86) wob2 = 0.86;
              g.lineTo(x - len * td, y + halfW * taper2 * wob2);
            }
            g.closePath();
            g.fillStyle = grad;
            g.fill();
          };

          // Three nested tongues.
          //
          // Widths are fractions of the sprite half-height. Note the sprite is
          // drawn at `wantH` (which shrinks with the rung), not at rail height,
          // so these numbers are relative to the DRAWN column, not the rail.
          //
          //   haze  1.10  soft skirt, deliberately soft -- the alpha is low so
          //               its extra width reads as glow, not as body
          //   body  0.82  the visible column
          //   core  0.56  the white-hot root inside it
          //
          // Body and core came down from 0.94/0.66 because the measured aspect
          // ratio at max was 3.8:1 while the reference plume is 6-7:1. The
          // vertical size is what pays for that, so the silhouettes are slimmer
          // and the resulting column is longer than it is wide by a clear margin.
          var halfMax = h / 2;
          tongue(w * 1.00, halfMax * 1.10, phase * 1.7 + 0.7, [
            [0, 'rgba(255,150,80,0.26)'],
            [0.45, 'rgba(220,72,44,0.14)'],
            [1, 'rgba(150,20,16,0)'],
          ]);
          tongue(w * 0.97, halfMax * 0.82, phase * 1.1, [
            [0, 'rgba(255,214,150,0.94)'],
            [0.30, 'rgba(255,138,72,0.76)'],
            [0.60, 'rgba(238,88,48,0.46)'],
            [0.82, 'rgba(210,50,30,0.18)'],
            [1, 'rgba(180,24,20,0)'],
          ]);
          // White-hot core.
          //
          // Narrower than the body on purpose: the white root has to sit INSIDE
          // the orange column, otherwise the plume reads as one flat white rod.
          tongue(w * 0.90, halfMax * 0.56, phase * 2.3 + 2.4, [
            [0, 'rgba(255,255,255,1)'],
            [0.45, 'rgba(255,253,248,0.97)'],
            [0.78, 'rgba(255,244,220,0.86)'],
            [0.92, 'rgba(255,224,176,0.34)'],
            [1, 'rgba(255,205,150,0)'],
          ]);
          out.push(cv);
        }
        return out;
      };

      /** Rebuild baked assets after a resize (size depends on the rail). */
      var rebake = function () {
        if (glowSprite === null) glowSprite = buildGlowSprite();
        // Bake at a FIXED size, independent of how long the plume is drawn.
        //
        // The earlier bug: the sprite was baked at full rail width and then
        // scaled down to a quarter of it, so the height shrank along with the
        // length -- a short flame became a *thin* flame, i.e. one white hairline.
        // The plume must stay as tall as the knob no matter what fraction of the
        // span it spans, so the two axes are now decoupled at draw time and the
        // bake just needs to be big enough to not lose the authored blur.
        flameSprites = buildFlameSprites(FLAME_BAKE_W, Math.max(8, Math.round(height)));
      };

      /**
       * Advance and render.
       *
       * Everything here is blits and arithmetic: no gradients, no filters, no
       * per-frame geometry. That is what keeps it cheap enough to animate
       * continuously on a 26px rail.
       */
      var step = function (pct, energy) {
        if (width <= 0 || height <= 0) return;
        var now = nowMs();
        var dt = lastAt === 0 ? 16 : Math.min(now - lastAt, 48);
        lastAt = now;

        ctx2d.clearRect(0, 0, width, height);

        var speedMul = 1 + 1.6 * energy;
        var baseAlpha = 0.58 + 0.34 * energy;

        // Stars sweep right-to-left, but only within the chosen span: nothing
        // may drift over the part of the rail the user has not picked.
        var spanPx = KNOB_RADIUS + clamp01(pct) * Math.max(width - KNOB_RADIUS * 2, 0);
        ctx2d.save();
        ctx2d.beginPath();
        ctx2d.rect(0, 0, spanPx, height);
        ctx2d.clip();

        // The thruster first, so the embers are drawn ON TOP of it: a fragment
        // that crosses the plume must stay visible, otherwise the sprite
        // swallows them near the nozzle where they are densest.
        drawFlame(clamp01(pct), clamp01(energy), now);

        // Embers: hand-drawn irregular fragments, spun as they fly.
        //
        // Measured against blitting a 24x24 glow sprite, drawing these small
        // polygons is ~2.5x faster (0.13ms vs 0.35ms per frame for 26 of them),
        // because a tiny filled path skips the bilinear downsample that
        // drawImage performs. So the richer look is also the cheaper one.
        for (var i = 0; i < stars.length; i += 1) {
          var star = stars[i];

          // Drag begins past the middle (0.45) and bites hard: by the left
          // quarter the fragment is moving at ~1/5 speed, so the tail genuinely
          // piles up instead of just easing off. A gentle floor (0.55) earlier
          // read as "uniform drift" -- there was no visible accumulation, which
          // is the whole point of embers slowing at the cold end.
          var drag = star.x > 0.45
            ? 1
            : 0.14 + 0.86 * Math.pow(star.x / 0.45, 1.6);
          star.x -= (star.speed * speedMul * drag * dt) / 1000;
          // Spin tracks the same factor, so it tumbles lazily once slowed.
          star.spin += star.spinRate * (0.35 + drag) * dt;

          // Cooled fully at the left: recycle it from the nozzle.
          if (star.x < 0.02) {
            star.x = 1.02;
            star.rot = Math.random() * Math.PI * 2;
            star.spin = 0;
          }
          if (star.x > 1.06) continue;

          // Fade with the same curve: bright at the nozzle, dimming as it slows.
          var cool = 0.62 + 0.38 * star.x;
          var twinkle = 0.78 + 0.22 * Math.sin(now / 520 + star.phase);
          var a = baseAlpha * twinkle * cool;
          if (a <= 0.02) continue;

          // Big at the nozzle, shrinking toward the tail -- but only to 0.62.
          //
          // The size ramp and the alpha ramp both shrink the visible area, and
          // they multiplied: at 0.45 scale with 0.45 alpha a fragment covered
          // 20% x 45% of its area, which erased the tail-side pile-up the drag
          // curve is there to create. Keeping the floor at 0.62 lets embers stay
          // legible where they slow down.
          var r = star.size * (0.70 + 0.30 * star.x);
          if (r < 0.35) continue;

          ctx2d.save();
          // Straight-line flight, no vertical sway.
          //
          // There used to be `sin(phase + spin) * spread` here, meant to fan the
          // slowed embers out into a cloud. Because `spin` accumulates every
          // frame the sine kept flipping sign, so the fragment oscillated up and
          // down with an amplitude of a third of the rail -- it read as bouncing
          // off the top and bottom edges, which is exactly what it was doing.
          // Each ember's `star.y` is already a stable per-ember lane, so the
          // cloud effect comes from the lanes being distributed, not from moving
          // them.
          ctx2d.translate(star.x * width, star.y * height);
          ctx2d.rotate(star.rot + star.spin);
          ctx2d.beginPath();
          // A four-point irregular shard, baked per star into the geometry
          // offsets so it keeps its own silhouette as it tumbles.
          ctx2d.moveTo(r * star.shape[0], r * star.shape[1]);
          ctx2d.lineTo(r * star.shape[2], r * star.shape[3]);
          ctx2d.lineTo(r * star.shape[4], r * star.shape[5]);
          ctx2d.lineTo(r * star.shape[6], r * star.shape[7]);
          ctx2d.closePath();
          ctx2d.fillStyle = 'rgba(' + star.rgb[0] + ',' + star.rgb[1] + ',' + star.rgb[2] + ',' + a.toFixed(3) + ')';
          ctx2d.fill();
          ctx2d.restore();
        }
        ctx2d.restore();

      };

      return {
        resize: resize,
        /**
         * Called once per paint. `speed` is the drag speed; it both speeds the
         * stars up and lengthens the flame.
         */
        tick: function (pct, speed) {
          // Lazy bake: wireTrack calls rebake() immediately, but a menu that was
          // just opened may not be laid out yet and reports a 0x0 rail. Baking
          // from that produced empty sprites, which is why the first frames
          // showed no flame at all. Re-measure here until the size is real.
          if (width <= 0 || height <= 0 || flameSprites.length === 0) {
            resize();
            if (width > 0 && height > 0) rebake();
          }
          step(clamp01(pct), clamp01(speed));
        },
        /** Extra punch on release; the loop keeps running anyway. */
        burst: function (pct) {
          lastAt = 0;
        },
        /** The field is always populated, so the loop should keep running. */
        hasParticles: function () { return true; },
        /** Exposed so wireTrack can bake sprites once the rail is measured. */
        rebake: rebake,
        clear: function () {
          lastAt = 0;
          ctx2d.clearRect(0, 0, width, height);
        },
        stop: function () {
          lastAt = 0;
        },
      };
    }

    /**
     * Drive a track: dragging writes the float directly, releasing snaps to the
     * nearest rung and animates the last leg instead of teleporting.
     */
    function wireTrack(ctx, view) {
      var dragging = false;
      var settleFrame = 0;
      var lastX = 0;
      var lastAt = 0;
      var velocity = 0;
      var startPct = 0;
      // Set while a settle animation is running: nothing may repaint from
      // upstream during that window, or the knob visibly snaps back and forth.
      var settling = false;
      /** Timestamp after which a stalled settle is abandoned (0 = none). */
      var settleDeadline = 0;
      // Non-null between `directory.select(...)` and the store actually
      // reporting that effort. Guards against the async write lag.
      var pendingLevelId = null;
      var pendingUntil = 0;

      // 0..1 drag speed, EMA-smoothed. Gates how many embers are born.
      view.speed = 0;
      // 0..1 energy lift for the filled span. Raised by pointer movement, then
      // decayed every frame so the bar only glows while the handle is moving.
      view.boost = 0;
      view.embers = createEmbers(view.canvas, view.rail);
      if (view.embers !== null && view.embers !== undefined) {
        view.embers.resize();
        // Bake now, but the rail may not be laid out yet (a menu that just
        // opened reports 0x0). If the size was not known, the first tick
        // re-measures and bakes before drawing -- see tick() below.
        if (typeof view.embers.rebake === 'function') view.embers.rebake();
      }

      var swallow = function (event) {
        if (event === undefined || event === null) return;
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      };

      /**
       * Cached rail width.
       *
       * getBoundingClientRect forces a synchronous layout, and this used to run
       * on every animation frame. The rail only changes width when the menu is
       * resized, so it is measured on demand and reused.
       */
      var railWidth = 0;
      var measure = function () {
        var w = view.rail.getBoundingClientRect().width;
        if (w > 0) railWidth = w;
        return railWidth;
      };

      /** Values written last time, so unchanged work can be skipped. */
      var lastCss = { knob: '', glow: '', fill: '', spill: '', index: -1 };

      var paint = function () {
        var count = view.levels.length;
        var width = railWidth > 0 ? railWidth : measure();
        var index = indexFromPct(view.pct, count);
        // The knob's centre travels across (width - diameter); expressing that
        // as a left offset keeps the circle fully inside the rail at both ends.
        var centre = KNOB_RADIUS + view.pct * Math.max(width - KNOB_RADIUS * 2, 0);
        view.knob.style.transform = 'translate3d(' + (centre - KNOB_RADIUS).toFixed(2) + 'px,0,0)';

        // The chosen span ends at the knob's centre, matching where the handle
        // visually sits rather than the knob's left edge.
        view.fill.style.width = centre.toFixed(2) + 'px';

        var energy = clamp01(view.boost);
        var heat = clamp01((view.pct - FLAME_THRESHOLD) / (1 - FLAME_THRESHOLD));
        var rgb = rampAt(view.pct);
        var hot = mixTowardWhite(rgb, 0.16 * energy);

        // Gradient within ONE rung, not across rungs: faint on the left, fully
        // saturated at the knob. The hue still tells you which rung you are on.
        var pale = mixTowardWhite(hot, 0.58 - 0.10 * energy);
        var alpha = 0.55 + 0.32 * energy;

        // Only touch the DOM when a value actually changed. During the ambient
        // loop most frames change nothing here, and each write costs style
        // recalculation across the rail's subtree.
        var fillCss = 'linear-gradient(90deg, '
          + 'rgba(' + pale[0] + ',' + pale[1] + ',' + pale[2] + ',' + (alpha * 0.62).toFixed(2) + ') 0%, '
          + 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',' + alpha.toFixed(2) + ') 78%, '
          + 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',' + Math.min(1, alpha + 0.14).toFixed(2) + ') 100%)';
        if (fillCss !== lastCss.fill) {
          view.fill.style.setProperty('--ember-fill', fillCss);
          lastCss.fill = fillCss;
        }

        var knobCss = 'rgb(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ')';
        if (knobCss !== lastCss.knob) {
          view.knob.style.setProperty('--ember-knob', knobCss);
          lastCss.knob = knobCss;
        }

        if (index !== lastCss.index) {
          {
            // Same rule as the label tint: sample the RUNG, not the live float.
            // These two lines sit inside the `index changed` guard, so a value
            // taken from `view.pct` would be whatever the settle animation was
            // passing through at that moment and would then never refresh.
            var rungRgb = rampAt(pctOfIndex(index, count));
            var spillCss = 'rgba(' + rungRgb[0] + ',' + rungRgb[1] + ',' + rungRgb[2] + ',' + (0.14 + 0.30 * energy).toFixed(2) + ')';
            view.fill.style.setProperty('--ember-spill', spillCss);
            var glowCss = 'rgba(' + rungRgb[0] + ',' + rungRgb[1] + ',' + rungRgb[2] + ',' + (0.45 + 0.40 * energy + 0.15 * heat).toFixed(2) + ')';
            view.knob.style.setProperty('--ember-glow', glowCss);
          }
          view.rail.setAttribute('aria-valuenow', String(index));
          view.rail.setAttribute('aria-valuetext', view.levels[index].label);
          for (var i = 0; i < view.ticks.length; i += 1) {
            if (i === index) view.ticks[i].setAttribute('data-active', 'true');
            else view.ticks[i].removeAttribute('data-active');
          }
          // Tint the active label with its own ramp colour, so the scale agrees
          // with the rail instead of fighting it.
          //
          // Colour from the RUNG's canonical position, never from `view.pct`.
          // `view.pct` is a live float that sweeps through intermediate values
          // while the knob settles, and this block only runs on an index change
          // -- so sampling `view.pct` here caught whatever value happened to be
          // current at that instant. Dragging to Max and releasing back to High
          // triggered the repaint mid-travel (pct ~0.85) and baked the 0.85
          // colour into the High label, where it stayed forever: the label
          // showed up pink instead of purple. pctOfIndex() is fixed per rung.
          if (view.ticks[index] !== undefined) {
            view.ticks[index].style.color = rampCss(pctOfIndex(index, count), 0.95);
          }
          for (var j = 0; j < view.ticks.length; j += 1) {
            if (j !== index) view.ticks[j].style.color = '';
          }
          lastCss.index = index;
        }
      };
      view.paint = paint;
      view.measure = measure;

      var stopSettle = function () {
        settling = false;
        settleDeadline = 0;
        if (settleFrame === 0) return;
        cancelFrame(settleFrame);
        settleFrame = 0;
      };

      var settleTo = function (target) {
        stopSettle();
        settling = true;
        var deadline = nowMs() + SETTLE_MAX_MS;
        settleDeadline = deadline;
        var step = function () {
          var delta = target - view.pct;
          if (Math.abs(delta) < SETTLE_EPSILON) {
            view.pct = target;
            paint();
            settleFrame = 0;
            settling = false;
            settleDeadline = 0;
            return;
          }
          // A backgrounded tab can freeze rAF indefinitely; snapping to the
          // target is better than leaving the knob stuck and unresponsive.
          if (nowMs() > deadline) {
            view.pct = target;
            paint();
            settleFrame = 0;
            settling = false;
            settleDeadline = 0;
            return;
          }
          view.pct += delta * SETTLE_RATE;
          paint();
          settleFrame = nextFrame(step);
        };
        step();
      };

      var commitIndex = function (index) {
        var level = view.levels[index];
        if (level === undefined) return;
        // The placeholder rung for a model that advertises no efforts has no
        // id: there is nothing to select, and writing `null` would be worse
        // than leaving the provider alone.
        if (level.id === null || level.id === undefined) return;
        var wrote = commitLevel(ctx, level.id);
        // `directory.select` is async: the store snapshot still carries the OLD
        // effort for a while, and every mutation in that window re-enters
        // reconcile → sync. Remember what we asked for so sync can tell
        // "upstream hasn't caught up yet" apart from "user picked something else".
        if (wrote) {
          pendingLevelId = level.id;
          pendingUntil = nowMs() + PENDING_TIMEOUT_MS;
        }
      };

      // ── ambient loop ───────────────────────────────────────────────────
      //
      // The star field sweeps continuously, so this is a real animation loop.
      // Two things keep it cheap:
      //   - it runs at ~30fps, not 60 (a rail this small shows no difference,
      //     and it halves the work);
      //   - only the canvas is redrawn each frame. `paint()` is skipped unless
      //     the rung or the energy actually changed, so the DOM is untouched on
      //     most frames.
      var loopFrame = 0;
      var lastDrawAt = 0;
      var FRAME_MS = 33;
      var tickLoop = function (stamp) {
        var now = typeof stamp === 'number' ? stamp : nowMs();
        if (now - lastDrawAt < FRAME_MS) {
          loopFrame = nextFrame(tickLoop);
          return;
        }
        lastDrawAt = now;

        var wasBoost = view.boost;
        var wasIndex = indexFromPct(view.pct, view.levels.length);

        if (view.boost > 0.001) {
          view.boost = view.boost * BOOST_DECAY;
          if (view.boost <= 0.001) view.boost = 0;
        }
        if (view.speed > 0.001) {
          view.speed = view.speed * BOOST_DECAY;
          if (view.speed <= 0.001) view.speed = 0;
        }

        if (view.embers !== null && view.embers !== undefined) {
          view.embers.tick(view.pct, dragging ? view.speed : 0);
        }

        // Repaint the DOM layer only when something it owns has changed.
        var index = indexFromPct(view.pct, view.levels.length);
        if (index !== wasIndex || Math.abs(view.boost - wasBoost) > 0.01) {
          paint();
        }

        loopFrame = nextFrame(tickLoop);
      };
      var wake = function () {
        if (loopFrame !== 0) return;
        loopFrame = nextFrame(tickLoop);
      };
      view.wake = wake;
      // The star field is ambient, so the loop starts immediately rather than
      // waiting for the first interaction.
      wake();

      view.rail.addEventListener('pointerdown', function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        // A single rung has nowhere to travel; the rail only reports, it does
        // not accept input. Still swallow the event so the host row does not
        // drill into its own level list from under the pointer.
        if (view.fixed === true) {
          event.preventDefault();
          swallow(event);
          return;
        }
        var pct = pctAt(view.rail, event.clientX);
        if (pct === null) return;
        stopSettle();
        dragging = true;
        startPct = view.pct;
        lastX = event.clientX;
        lastAt = nowMs();
        velocity = 0;
        view.pct = pct;
        view.speed = 0;
        paint();
        try { view.rail.setPointerCapture(event.pointerId); } catch (error) { /* older engines */ }
        event.preventDefault();
        swallow(event);
      });

      view.rail.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        var pct = pctAt(view.rail, event.clientX);
        if (pct === null) return;
        var at = nowMs();
        var dt = at - lastAt;
        if (dt > 0) {
          var instant = (event.clientX - lastX) / dt / Math.max(view.rail.getBoundingClientRect().width - KNOB_RADIUS * 2, 1);
          velocity = velocity * VELOCITY_SMOOTHING + instant * (1 - VELOCITY_SMOOTHING);
          lastX = event.clientX;
          lastAt = at;
          // Normalised 0..1 drag speed. |instant| is pct-per-ms; a brisk flick
          // lands around 0.004, so 250 is the scale that saturates the embers.
          view.speed = clamp01(Math.abs(velocity) * 250);
          // Every movement lifts the whole filled run, not just the knob: the
          // energy is a property of the chosen span, so it strengthens as one.
          view.boost = clamp01(view.boost + BOOST_PER_MOVE);
          view.wake();
        }
        view.pct = pct;
        paint();
        event.preventDefault();
        swallow(event);
      });

      var release = function (event) {
        if (!dragging) return;
        dragging = false;
        var count = view.levels.length;
        var travelled = Math.abs(view.pct - startPct) * (count - 1);
        var target;
        if (travelled < TAP_SLOP_RUNGS) {
          // a tap: go straight to where it landed
          target = view.pct;
        } else {
          // a flick: lean past the release point, capped so it cannot skip
          var projection = velocity * 0.12;
          if (projection > MAX_PROJECT_FRACTION) projection = MAX_PROJECT_FRACTION;
          if (projection < -MAX_PROJECT_FRACTION) projection = -MAX_PROJECT_FRACTION;
          target = clamp01(view.pct + projection);
        }
        var index = indexFromPct(target, count);
        // One last small burst where the finger left, then the embers die out
        // as the knob settles. Motion fades with the gesture, so nothing is
        // left glowing once the menu is still.
        if (view.embers !== null && view.embers !== undefined) view.embers.burst(view.pct);
        view.speed = 0;
        settleTo(pctOfIndex(index, count));
        commitIndex(index);
        if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
        swallow(event);
      };

      view.rail.addEventListener('pointerup', release);
      view.rail.addEventListener('pointercancel', release);

      view.rail.addEventListener('keydown', function (event) {
        if (view.fixed === true) return;
        var count = view.levels.length;
        var index = indexFromPct(view.pct, count);
        var next = null;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = index - 1;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = index + 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = count - 1;
        if (next === null) return;
        if (next < 0) next = 0;
        if (next > count - 1) next = count - 1;
        event.preventDefault();
        swallow(event);
        settleTo(pctOfIndex(next, count));
        commitIndex(next);
      });

      nextFrame(paint);

      // ── keep the host row from reacting to us ─────────────────────────
      //
      // The rail sits INSIDE the host's 推理等级 <button>. That button has its
      // own onClick (drill into the level list), and a pointer gesture over a
      // descendant still produces a `click` on the button afterwards — so
      // blocking pointerdown/pointerup is not enough: the synthesized `click`
      // that follows pointerup bubbles to the host and flashes the drilled
      // pane open. Every listener below stops propagation, and `click` is
      // cancelled outright.
      //
      // These are passive-safe (no preventDefault on pointer events beyond the
      // ones already handled) and attached on our own element only.
      view.el.addEventListener('click', function (event) {
        event.preventDefault();
        swallow(event);
      });
      view.el.addEventListener('mousedown', function (event) {
        event.preventDefault();
        swallow(event);
      });
      view.el.addEventListener('touchstart', swallow, { passive: true });
      view.el.addEventListener('dblclick', function (event) {
        event.preventDefault();
        swallow(event);
      });

      var stopLoop = function () {
        if (loopFrame === 0) return;
        cancelFrame(loopFrame);
        loopFrame = 0;
      };

      return {
        /**
         * Re-sync from a fresh ladder read.
         *
         * The store is the source of truth, but it lags: `directory.select()` is
         * async, so the snapshot keeps reporting the previous effort for a short
         * while after a drag. Adopting it immediately made the knob settle to the
         * new rung and then jump back to where upstream still pointed — the
         * "snap to High, then spring to Max" bounce.
         *
         * So while a settle animation runs, or while our write is still in
         * flight, we keep the local position and only refresh the level list.
         * The pending marker clears as soon as the store agrees, or after
         * PENDING_TIMEOUT_MS so an ignored write cannot freeze the knob forever.
         */
        sync: function (ladder) {
          if (dragging) return;
          view.levels = ladder.levels;

          var now = nowMs();
          if (pendingLevelId !== null && now > pendingUntil) pendingLevelId = null;

          // Self-heal a settle that rAF throttling left hanging.
          if (settling && settleDeadline !== 0 && now > settleDeadline) {
            stopSettle();
          }

          var settled = !settling;
          var agrees = pendingLevelId !== null && ladder.activeId === pendingLevelId;
          if (agrees) pendingLevelId = null;

          // Hold the local position until the animation finishes and upstream
          // has caught up with (or given up on) our write.
          if (!settled || (pendingLevelId !== null && !agrees)) {
            paint();
            return;
          }

          view.pct = pctOfIndex(ladder.activeIndex, ladder.levels.length);
          view.fixed = ladder.fixed === true;
          if (view.fixed) view.rail.setAttribute('aria-readonly', 'true');
          else view.rail.removeAttribute('aria-readonly');
          paint();
        },
        /** Cancel any pending animation frame and stop the ember loop. */
        dispose: function () {
          stopSettle();
          stopLoop();
          if (view.embers !== null && view.embers !== undefined) view.embers.stop();
        },
      };
    }

    /* ── 5. reconciliation ──────────────────────────────────────────────── */

    /** Currently mounted track, if any. */
    var mounted = null;

    /**
     * Snapshot the inline styles we are about to change on a host row.
     *
     * Capturing the real previous values (often empty strings meaning "unset")
     * is what makes teardown exact rather than approximate.
     */
    function captureRow(row) {
      return {
        row: row,
        height: row.style.height,
        flexWrap: row.style.flexWrap,
        alignItems: row.style.alignItems,
        paddingTop: row.style.paddingTop,
        paddingBottom: row.style.paddingBottom,
      };
    }

    /** Restore a row's captured inline styles. */
    function restoreRow(captured) {
      if (captured === null) return;
      try {
        captured.row.style.height = captured.height;
        captured.row.style.flexWrap = captured.flexWrap;
        captured.row.style.alignItems = captured.alignItems;
        captured.row.style.paddingTop = captured.paddingTop;
        captured.row.style.paddingBottom = captured.paddingBottom;
        captured.row.removeAttribute(ROW_ATTR);
      } catch (error) {
        /* the row may already be gone with the menu */
      }
    }

    /** Tear the slider down and put the row back exactly as it was. */
    function unmountTrack() {
      if (mounted === null) return;
      try { mounted.handle.dispose(); } catch (error) { /* ignore */ }
      try {
        if (mounted.view.el.parentNode !== null) {
          mounted.view.el.parentNode.removeChild(mounted.view.el);
        }
      } catch (error) { /* ignore */ }
      restoreRow(mounted.captured);
      mounted = null;
    }

    /**
     * Make the open menu carry the slider, or remove it when the menu closes.
     *
     * Fails open throughout: if the row, the ladder or the session is not
     * ready, the menu is left exactly as the host drew it.
     */
    function reconcile(ctx, menu) {
      if (menu === null) {
        unmountTrack();
        return;
      }
      var row = findEffortRow(menu);
      if (row === null) {
        unmountTrack();
        return;
      }
      var ladder = readLadder(ctx);
      if (ladder === null) {
        unmountTrack();
        return;
      }

      // Row identity or rung count changed: rebuild rather than reuse.
      if (mounted !== null && (mounted.captured.row !== row || mounted.view.levels.length !== ladder.levels.length)) {
        unmountTrack();
      }

      if (mounted === null) {
        var view = buildTrack(ladder);
        if (view === null) return;
        var captured = captureRow(row);
        // Lengthen the row and let it wrap, so the track takes the second line
        // at full width. These five host styles are the only ones this plugin
        // writes, and captureRow/restoreRow keep them reversible.
        row.style.height = 'auto';
        row.style.flexWrap = 'wrap';
        row.style.alignItems = 'center';
        row.style.paddingTop = '6px';
        row.style.paddingBottom = '8px';
        row.setAttribute(ROW_ATTR, '');
        row.appendChild(view.el);
        mounted = { view: view, captured: captured, handle: wireTrack(ctx, view) };
        return;
      }

      mounted.handle.sync(ladder);
    }

    /* ── 6. the observer ────────────────────────────────────────────────── */

    /**
     * Follow permission changes and the composer model menu.
     *
     * One observer drives both features, coalesced into one animation frame: a
     * busy transcript produces many mutations per frame and each scan walks the
     * document.
     */
    function watch(ctx) {
      if (typeof document === 'undefined') return function () {};
      var frame = 0;
      var schedule = function () {
        if (frame !== 0) return;
        frame = nextFrame(function () {
          frame = 0;
          markFullAccess(document);
          markPermissionOptions(document);
          reconcile(ctx, findModelMenu());
        });
      };
      markFullAccess(document);
      markPermissionOptions(document);
      reconcile(ctx, findModelMenu());

      var observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'aria-checked', 'aria-expanded'],
      });
      return function () {
        observer.disconnect();
        if (frame !== 0) {
          cancelFrame(frame);
          frame = 0;
        }
        var marked = document.querySelectorAll('[' + FULL_ACCESS_ATTR + ']');
        for (var i = 0; i < marked.length; i += 1) marked[i].removeAttribute(FULL_ACCESS_ATTR);
        var options = document.querySelectorAll('[' + OPTION_DANGER_ATTR + ']');
        for (var o = 0; o < options.length; o += 1) options[o].removeAttribute(OPTION_DANGER_ATTR);
        unmountTrack();
      };
    }

    /* ── 7. plugin wiring ───────────────────────────────────────────────── */

    /**
     * Required Cordis services.
     *
     * `modelDirectories` is how the slider reads the ladder and writes a rung:
     * the same service calls the shipped picker makes, so no host node is ever
     * clicked or patched. `remote`/`remote.session` keep the directory
     * resolvable while a session is still binding — without them
     * `directoryFor` throws during startup and the ladder reads as empty.
     */
    var inject = ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.session'];

    function apply(ctx) {
      ensureStyle();
      ctx.effect(function () { return watch(ctx); }, 'ember: permission repaint + effort slider');

      // Invisible slot seat: it renders nothing and exists only to hand this
      // plugin a per-session `sessionId`, which `directoryFor` needs. Taking a
      // visible seat would displace a shipped control.
      try {
        ctx.slots.inject('conversation.input.right', function () {
          return ctx.slots.register({
            name: 'conversation.input.right',
            id: 'ember-effort',
            order: 200,
            inject: function (sessionId) {
              if (typeof sessionId === 'string' && sessionId !== '') activeSessionId = sessionId;
              return {};
            },
          }, function () { return null; });
        });
      } catch (error) {
        // fail-open: without a seat the red trigger still works; only the
        // slider cannot write
        if (typeof console !== 'undefined') console.warn('[dsh-ember] slot seat unavailable', error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
