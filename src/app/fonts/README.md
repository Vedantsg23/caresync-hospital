# Bundled typefaces

`inter-variable.woff2` and `jetbrains-mono-variable.woff2` are the latin
subsets of the upstream Inter and JetBrains Mono variable fonts, taken from the
Fontsource distribution and committed here rather than fetched at build time.

They are served from this application's own origin. Nothing in a page load
reaches a font CDN, which is both a privacy property — a hospital system should
not report each page view and its reader's IP address to a third party — and
what allows the Content Security Policy in `src/middleware.ts` to keep
`default-src 'self'` with no exception for stylesheets or font hosts.

Both are licensed under the SIL Open Font License 1.1; the full text of each
licence sits beside the file it covers.
