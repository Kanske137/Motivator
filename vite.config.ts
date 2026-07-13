import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

// A short identifier for the deployed build so we can confirm which commit is live
// (Cloudflare sets CF_PAGES_COMMIT_SHA; locally we read the git HEAD). Exposed as
// __BUILD_COMMIT__ (JS) and a <meta name="build-commit"> tag (curl-checkable).
function buildCommit(): string {
  const cf = process.env.CF_PAGES_COMMIT_SHA;
  if (cf) return cf.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}
const BUILD_COMMIT = buildCommit();

/** Stamp the build commit into <head> so the live deploy reports its exact commit. */
function buildCommitMeta() {
  return {
    name: "build-commit-meta",
    transformIndexHtml(html: string) {
      return html.replace(
        "</head>",
        `  <meta name="build-commit" content="${BUILD_COMMIT}" />\n</head>`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), buildCommitMeta(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
