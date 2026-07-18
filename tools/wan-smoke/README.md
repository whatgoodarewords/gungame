# WAN smoke

Run the Phase 2d WAN confirmation from the development machine after the Prime
deploys staging:

```sh
pnpm wan-smoke
```

Defaults are 12 bots, 60 seconds of deterministic movement, and
`wss://dev.sml.world/gg/ws`. The script first verifies `/gg/` and
`/gg/healthz` over HTTPS, then prints a netsim-compatible metrics document
tagged with `"environment": "wan"`.

Use `pnpm wan-smoke -- --help` for URL, bot-count, duration, seed, and output
flags.
