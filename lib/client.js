// dsh-ui-refresh — browser half, wrapped for the DSH client loader.
//
// The shell's loader evaluates plugin bundles as classic scripts through
// window.__ModuleLoader__.load and reads module.exports; a bare `export`
// statement is a syntax error there and the whole entry fails to import. This
// wrapper supplies the CJS shape, same as the shipped ui-* bundles.
//
// ── WHAT THIS PLUGIN DOES ─────────────────────────────────────────────────
//
// Two independent pieces, both additive — no shipped component is replaced:
//
//   1. RED FULL-ACCESS TRIGGER
//      The permission trigger renders `完全权限` in the same tone as every
//      other preset. A MutationObserver tags the trigger with
//      `data-dsh-full-access` whenever the current preset is full access, and
//      one CSS rule repaints the label AND the shield glyph in
//      `--dsw-alias-state-error-primary`, which the theme already defines
//      separately for light (#ec1313) and dark (#f25a5a). Nothing is
//      hard-coded, so both themes stay correct by construction.
//
//      The glyph inherits `color` — `._86kJGG_triggerIcon` sets only
//      `display`, and the trigger sets the colour on the button — so painting
//      the button covers the shield too.
//
//   2. EFFORT SLIDER
//      Registered as a new `list` id on `conversation.input.right`, which the
//      conversation package declares as:
//
//        conversation.input.right   list   session
//
//      and renders inside `standardControls`, immediately before the shipped
//      model selector:
//
//        jsxs("div", { className: standardControls, children: [
//          renderSlot("conversation.input.right", {}),
//          renderSlot("conversation.input.model", { locked })
//        ]})
//
//      Because it is a *new list id*, the shipped ModelSelect keeps its cell —
//      this is the "add one control" route, not the "shadow the whole
//      component" route. `single` slots throw when re-registered at the same
//      priority, so that route would have meant reimplementing 79KB of menu,
//      search and keyboard handling.
//
// ── WHERE THE LADDER COMES FROM ───────────────────────────────────────────
//
// The slider never assumes a fixed set of levels. Adapters declare a string
// array (`efforts: ['disabled','low','high','max']`, or
// `['light','balanced','deep']`, or `['off']`); the host normalises it to
//
//   reasoning: { efforts: [{ id, name, description }], defaultEffort }
//
// and the ladder length is read from that array at render time. One-, three-,
// four- and six-rung models all work. A model with no `reasoning` at all
// renders nothing.
//
// The current rung is `current.reasoningEffort ?? reasoning.defaultEffort`
// (the same expression the shipped picker uses), and the shipped picker's
// extra `Default` pseudo-rung is reproduced when `defaultEffort` is undefined.
//
// Committing goes through `directory.select()` — the same entry point the
// shipped picker uses — so no DOM clicking and no parallel write path.
window.__ModuleLoader__.load({
  id: 'dsh-ui-refresh',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    /** Marks the permission trigger while the full-access preset is current. */
    var FULL_ACCESS_ATTR = 'data-dsh-full-access';

    /** Locale namespace owned by this plugin. */
    var NS = 'ui-refresh';

    /**
     * Localised labels the host ships for the full-access preset.
     *
     * Only used to confirm which button is the trigger — the observer also
     * requires the trigger's own `aria-label` shape, so an unrelated button
     * that happens to read `完全权限` (the confirmation dialog's
     * `启用完全权限`, a menu row) is not repainted.
     */
    var FULL_ACCESS_LABELS = ['完全权限', 'Full access'];

    /** The trigger's aria-label template, before and after the colon. */
    var TRIGGER_ARIA = /访问模式|Access mode/i;

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

      // ── 2. effort slider ──────────────────────────────────────────────
      '.dsh-ui-refresh__effort{',
      'display:flex;align-items:center;gap:6px;min-width:0;',
      'height:28px;padding:0 4px;',
      '}',
      '.dsh-ui-refresh__effort[data-busy="true"]{opacity:.6}',
      '.dsh-ui-refresh__range{',
      'width:74px;height:14px;margin:0;flex:none;cursor:pointer;',
      'accent-color:var(--dsw-alias-state-business-primary,currentColor);',
      '}',
      '.dsh-ui-refresh__range:disabled{cursor:default}',
      '.dsh-ui-refresh__rung{',
      'font-size:13px;line-height:20px;font-weight:500;',
      'color:var(--dsw-alias-label-secondary);',
      'white-space:nowrap;text-overflow:ellipsis;overflow:hidden;',
      'max-width:96px;flex:none;',
      '}',
      '.dsh-ui-refresh__rung[data-transition="true"]{',
      'transition:color .16s ease;',
      '}',
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

    /**
     * Decide whether one button is the permission trigger showing full access.
     *
     * Deliberately conservative: it needs BOTH a trigger-shaped aria-label and
     * a full-access label somewhere in that name. A host that renames the
     * aria-label stops the repaint instead of mis-painting a random button.
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
     * Reconcile the marker across every button under a root.
     *
     * Only the trigger ever gains the attribute, and it is removed again the
     * moment the preset changes, so the red follows the preset instead of
     * sticking to the button.
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
     * Follow preset changes for as long as the plugin is loaded.
     *
     * The permission trigger swaps only its text and aria-label on change, so
     * a characterData + childList + attributes observer over the body catches
     * every transition. Scans are coalesced into one animation frame: a busy
     * transcript produces many mutations per frame and each scan is a full
     * `querySelectorAll`.
     *
     * @returns disposer that disconnects the observer and clears the marker.
     */
    function watchFullAccess() {
      if (typeof document === 'undefined') return function () {};
      var frame = 0;
      var schedule = function () {
        if (frame !== 0) return;
        var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
        frame = raf(function () {
          frame = 0;
          markFullAccess(document);
        });
      };
      markFullAccess(document);
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'title', 'data-dsh-permission'],
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
      };
    }

    /**
     * The effort ladder for one model, mirroring the shipped picker's rules.
     *
     * @param reasoning - the model's advertised `reasoning` block, if any.
     * @param providerDefaultLabel - copy for the implicit "provider default" rung.
     * @returns ordered rungs; empty when the model exposes no ladder.
     */
    function effortRungs(reasoning, providerDefaultLabel) {
      if (reasoning === undefined) return [];
      var rungs = [];
      if (reasoning.defaultEffort === undefined) {
        rungs.push({ id: undefined, label: providerDefaultLabel });
      }
      var efforts = reasoning.efforts || [];
      for (var i = 0; i < efforts.length; i += 1) {
        rungs.push({ id: efforts[i].id, label: efforts[i].name || efforts[i].id });
      }
      return rungs;
    }

    /**
     * Find the currently selected model entry in a directory snapshot.
     *
     * @param state - `ModelDirectory` snapshot.
     * @returns the matched `{ group, model }`, or undefined.
     */
    function currentModel(state) {
      var current = state.current;
      if (current === null || current === undefined) return undefined;
      var groups = state.groups || [];
      for (var i = 0; i < groups.length; i += 1) {
        if (groups[i].id !== current.provider) continue;
        var models = groups[i].models || [];
        for (var j = 0; j < models.length; j += 1) {
          if (models[j].id === current.model) return { group: groups[i], model: models[j] };
        }
      }
      return undefined;
    }

    /**
     * Reasoning-effort slider for the composer row.
     *
     * Renders nothing unless the selected model advertises a ladder with at
     * least two rungs — a single-rung menu has nothing to slide between, and
     * the shipped picker already states that one value.
     *
     * Dragging updates local state only; the write happens on release. The
     * directory store has no throttling, so committing per `input` event would
     * fire one `session.selectModel` per pixel of travel.
     *
     * @param props - injected `directory` store, `load`, `select`, and `t`.
     */
    function EffortSlider(props) {
      var available = props.available;
      var directory = props.directory;
      var load = props.load;
      var select = props.select;
      var t = props.t;
      var state = React.useSyncExternalStore(
        function (onChange) { return directory.subscribe(onChange); },
        function () { return directory.getSnapshot(); }
      );
      var dragged = React.useState(null);
      var draft = dragged[0];
      var setDraft = dragged[1];

      React.useEffect(function () {
        if (available) load();
      }, []);

      var hit = currentModel(state);
      var reasoning = hit === undefined ? undefined : hit.model.reasoning;
      var rungs = effortRungs(reasoning, t('effort.providerDefault'));
      var current = state.current;
      var effective = current === null || current === undefined
        ? undefined
        : current.reasoningEffort === undefined ? reasoning && reasoning.defaultEffort : current.reasoningEffort;
      var committed = -1;
      for (var i = 0; i < rungs.length; i += 1) {
        if (rungs[i].id === effective) { committed = i; break; }
      }
      var busy = state.status === 'selecting';

      // Nothing to slide between: let the shipped picker state the value.
      if (!available || hit === undefined || rungs.length < 2) return null;

      var index = draft === null ? (committed < 0 ? 0 : committed) : draft;
      if (index >= rungs.length) index = rungs.length - 1;

      var commit = function (next) {
        if (next === committed) return;
        var rung = rungs[next];
        if (rung === undefined) return;
        select({
          provider: current.provider,
          model: current.model,
          reasoningEffort: rung.id,
        }).catch(function () {});
      };

      return React.createElement('div', {
        className: 'dsh-ui-refresh__effort',
        'data-busy': busy ? 'true' : 'false',
        'data-dsh-ui-refresh-effort': '',
      },
        React.createElement('input', {
          type: 'range',
          className: 'dsh-ui-refresh__range',
          min: 0,
          max: rungs.length - 1,
          step: 1,
          value: index,
          disabled: busy,
          'aria-label': t('effort.aria'),
          'aria-valuetext': rungs[index] === undefined ? '' : rungs[index].label,
          title: rungs[index] === undefined ? undefined : rungs[index].label,
          onChange: function (event) {
            setDraft(Number(event.target.value));
          },
          // Release commits. Keyboard input fires `change` without a pointer
          // sequence, so `onKeyUp` covers arrows / Home / End as well.
          onPointerUp: function () {
            if (draft === null) return;
            var next = draft;
            setDraft(null);
            commit(next);
          },
          onKeyUp: function () {
            if (draft === null) return;
            var next = draft;
            setDraft(null);
            commit(next);
          },
          onBlur: function () {
            if (draft === null) return;
            var next = draft;
            setDraft(null);
            commit(next);
          },
        }),
        React.createElement('span', {
          className: 'dsh-ui-refresh__rung',
          'data-transition': 'true',
          children: rungs[index] === undefined ? '' : rungs[index].label,
        })
      );
    }

    /** Required Cordis services. */
    var inject = ['slots', 'locale'];

    /**
     * Client plugin body.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ensureStyle();
      ctx.effect(watchFullAccess, 'ui-refresh: full-access repaint');

      ctx.effect(function () {
        return ctx.locale.register(NS, {
          zh: { 'effort.aria': '推理等级', 'effort.providerDefault': '默认' },
          en: { 'effort.aria': 'Reasoning effort', 'effort.providerDefault': 'Default' },
        });
      }, 'ui-refresh: dictionaries');

      var t = ctx.locale.bind(NS);

      ctx.inject(['slots', 'modelDirectories'], function (scope) {
        var models = scope.modelDirectories;
        var sessions = scope.sessions;
        scope.slots.inject('conversation.input.right', function () {
          return scope.slots.register({
            name: 'conversation.input.right',
            id: 'ui-refresh-effort',
            order: 10,
            inject: function (sessionId) {
              var directory = models.directoryFor(sessionId);
              var available = sessions === undefined
                || typeof sessions.subagentAddress !== 'function'
                || sessions.subagentAddress(sessionId) === undefined;
              return {
                available: available,
                directory: directory.store,
                load: function () {
                  if (available) directory.load().catch(function () {});
                },
                select: function (selection) {
                  return available ? directory.select(selection) : Promise.resolve(undefined);
                },
                t: t,
              };
            },
          }, EffortSlider);
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
