// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },

  // The scaffold's default target is `cloudflare-module`, which has no
  // filesystem — and the MVP's persistence is SQLite on disk (§4 of the MVP
  // brief; see docs/backend/PERSISTENCE.md). A Workers build would therefore
  // produce a bundle that cannot open its own database.
  //
  // Targeting a Node server is the honest consequence of that choice, not a
  // deployment decision: production hosting and database remain deferred, and
  // this line is where a different target is reinstated once they are made.
  // Inside a Lovable build LOVABLE_NITRO_PRESET still wins.
  nitro: { preset: "node-server" },

  vite: {
    // better-sqlite3 is a native addon. Bundling it would rewrite the require
    // that loads its `.node` binary.
    ssr: { external: ["better-sqlite3"] },
  },
});
