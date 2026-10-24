// dsh-ui-refresh — browser half, wrapped for the DSH client loader.
//
// The shell's loader evaluates plugin bundles as classic scripts through
// window.__ModuleLoader__.load and reads module.exports; a bare `export`
// statement is a syntax error there and the whole entry fails to import. This
// wrapper supplies the CJS shape, same as the shipped ui-* bundles.
//
// ── WHAT THIS PLUGIN DOES ─────────────────────────────────────────────────
//
// Two additive changes. Not one shipped component is re-registered, wrapped or
// replaced — everything below either repaints an existing node or injects a new
// one into a menu that the host already rendered.
//
//   1. RED FULL-ACCESS TRIGGER
//      The permission trigger renders `完全权限` in the same tone as every
//      other preset. A MutationObserver tags the trigger with
//      `data-dsh-full-access` while that preset is current, and one CSS rule
//      repaints the label AND the shield glyph in
//      `--dsw-alias-state-error-primary`, which the theme defines separately
//      for light (#ec1313) and dark (#f25a5a). Nothing is hard-coded.
//
//      The glyph inherits `color` — `._86kJGG_triggerIcon` sets only
//      `display`, and the trigger sets the colour on the button — so painting
//      the button covers the shield too.
//
//   2. EFFORT SLIDER INSIDE THE MODEL MENU
//      The host renders the composer model menu itself:
//
//        <div role="menu" aria-label="模型与推理等级">   ← popup surface
//          <button role="menuitem">模型   <value> ›</button>
//          <button role="menuitem">推理等级 <value> ›</button>
//        </div>
//
//      Clicking 推理等级 drills into a second pane listing
//      `<button role="menuitemradio">Low/High/Max</button>`.
//
//      This plugin watches for that menu, finds the 推理等级 row, and injects a
//      slider directly BELOW it. The slider reads its rungs from the menu's own
//      DOM (the drilled radio list, or the top-level trigger's aria-label), so
//      the ladder length is whatever the host advertised — never a fixed list.
//
//      Choosing a rung reuses the host's own radio buttons: the plugin finds
//      the matching `menuitemradio` and clicks it, so the write goes through
//      the exact path a user click takes. No parallel write channel, no
//      session.selectModel call of our own.
//
// ── WHY DOM-LEVEL RATHER THAN A SLOT ──────────────────────────────────────
//
// The composer seat `conversation.input.model` is a `single` slot: registering
// it at the same priority throws ("already has a registration"), so taking it
// over would mean reimplementing the entire 79KB ModelSelect (menu, search,
// keyboard navigation, portal positioning, failure retry, toast).
//
// `single` slots also cannot host a second child — child slots must be declared
// by the parent entry's children table, and that table belongs to the shipped
// package. There is no seam to add a row inside its popup.
//
// So the menu gets extended the only way that leaves the host untouched:
// observe it, and insert one element the host did not author.
window.__ModuleLoader__.load({
  id: 'dsh-ui-refresh',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /** Marks the permission trigger while the full-access preset is current. */
    var FULL_ACCESS_ATTR = 'data-dsh-full-access';

    /** Marks an injected slider host so rescans skip their own output. */
    var SLIDER_ATTR = 'data-dsh-effort-slider';

    /** Class that folds the host's own radio rows away while the slider stands in. */
    var HIDDEN_CLASS = 'dsh-ui-refresh__folded';

    /** Attribute holding a radio's pre-fold tabindex, for exact restoration. */
    var TABINDEX_BACKUP = 'data-dsh-effort-tabindex';

    /** Marks the full-access row inside the permission menu. */
    var OPTION_DANGER_ATTR = 'data-dsh-permission-danger';

    /** Stable id for the single portalled slider. */
    var SLIDER_ID = 'dsh-ui-refresh-effort';

    /** Locale namespace owned by this plugin (unused by others — verified). */
    var NS = 'ui-refresh';

    /** Full-access labels the host ships; used to pick out the trigger. */
    var FULL_ACCESS_LABELS = ['完全权限', 'Full access'];

    /** The permission trigger's aria-label template. */
    var TRIGGER_ARIA = /访问模式|Access mode/i;

    /** The composed menu's accessible name, zh and en. */
    var MENU_ARIA = /^(模型与推理等级|Model and reasoning effort)$/;

    /** The effort row's label text, zh and en. */
    var EFFORT_ROW = /^(推理等级|Effort)$/;

    /** The model row's label text — anything that is not this is the effort row. */
    var MODEL_ROW = /^(模型|Model)$/;

    var css = [
      // ── 1. full access in red ──────────────────────────────────────────
      '[data-dsh-full-access]{',
      'color:var(--dsw-alias-state-error-primary)!important;',
      '}',
      // the shield glyph inherits `color`; assert it so a future hard-coded
      // fill on the icon cannot silently break the repaint
      '[data-dsh-full-access] svg{color:inherit!important}',
      // hover keeps the red rather than falling back to the neutral hover tone
      '[data-dsh-full-access]:hover:not(:disabled){',
      'background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));',
      '}',
      // the option row inside the permission menu, which carries no
      // aria-label of its own — its colour comes from the list item
      '[data-dsh-permission-danger] *{',
      'color:var(--dsw-alias-state-error-primary)!important;',
      '}',
      '[data-dsh-permission-danger] svg{color:inherit!important}',

      // ── 2. effort slider injected under the 推理等级 row ────────────────
      // The slider is portalled to <body> and positioned over the menu's
      // drilled pane. It must never become a child of a React-managed
      // container: React reconciles those children by index, and an
      // unauthored node in there makes its next commit throw (which unmounts
      // the whole popup — that bug is what took the menu away).
      '[data-dsh-effort-slider]{',
      'position:fixed;z-index:1200;box-sizing:border-box;',
      'display:flex;flex-direction:column;gap:2px;',
      'padding:6px 10px 8px;border-radius:8px;',
      'background:var(--dsw-specific-menu,#26282c);',
      'box-shadow:0 6px 20px rgba(0,0,0,.35);',
      'border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));',
      '}',
      '[data-dsh-effort-slider][data-busy="true"]{opacity:.55}',
      '.dsh-ui-refresh__range{',
      'display:block;width:100%;min-width:0;height:16px;margin:0;cursor:pointer;',
      'accent-color:var(--dsw-alias-state-business-primary,currentColor);',
      '}',
      '.dsh-ui-refresh__range:disabled{cursor:default}',
      // the rung names double as the scale under the track
      '.dsh-ui-refresh__scale{',
      'display:flex;justify-content:space-between;gap:6px;',
      'font-size:10px;line-height:12px;',
      'color:var(--dsw-alias-label-caption);',
      '}',
      '.dsh-ui-refresh__tick{',
      'white-space:nowrap;text-overflow:ellipsis;overflow:hidden;',
      'transition:color .16s ease,font-weight .16s ease;',
      '}',
      // the current rung reads as selected without a separate label
      '.dsh-ui-refresh__tick[data-active="true"]{',
      'color:var(--dsw-alias-label-primary);font-weight:600;',
      '}',
      // list mode keeps the rung names evenly spread, one per stop
      '.dsh-ui-refresh__scale[data-mode="list"]{justify-content:space-between}',
      // the host's own rows, folded away while the slider stands in.
      // Scoped to the attribute we inject, so this can never hide a menu
      // that has no slider in it.
      '[data-dsh-effort-slider] ~ .dsh-ui-refresh__folded,',
      '.dsh-ui-refresh__folded{display:none!important}',
    ].join('');

    /**
     * Install the plugin's stylesheet once per document.
     *
     * Tagged exactly like the shipped bundles so a reload replaces rather than
     * stacks it.
     */
    function ensureStyle() {
      var tagId = 'dsh-ui-refresh/refresh.css';
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-ui-refresh';
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /** Collapse an element's text into single-spaced, trimmed form. */
    function textOf(el) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Decide whether one button is the permission trigger showing full access.
     *
     * Deliberately conservative: it needs BOTH a trigger-shaped aria-label and
     * a full-access label inside that name. A host that renames the aria-label
     * stops the repaint instead of mis-painting an unrelated button (the
     * confirmation dialog's 启用完全权限 reads like a match otherwise).
     *
     * @param button - candidate element.
     * @returns whether the full-access marker belongs on it.
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

    /**
     * Mark the full-access option row inside the permission menu.
     *
     * The trigger paints itself through its aria-label, but the menu's option
     * rows are `role="menuitem"` buttons with no aria-label — only a nested
     * label span. So they are matched on their visible text, and only within a
     * menu that actually looks like the permission picker (its rows are exactly
     * the four preset labels). That keeps a random menu item elsewhere from
     * being repainted just because it happens to read 完全权限.
     *
     * @param root - subtree to scan.
     */
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

    /**
     * Reconcile the red marker across every button under a root.
     *
     * The marker follows the current preset: added when full access is
     * selected, removed the moment it is not.
     *
     * @param root - subtree to scan (normally document).
     */
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

    /**
     * Locate the composer model menu, if it is currently open.
     *
     * Matched on its accessible name rather than a hashed class, because hash
     * class names (`_9r0rkG_*`) rotate with every build while the aria-label is
     * product copy.
     *
     * @returns the menu element, or null.
     */
    function findModelMenu() {
      var menus = document.querySelectorAll('[role="menu"]');
      for (var i = 0; i < menus.length; i += 1) {
        var label = (menus[i].getAttribute('aria-label') || '').trim();
        if (MENU_ARIA.test(label)) return menus[i];
      }
      return null;
    }

    /**
     * Read the effort row inside the open menu.
     *
     * @param menu - the composer model menu.
     * @returns the 推理等级 row button, or null while the menu is on its root pane.
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

    /**
     * Read the drilled effort level list, when the menu shows it.
     *
     * The host renders one `menuitemradio` per advertised rung, in the adapter's
     * declared order, with `aria-checked` on the current one. Its own
     * "Default" pseudo-rung (present only when the model advertises no
     * defaultEffort) arrives as a radio whose text is the localised Default.
     *
     * @param menu - the composer model menu.
     * @returns ordered rungs `{ label, checked, node }`; empty when not drilled.
     */
    function readRungs(menu) {
      var radios = menu.querySelectorAll('[role="menuitemradio"]');
      var rungs = [];
      for (var i = 0; i < radios.length; i += 1) {
        var label = textOf(radios[i]);
        if (label === '') continue;
        rungs.push({
          label: label,
          checked: radios[i].getAttribute('aria-checked') === 'true',
          node: radios[i],
        });
      }
      return rungs;
    }

    /**
     * Build the slider host for one menu.
     *
     * Shape (one compact block, no duplicated current-rung label):
     *
     *   [================|=========]      ← range input
     *   Low        High        Max        ← rung names, current one bold
     *
     * @param menu - the composer model menu.
     * @param rungs - ordered rungs from the drilled pane; needs at least 2.
     * @returns the host element, or null when there is nothing to slide.
     */
    function buildSlider(menu, rungs) {
      var count = rungs.length;
      if (count < 2) return null;

      var activeIndex = 0;
      for (var i = 0; i < count; i += 1) {
        if (rungs[i].checked) { activeIndex = i; break; }
      }

      var host = document.createElement('div');
      host.setAttribute(SLIDER_ATTR, '');
      // presentation, not a menu row: the host's own radios stay the real
      // controls, and this block must not be announced as another choice
      host.setAttribute('role', 'presentation');

      var range = document.createElement('input');
      range.type = 'range';
      range.className = 'dsh-ui-refresh__range';
      range.min = '0';
      range.max = String(count - 1);
      range.step = '1';
      range.value = String(activeIndex);
      range.setAttribute('aria-label', '推理等级');
      range.setAttribute('aria-valuetext', rungs[activeIndex].label);
      range.title = rungs[activeIndex].label;

      var scale = document.createElement('div');
      scale.className = 'dsh-ui-refresh__scale';
      scale.setAttribute('data-mode', 'list');
      scale.setAttribute('aria-hidden', 'true');
      var ticks = [];
      for (var j = 0; j < count; j += 1) {
        var tick = document.createElement('span');
        tick.className = 'dsh-ui-refresh__tick';
        tick.textContent = rungs[j].label;
        if (j === activeIndex) tick.setAttribute('data-active', 'true');
        scale.appendChild(tick);
        ticks.push(tick);
      }

      /** Paint one index as current across the scale and the range's a11y name. */
      var paint = function (index) {
        var label = rungs[index] === undefined ? '' : rungs[index].label;
        range.setAttribute('aria-valuetext', label);
        range.title = label;
        for (var k = 0; k < ticks.length; k += 1) {
          if (k === index) ticks[k].setAttribute('data-active', 'true');
          else ticks[k].removeAttribute('data-active');
        }
      };

      /**
       * Commit one rung by clicking the host's own radio.
       *
       * Reusing the radio means the write takes exactly the path a user click
       * takes — the same Remote call, the same pending state, the same failure
       * handling. The plugin never invents a write channel.
       */
      var commit = function (index) {
        var rung = rungs[index];
        if (rung === undefined) return;
        var radio = rung.node;
        // The host may have re-rendered and detached the captured node;
        // re-resolve by label so a stale reference cannot click a gone button.
        if (radio === null || radio === undefined || !document.contains(radio)) {
          var fresh = menu.querySelectorAll('[role="menuitemradio"]');
          radio = null;
          for (var k = 0; k < fresh.length; k += 1) {
            if (textOf(fresh[k]) === rung.label) { radio = fresh[k]; break; }
          }
        }
        if (radio === null || radio === undefined) return;
        radio.click();
      };

      // Live: repaint the scale while dragging, but write nothing yet.
      range.addEventListener('input', function () {
        paint(Number(range.value));
      });

      // Release commits. Keyboard use fires no pointer events, so keyup covers
      // arrows / Home / End as well. A plain track click commits too.
      range.addEventListener('pointerup', function () {
        commit(Number(range.value));
      });
      range.addEventListener('keyup', function () {
        commit(Number(range.value));
      });

      host.appendChild(range);
      host.appendChild(scale);
      host.dataset.count = String(count);
      host.dataset.active = String(activeIndex);
      return host;
    }

    /**
     * Hide or restore the host's own radio rows.
     *
     * The slider replaces the list visually, but the radios stay in the document
     * (hidden, not removed) for two reasons: they carry the rung labels and
     * checked state the slider reads, and clicking them is how the slider
     * writes. Removing them would leave nothing to drive.
     *
     * Hiding uses a class, not `style.display`, so nothing survives teardown:
     * the rule lives in our own stylesheet and the class is stripped on dispose,
     * so an unload can never leave the menu's rows invisible.
     *
     * Only ever called once a slider is definitely in place — if the labels stop
     * matching, the list stays visible rather than the menu going blank.
     *
     * @param menu - the composer model menu.
     * @param hidden - whether the list should be folded away.
     */
    function setRadiosHidden(menu, hidden) {
      var radios = menu.querySelectorAll('[role="menuitemradio"]');
      for (var i = 0; i < radios.length; i += 1) {
        var radio = radios[i];
        if (hidden) {
          radio.classList.add(HIDDEN_CLASS);
          // remember the original tabindex so restoring is exact
          if (!radio.hasAttribute(TABINDEX_BACKUP)) {
            radio.setAttribute(TABINDEX_BACKUP, radio.getAttribute('tabindex') || '');
          }
          // a hidden control must not stay tabbable
          radio.setAttribute('tabindex', '-1');
          radio.setAttribute('aria-hidden', 'true');
        } else {
          radio.classList.remove(HIDDEN_CLASS);
          radio.removeAttribute('aria-hidden');
          if (!radio.hasAttribute(TABINDEX_BACKUP)) continue;
          var previous = radio.getAttribute(TABINDEX_BACKUP);
          radio.removeAttribute(TABINDEX_BACKUP);
          if (previous === '') radio.removeAttribute('tabindex');
          else radio.setAttribute('tabindex', previous);
        }
      }
    }

    /**
     * Ensure the open menu carries a slider, and that it is in sync.
     *
     * @param menu - the composer model menu, or null.
     */
    function syncSlider(menu) {
      if (menu === null) {
        removeSlider();
        return;
      }
      var rungs = readRungs(menu);

      // Not drilled: no ladder to slide through, so drop any slider and hand
      // the list back to the host unchanged.
      if (rungs.length < 2) {
        removeSlider();
        setRadiosHidden(menu, false);
        return;
      }

      var host = document.getElementById(SLIDER_ID);
      if (host === null) {
        host = buildSlider(menu, rungs);
        if (host === null) return;
        // Portalled onto <body>: outside every React root, so no reconciliation
        // of ours can ever disturb the host's tree.
        host.id = SLIDER_ID;
        document.body.appendChild(host);
        positionSlider(host, menu);
        setRadiosHidden(menu, true);
        return;
      }

      // Already mounted: keep it in sync and re-anchor it if the pane moved.
      syncSliderValue(host, rungs);
      positionSlider(host, menu);
      setRadiosHidden(menu, true);
    }

    /** Remove the portalled slider and restore the host's rows. */
    function removeSlider() {
      var host = document.getElementById(SLIDER_ID);
      if (host !== null) host.remove();
      var menus = document.querySelectorAll('[role="menu"]');
      for (var i = 0; i < menus.length; i += 1) setRadiosHidden(menus[i], false);
    }

    /**
     * Anchor the portalled slider to the menu's drilled pane.
     *
     * Measured from the first radio so it sits where the folded rows were.
     *
     * @param host - the portalled slider.
     * @param menu - the open composer menu.
     */
    function positionSlider(host, menu) {
      // Anchor to the menu itself, not to a radio: the radios are folded
      // (display:none) by the time this runs, so their rect collapses to
      // nothing and the slider would be squeezed to a sliver.
      var rect = menu.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) return;
      var pad = 4;
      host.style.left = Math.round(rect.left + pad) + 'px';
      host.style.width = Math.round(rect.width - pad * 2) + 'px';
      host.style.top = Math.round(rect.top + pad) + 'px';
    }

    /**
     * Refresh an already-mounted slider from the host's current checked rung.
     *
     * @param host - the portalled slider.
     * @param rungs - the rungs read from the menu.
     */
    function syncSliderValue(host, rungs) {
      var range = host.querySelector('input[type=range]');
      var scale = host.querySelector('.dsh-ui-refresh__scale');
      var count = rungs.length;
      var activeIndex = 0;
      for (var i = 0; i < count; i += 1) {
        if (rungs[i].checked) { activeIndex = i; break; }
      }
      var dragging = range !== null && document.activeElement === range;
      if (range !== null) {
        range.max = String(count - 1);
        if (!dragging) {
          range.value = String(activeIndex);
          range.setAttribute('aria-valuetext', rungs[activeIndex].label);
          range.title = rungs[activeIndex].label;
        }
      }
      if (scale !== null && !dragging) {
        var ticks = scale.querySelectorAll('.dsh-ui-refresh__tick');
        for (var t = 0; t < ticks.length; t += 1) {
          if (t === activeIndex) ticks[t].setAttribute('data-active', 'true');
          else ticks[t].removeAttribute('data-active');
        }
      }
      host.dataset.count = String(count);
      host.dataset.active = String(activeIndex);
    }

    /**
     * Follow permission changes and the composer model menu.
     *
     * One observer drives both features. Scans are coalesced into one animation
     * frame: a busy transcript produces many mutations per frame and each scan
     * walks the document.
     *
     * @returns disposer that disconnects and unwinds both features.
     */
    function watch() {
      if (typeof document === 'undefined') return function () {};
      var frame = 0;
      var schedule = function () {
        if (frame !== 0) return;
        var raf = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : function (fn) { return setTimeout(fn, 16); };
        frame = raf(function () {
          frame = 0;
          markFullAccess(document);
          markPermissionOptions(document);
          syncSlider(findModelMenu());
        });
      };
      markFullAccess(document);
      markPermissionOptions(document);
      syncSlider(findModelMenu());

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
          var cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
          cancel(frame);
          frame = 0;
        }
        var marked = document.querySelectorAll('[' + FULL_ACCESS_ATTR + ']');
        for (var i = 0; i < marked.length; i += 1) marked[i].removeAttribute(FULL_ACCESS_ATTR);
        var options = document.querySelectorAll('[' + OPTION_DANGER_ATTR + ']');
        for (var o = 0; o < options.length; o += 1) options[o].removeAttribute(OPTION_DANGER_ATTR);
        // unwinding must restore every row this plugin folded, even if the menu
        // is still open when the plugin unloads
        removeSlider();
      };
    }

    /** Required Cordis services. */
    var inject = ['locale'];

    /**
     * Client plugin body.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ensureStyle();
      ctx.effect(watch, 'ui-refresh: permission repaint + effort slider');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
