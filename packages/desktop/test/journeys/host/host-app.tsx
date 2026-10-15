/**
 * UIA-006 — desktop browser-journey render host (issue #80).
 *
 * The desktop analog of packages/arena-shell/test/a11y/host/host-app.tsx:
 * instead of composing the five registrations by hand, this host mounts the
 * REAL desktop composition root — `buildArenaDesktopComposition` from
 * packages/desktop/src/renderer/src/arenaDesktopMount.ts (consumed AS-IS,
 * zero renderer src edits) — inside the REAL `ArenaShell`.
 *
 * Faithfulness to the real renderer root (packages/desktop/src/renderer/src/main.tsx,
 * arena-first branch):
 *   - entry mode: the REAL `parseDesktopEntryMode(window.location.search)`
 *     decides arena-first vs workspace-fallback (the journeys drive the URL
 *     query: `?workspace=1` / `?app=workspace`).
 *   - baseUrl: the REAL `resolveArenaDesktopBaseUrl(...)` law. The value is
 *     sourced from the `arenaBaseUrl` page-URL query parameter — the disclosed
 *     test-only injection seam standing in for `import.meta.env.VITE_ARENA_API_URL`
 *     (absent/blank → undefined → the honest unconfigured port-0 sentinel —
 *     exactly the real unconfigured posture).
 *   - identity law: `composition.applyTitle()` at mount (applyDocumentTitle).
 *   - theme: the REAL UIA-005 wiring recipe — resolveArenaTheme +
 *     applyArenaTheme + observeArenaTheme over the host theme classes the
 *     bootstrap block maintains (dark / theme-zai-light / theme-zai-dark),
 *     with a MutationObserver recalibrating `data-arena-theme` on class
 *     changes (journeys toggle the classes to drive the real law).
 *
 * The workspace-fallback entry renders an HONEST DISCLOSURE, not the inherited
 * workspace: mounting the real inherited Root requires the full host service
 * wiring (MessagePort services, platform adapters) which this render host
 * does not provide — a stand-in fake would claim a success never exercised.
 */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ArenaShell } from "@arena/shell/shell";
import { applyArenaTheme, observeArenaTheme, resolveArenaTheme } from "@arena/shell/theme";
import {
  buildArenaDesktopComposition,
  parseDesktopEntryMode,
  resolveArenaDesktopBaseUrl,
} from "../../../src/renderer/src/arenaDesktopMount.js";

// Host theme bootstrap — the real renderer maintains the same class vocabulary
// on documentElement (default posture: zai-dark → dark + theme-zai-dark), from
// which the real arenaTheme resolver derives data-arena-theme. Journeys drive
// light/dark by toggling these classes (the MutationObserver path is the real
// runtime recalibration law wired below).
document.documentElement.classList.add("dark", "theme-zai-dark");

const search = window.location.search;
const entryMode = parseDesktopEntryMode(search);

// The composition root is constructed ONCE (controllers are stateful —
// rebuilding per render would reset in-screen state), and ONLY on the
// arena-first entry (the real renderer branches before building it).
const composition =
  entryMode === "arena-first"
    ? buildArenaDesktopComposition({
        baseUrl: resolveArenaDesktopBaseUrl(
          new URLSearchParams(search).get("arenaBaseUrl") ?? undefined,
        ),
      })
    : null;

if (composition !== null) {
  composition.applyTitle();
  // UIA-005 wiring recipe — copied verbatim in shape from the real desktop
  // renderer root: resolve + apply immediately, then observe host class
  // changes and re-resolve/re-apply (runtime recalibration).
  const rootEl = document.documentElement;
  const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const reapply = () =>
    applyArenaTheme(
      rootEl,
      resolveArenaTheme({ classList: rootEl.classList, systemDark: systemDark() }),
    );
  const observer = new MutationObserver(reapply);
  observeArenaTheme({
    target: rootEl,
    systemDark,
    observe: (target, options) => {
      observer.observe(target as Element, options as MutationObserverInit);
      return observer;
    },
  });
} else {
  document.title = "Arena — inherited workspace fallback (journey host)";
}

/** Honest fallback disclosure (the inherited workspace is NOT mounted here). */
function WorkspaceFallbackDisclosure() {
  return (
    <main
      className="arena-journey-fallback"
      data-arena-journey-entry="workspace-fallback"
      aria-label="workspace fallback entry disclosure"
    >
      <h1>Inherited workspace — explicit fallback entry</h1>
      <p>
        This window was loaded with the explicit fallback entry query (workspace=1 or
        app=workspace). The real desktop entry predicate parseDesktopEntryMode resolved
        this URL to workspace-fallback.
      </p>
      <p>
        On this entry the real desktop app mounts the inherited solution workspace, which
        requires the full host service wiring (window-scoped host services over
        MessagePort, platform adapters, database startup admission). This browser-journey
        host does not provide that wiring, and mounting a stand-in fake would claim a
        success that was never exercised — so the honest disclosure you are reading is
        rendered instead.
      </p>
      <p>
        The Arena five-screen shell is not the primary surface on this entry:
        data-arena-shell is absent by construction.
      </p>
    </main>
  );
}

function JourneyHostApp() {
  useEffect(() => {
    document.documentElement.setAttribute("data-arena-host-ready", "true");
  }, []);
  if (composition === null) {
    return <WorkspaceFallbackDisclosure />;
  }
  return <ArenaShell registry={composition.registry} announceKeyboardHints />;
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("arena journey host: #root container missing");
}
createRoot(container).render(<JourneyHostApp />);
