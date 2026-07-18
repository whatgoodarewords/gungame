# Phase 2 packet-level netsim

The bot workload is deterministic for a supplied seed and reports correction
p95, remote-stall p95, reconnects, protocol errors, and mean/max snapshot
payload bytes. WS byte counts are taken where the application hands a binary
payload to/from the WebSocket implementation; packet capture remains the arbiter
for production TCP/TLS payload accounting.

Local smoke (starts the server and two bots, defaults to 30 seconds):

```sh
pnpm --filter @gungame/tools smoke
```

macOS packet impairment requires sudo because it installs an isolated
`com.apple/gungame` PF anchor and two dummynet pipes. The script cleans up its
anchor and pipes on exit and does not flush unrelated PF state:

```sh
NETSIM_DURATION=600 tools/netsim/macos-dummynet.sh steady
NETSIM_DURATION=600 tools/netsim/macos-dummynet.sh burst
```

The steady profile composes two 75 ms one-way pipes and approximately 2% total
packet loss. Burst timing is deterministic (500 ms every 5 s); dummynet does not
expose a loss-PRNG seed.

Linux CI or hosts without dummynet use bidirectional endpoint `netem` qdiscs.
Both endpoints receive 75 ms one-way delay; independent directional loss
composes to the profile target. The checked-in seed is passed to `netem` when
the host kernel supports the seed extension. Older Docker kernels degrade with
an explicit log to their kernel PRNG; the bot workload seed remains deterministic:

```sh
docker compose -f tools/netsim/compose.yml --profile steady up --abort-on-container-exit
docker compose -f tools/netsim/compose.yml --profile burst up --abort-on-container-exit
```

Reports land in `tools/netsim/reports/`. A transport-gate pass requires
correction p95 below 0.15 m, remote stall p95 below 100 ms, and zero
hard-threshold reconnects in both 10-minute 12-bot profiles.

Each Docker server also wraps the run in `tcpdump` and emits
`steady-tcp.json`/`burst-tcp.json`. Those counters sum TCP payload from source
port 8787, including WebSocket framing and retransmissions, and report decimal
kB/s over the first-to-last payload interval, both aggregate and per client.
`perClientDownKBps` is the §4 bandwidth boundary; bot `meanSnapshotBytes` and
`maxSnapshotBytes` remain protocol-frame sizing metrics.
