export const HELP = `Usage:
  mf-inspector [options]                     Analyse project shared config
  mf-inspector --interactive                 Step-by-step interactive wizard
  mf-inspector federation <manifest> ...     Cross-MF federation analysis

Project options:
  --source, -s <dirs>          Source dirs to scan, comma-separated (default: ./src)
  --depth <depth>              Scan depth: direct | local-graph (default: local-graph)
  --shared <packages|file>     Comma-separated package names or path to .json config
  --tsconfig <path>            tsconfig.json for path alias resolution
  --workspace-packages <pkgs>  Comma-separated workspace packages to exclude
  --name <name>                Project name (default: auto from package.json)
  --fail-on <rule>             Exit 1 when findings match: mismatch | unused | any
  --write-manifest             Write project-manifest.json to output dir
  --output-dir <dir>           Output directory for manifest (default: .)
  --interactive, -i            Launch step-by-step wizard instead of flags
  --help, -h                   Show this help

Federation:
  mf-inspector federation checkout.json catalog.json cart.json

Examples:
  mf-inspector
  mf-inspector --interactive
  mf-inspector --source ./src --shared react,react-dom --fail-on mismatch
  mf-inspector --shared ./shared-config.json --write-manifest
  mf-inspector federation ./manifests/checkout.json ./manifests/catalog.json
`;
