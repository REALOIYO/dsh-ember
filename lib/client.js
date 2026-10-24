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
      'background:var(--dsw-alias-border-l1,rgba(128,128,128,.22));',
      'cursor:pointer;touch-action:none;',
      '-webkit-user-select:none;user-select:none;',
      '}',
      '.dsh-ember__rail:focus-visible{',
      'outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));',
      'outline-offset:2px;',
      '}',
      // the filled portion, from the left edge to the knob
      '.dsh-ember__fill{',
      'position:absolute;left:0;top:0;bottom:0;',
      'border-radius:999px;pointer-events:none;',
      'background:var(--dsw-alias-state-business-primary,currentColor);',
      'opacity:.30;',
      '}',
      // the knob
      '.dsh-ember__knob{',
      'position:absolute;top:0;',
      'width:' + TRACK_HEIGHT + 'px;',
      'height:' + TRACK_HEIGHT + 'px;',
      'border-radius:50%;pointer-events:none;',
      'background:var(--dsw-alias-state-business-primary,currentColor);',
      'box-shadow:0 1px 3px rgba(0,0,0,.35);',
      '}',
      // rung names double as the scale
      '.dsh-ember__scale{',
      'display:flex;justify-content:space-between;gap:6px;',
      'font-size:10px;line-height:12px;',
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
      if (levels.length < 2) return null;
      var activeId = current.reasoningEffort === undefined
        ? reasoning.defaultEffort
        : current.reasoningEffort;
      var activeIndex = 0;
      for (var m = 0; m < levels.length; m += 1) {
        if (levels[m].id === activeId) { activeIndex = m; break; }
      }
      return { levels: levels, activeId: activeId, activeIndex: activeIndex };
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
      return count <= 1 ? 0 : index / (count - 1);
    }

    /** Build the track element for the 推理等级 row. */
    function buildTrack(ladder) {
      var count = ladder.levels.length;
      if (count < 2) return null;

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

      var fill = document.createElement('div');
      fill.className = 'dsh-ember__fill';
      var knob = document.createElement('div');
      knob.className = 'dsh-ember__knob';
      rail.appendChild(fill);
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

      el.appendChild(rail);
      el.appendChild(scale);

      return {
        el: el,
        rail: rail,
        fill: fill,
        knob: knob,
        ticks: ticks,
        levels: ladder.levels,
        pct: pctOfIndex(ladder.activeIndex, count),
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

      var swallow = function (event) {
        if (event === undefined || event === null) return;
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      };

      var paint = function () {
        var count = view.levels.length;
        var width = view.rail.getBoundingClientRect().width;
        var index = indexFromPct(view.pct, count);
        // The knob's centre travels across (width - diameter); expressing that
        // as a left offset keeps the circle fully inside the rail at both ends.
        var centre = KNOB_RADIUS + view.pct * Math.max(width - KNOB_RADIUS * 2, 0);
        view.knob.style.left = (centre - KNOB_RADIUS) + 'px';
        view.fill.style.width = centre + 'px';
        view.rail.setAttribute('aria-valuenow', String(index));
        view.rail.setAttribute('aria-valuetext', view.levels[index].label);
        for (var i = 0; i < view.ticks.length; i += 1) {
          if (i === index) view.ticks[i].setAttribute('data-active', 'true');
          else view.ticks[i].removeAttribute('data-active');
        }
      };
      view.paint = paint;

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

      view.rail.addEventListener('pointerdown', function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        var pct = pctAt(view.rail, event.clientX);
        if (pct === null) return;
        stopSettle();
        dragging = true;
        startPct = view.pct;
        lastX = event.clientX;
        lastAt = nowMs();
        velocity = 0;
        view.pct = pct;
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
        settleTo(pctOfIndex(index, count));
        commitIndex(index);
        if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
        swallow(event);
      };

      view.rail.addEventListener('pointerup', release);
      view.rail.addEventListener('pointercancel', release);

      view.rail.addEventListener('keydown', function (event) {
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
          paint();
        },
        /** Cancel any pending animation frame. */
        dispose: stopSettle,
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
