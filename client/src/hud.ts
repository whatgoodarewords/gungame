import { RoundState, type ScoreboardEntry } from "../../packages/protocol/src/index.js";
import type { MatchStats } from "../../packages/protocol/src/index.js";
import type { HudState } from "./hud-state.js";
import type { CrosshairSettings } from "./settings.js";
import type { MatchStatKey } from "./match-stats.js";
import { MATCH_STAT_KEYS, formatMatchStats } from "./match-stats.js";
import { webSocketCloseForensics } from "./net/session.js";
import { canonicalRoomUrl } from "./room-url.js";

export interface HudStatus {
  readonly health: number;
  readonly tier: number;
  readonly ladderLength: number;
  readonly weapon: string;
  readonly ammo?: readonly [number, number];
  readonly speed: number;
  readonly typeIcon: string;
}

export function reconnectStatusText(seconds?: number): string {
  return seconds === undefined
    ? "connection lost — rejoin?"
    : `reconnecting… ${Math.max(0, Math.floor(seconds))}`;
}

export function inviteUrl(currentHref: string, roomId: string): string {
  return canonicalRoomUrl(currentHref, roomId);
}

export function armInviteCopy(
  control: {
    textContent: string | null;
    onclick: ((event: PointerEvent) => unknown) | null;
  },
  currentHref: string,
  roomId: string,
  write: (url: string) => void | Promise<void>,
): void {
  control.onclick = () => {
    void write(inviteUrl(currentHref, roomId));
    control.textContent = "invite copied";
  };
}

export class MatchHud {
  readonly root: HTMLElement;
  readonly hitmarker: HTMLElement;
  readonly damageDirection: HTMLElement;
  readonly zoomOverlay: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly health: HTMLElement;
  private readonly ladder: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly killfeed: HTMLOListElement;
  private readonly scoreboard: HTMLElement;
  private readonly scoreboardBody: HTMLElement;
  private readonly death: HTMLElement;
  private readonly win: HTMLElement;
  private readonly matchStats: HTMLElement;
  private readonly system: HTMLElement;
  private readonly systemText: HTMLElement;
  private readonly systemTelemetry: HTMLElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly invite: HTMLElement;
  private readonly pointerOverlay: HTMLButtonElement;
  private readonly toast: HTMLElement;
  private readonly qualityToast: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly ping: HTMLElement;
  private readonly afk: HTMLElement;
  private readonly trialTimer: HTMLElement;
  private readonly damageNumbers: HTMLElement;
  private readonly clipToast: HTMLElement;
  private readonly killClip: HTMLButtonElement;
  private selfId = 0;
  private rejoin: (() => void) | undefined;
  private resume: (() => void) | undefined;

  constructor(parent: HTMLElement) {
    const root = document.createElement("section");
    root.className = "combat-hud";
    root.innerHTML = `
      <div class="hud-readout hud-health"><span>health</span><strong>100</strong></div>
      <div class="hud-readout hud-ladder"><span>tier</span><strong>1/6</strong><small></small></div>
      <div class="hud-readout hud-ammo"><span>ammo</span><strong>—</strong></div>
      <div class="hud-readout hud-speed"><span>speed</span><strong>0.0 m/s</strong></div>
      <div class="hud-ping" data-tone="normal">0 ms</div>
      <div class="crosshair" aria-hidden="true">
        <i class="hair hair-top"></i><i class="hair hair-right"></i>
        <i class="hair hair-bottom"></i><i class="hair hair-left"></i>
        <i class="cross-dot"></i><i class="kill-x"></i>
      </div>
      <div class="hitmarker" aria-hidden="true"></div>
      <div class="damage-numbers"></div>
      <div class="damage-direction" aria-hidden="true">▲</div>
      <div class="zoom-overlay"><span class="scope-reticle"></span></div>
      <div class="spawn-fade"></div>
      <div class="death-overlay"><strong>eliminated</strong><small>respawning…</small></div>
      <div class="win-overlay"><strong>round complete</strong><div class="match-stats-screen"><div class="match-stats-values"></div><button type="button">share</button></div></div>
      <div class="tier-banner"></div>
      <div class="how-to-toast"></div>
      <div class="render-quality-toast"><strong>visual quality reduced</strong>
        <a>reload with WebGL2</a></div>
      <div class="afk-warning"></div>
      <div class="trial-timer"></div>
      <div class="clip-toast"><span></span><button type="button">clip</button></div>
      <button type="button" class="kill-clip">clip · f8</button>
      <ol class="killfeed" aria-label="kill feed"></ol>
      <div class="scoreboard"><header><h2>scoreboard</h2><button type="button" class="scoreboard-invite">copy invite</button></header><div class="scoreboard-meta"></div><div class="scoreboard-head"><span>player</span><span>k / d</span><span>ping</span><span>tier</span></div><div class="scoreboard-body"></div></div>
      <button type="button" class="resume-overlay">click to re-enter</button>
      <div class="system-overlay"><strong></strong><small class="connection-telemetry"></small><button type="button">reload client</button><button type="button" class="rejoin-button">rejoin</button></div>
      <button type="button" class="invite-copy">copy invite link</button>`;
    parent.appendChild(root);
    this.root = root;
    this.crosshair = root.querySelector(".crosshair")!;
    this.health = root.querySelector(".hud-health strong")!;
    this.ladder = root.querySelector(".hud-ladder")!;
    this.ammo = root.querySelector(".hud-ammo strong")!;
    this.speed = root.querySelector(".hud-speed strong")!;
    this.hitmarker = root.querySelector(".hitmarker")!;
    this.damageNumbers = root.querySelector(".damage-numbers")!;
    this.clipToast = root.querySelector(".clip-toast")!;
    this.killClip = root.querySelector(".kill-clip")!;
    this.damageDirection = root.querySelector(".damage-direction")!;
    this.zoomOverlay = root.querySelector(".zoom-overlay")!;
    this.killfeed = root.querySelector(".killfeed")!;
    this.scoreboard = root.querySelector(".scoreboard")!;
    this.scoreboardBody = root.querySelector(".scoreboard-body")!;
    this.death = root.querySelector(".death-overlay")!;
    this.win = root.querySelector(".win-overlay")!;
    this.matchStats = root.querySelector(".match-stats-screen")!;
    this.system = root.querySelector(".system-overlay")!;
    this.systemText = root.querySelector(".system-overlay strong")!;
    this.systemTelemetry = root.querySelector(".connection-telemetry")!;
    this.reloadButton = root.querySelector(".system-overlay button")!;
    this.invite = root.querySelector(".invite-copy")!;
    this.pointerOverlay = root.querySelector(".resume-overlay")!;
    this.toast = root.querySelector(".how-to-toast")!;
    this.qualityToast = root.querySelector(".render-quality-toast")!;
    this.banner = root.querySelector(".tier-banner")!;
    this.ping = root.querySelector(".hud-ping")!;
    this.afk = root.querySelector(".afk-warning")!;
    this.trialTimer = root.querySelector(".trial-timer")!;
    this.reloadButton.onclick = () => location.reload();
    root.querySelector<HTMLButtonElement>(".rejoin-button")!.onclick = () => this.rejoin?.();
    this.pointerOverlay.onclick = () => this.resume?.();
  }

  showRenderQualityReduced(webgl2Url: string): void {
    const link = this.qualityToast.querySelector<HTMLAnchorElement>("a")!;
    link.href = webgl2Url;
    this.qualityToast.classList.add("visible");
  }

  setStatus(status: HudStatus): void {
    this.health.textContent = String(status.health);
    this.ladder.querySelector("strong")!.textContent = `${status.tier}/${status.ladderLength}`;
    this.ladder.querySelector("small")!.textContent =
      `${status.typeIcon} ${status.weapon.toLowerCase()}`;
    this.ammo.textContent = status.ammo === undefined ? "—" : `${status.ammo[0]}/${status.ammo[1]}`;
    this.speed.textContent = `${status.speed.toFixed(1)} m/s`;
  }

  setState(state: HudState): void {
    this.death.classList.toggle("visible", state === "dead");
    this.win.classList.toggle("visible", state === "win");
    if (state !== "win") this.matchStats.classList.remove("visible");
    const system = state === "server-restarting" || state === "connection-lost" || state === "version-mismatch";
    this.system.classList.toggle("visible", system);
    this.reloadButton.hidden = state !== "version-mismatch";
    this.root.querySelector<HTMLButtonElement>(".rejoin-button")!.hidden =
      state !== "connection-lost";
    this.systemText.textContent = state === "server-restarting"
      ? "server restarting — reconnecting…"
      : state === "connection-lost"
        ? "connection lost"
        : state === "version-mismatch"
          ? "client update required"
          : "";
  }

  showMatchStats(
    stats: MatchStats,
    personalBests: ReadonlySet<MatchStatKey>,
    onShare: () => void,
  ): void {
    const values = this.matchStats.querySelector<HTMLElement>(".match-stats-values")!;
    values.replaceChildren(...formatMatchStats(stats).map(([label, value], index) => {
      const item = document.createElement("span");
      const noun = document.createElement("small");
      noun.textContent = label;
      const number = document.createElement("strong");
      number.textContent = value;
      item.classList.toggle("personal-best", personalBests.has(MATCH_STAT_KEYS[index]!));
      item.append(noun, number);
      return item;
    }));
    this.matchStats.querySelector<HTMLButtonElement>("button")!.onclick = onShare;
    this.matchStats.classList.add("visible");
  }

  setSelfId(id: number): void {
    this.selfId = id;
  }

  onResume(callback: () => void): void {
    this.resume = callback;
  }

  onRejoin(callback: () => void): void {
    this.rejoin = callback;
  }

  setPointerLock(locked: boolean, hidden = document.hidden): void {
    this.pointerOverlay.classList.toggle("visible", !locked);
    this.pointerOverlay.textContent = hidden ? "return to resume" : "click to re-enter";
  }

  setCrosshair(
    settings: CrosshairSettings,
    gapPixels: number,
    scoped: boolean,
  ): void {
    this.crosshair.style.setProperty("--cross-size", `${settings.size}px`);
    this.crosshair.style.setProperty("--cross-gap", `${gapPixels}px`);
    this.crosshair.style.setProperty(
      "--cross-stroke",
      `${1.5 / Math.max(1, window.devicePixelRatio)}px`,
    );
    this.crosshair.dataset.color = settings.color;
    this.crosshair.classList.toggle("dot", settings.dot);
    this.crosshair.classList.toggle("scoped", scoped);
  }

  flashHit(kill = false): void {
    this.crosshair.classList.remove("hit-flash", "kill-flash");
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add(kill ? "kill-flash" : "hit-flash");
    setTimeout(() => this.crosshair.classList.remove("hit-flash", "kill-flash"), 60);
  }

  showDamageNumber(amount: number, critical: boolean): void {
    const value = document.createElement("span");
    value.textContent = String(amount);
    value.classList.toggle("critical", critical);
    this.damageNumbers.appendChild(value);
    setTimeout(() => value.remove(), 400);
  }

  setPing(milliseconds: number, tone: "normal" | "amber" | "red"): void {
    this.ping.textContent = `${Math.round(milliseconds)} ms`;
    this.ping.dataset.tone = tone;
  }

  showHowTo(lines: readonly string[]): void {
    this.toast.replaceChildren(...lines.map((line) => {
      const span = document.createElement("span");
      span.textContent = line;
      return span;
    }));
    this.toast.classList.add("visible");
  }

  dismissHowTo(): void {
    this.toast.classList.remove("visible");
  }

  showBanner(text: string, demotion = false): void {
    this.banner.textContent = text.toLowerCase();
    this.banner.classList.toggle("demotion", demotion);
    this.banner.classList.add("visible");
    setTimeout(() => this.banner.classList.remove("visible"), 600);
  }

  showAccolade(chain: number): void {
    this.banner.textContent = chain === 2 ? "impressive" : `impressive · ${chain}`;
    this.banner.classList.remove("demotion");
    this.banner.classList.add("accolade", "visible");
    setTimeout(() => this.banner.classList.remove("visible", "accolade"), 500);
  }

  setAfkWarning(visible: boolean): void {
    this.afk.textContent = "move or be kicked in 10 s";
    this.afk.classList.toggle("visible", visible);
  }

  setTrialTimer(visible: boolean, elapsedMs: number, bestMs?: number): void {
    this.trialTimer.classList.toggle("visible", visible);
    if (!visible) return;
    const elapsed = (elapsedMs / 1_000).toFixed(3);
    this.trialTimer.textContent = bestMs === undefined
      ? elapsed
      : `${elapsed} · best ${(bestMs / 1_000).toFixed(3)}`;
  }

  showClipSuggestion(label: string, onClip: () => void): void {
    this.clipToast.querySelector("span")!.textContent = label.toLowerCase();
    this.clipToast.querySelector<HTMLButtonElement>("button")!.onclick = onClip;
    this.clipToast.classList.add("visible");
    setTimeout(() => this.clipToast.classList.remove("visible"), 5_000);
  }

  showKillClip(onClip: () => void): void {
    this.killClip.onclick = onClip;
    this.killClip.classList.add("visible");
    setTimeout(() => this.killClip.classList.remove("visible"), 2_400);
  }

  showSpawnFade(): void {
    const fade = this.root.querySelector(".spawn-fade")!;
    fade.classList.remove("visible");
    void (fade as HTMLElement).offsetWidth;
    fade.classList.add("visible");
  }

  setDeathDetails(killer: string, weapon: string, health: number, seconds: number): void {
    this.death.innerHTML = `<strong>eliminated</strong><small>${killer.toLowerCase()} · ${weapon.toLowerCase()} · ${health} hp<br>respawning in ${Math.max(0, seconds).toFixed(1)} · keep your tier</small>`;
  }

  setReconnectCountdown(seconds: number): void {
    this.system.classList.add("visible");
    this.systemText.textContent = reconnectStatusText(seconds);
  }

  setReconnectExhausted(): void {
    this.system.classList.add("visible");
    this.systemText.textContent = reconnectStatusText();
  }

  setConnectionTelemetry(code: number, reason: string): void {
    this.systemTelemetry.textContent = webSocketCloseForensics(code, reason).telemetry;
  }

  setScoreboard(
    entries: readonly ScoreboardEntry[],
    held: boolean,
    roundState: number,
    heading: string,
    metadata: {
      readonly room: string;
      readonly elapsedSeconds: number;
      readonly ping: number;
    } = { room: "", elapsedSeconds: 0, ping: 0 },
  ): void {
    this.scoreboard.classList.toggle("visible", held || roundState === RoundState.ScoreboardFreeze);
    this.scoreboardBody.replaceChildren();
    const minutes = Math.floor(metadata.elapsedSeconds / 60);
    const seconds = Math.floor(metadata.elapsedSeconds % 60);
    this.root.querySelector(".scoreboard-meta")!.textContent =
      `${metadata.room || "room"} · ${minutes}:${String(seconds).padStart(2, "0")}${heading === "" ? "" : ` · ${heading.toLowerCase()}`}`;
    for (const entry of entries) {
      const row = document.createElement("div");
      row.classList.toggle("self", entry.playerId === this.selfId);
      const player = document.createElement("span");
      player.textContent = `${entry.name ?? `P${entry.playerId}`}${entry.team === 0 ? "" : ` · T${entry.team}`}`;
      if (entry.bot === true) {
        const dot = document.createElement("i");
        dot.className = "bot-dot";
        dot.setAttribute("aria-label", "bot");
        player.append(" ", dot);
      }
      const score = document.createElement("span");
      score.textContent = `${entry.kills} / ${entry.deaths}`;
      const ping = document.createElement("span");
      ping.textContent = entry.playerId === this.selfId ? `${Math.round(metadata.ping)}` : "—";
      const tier = document.createElement("span");
      tier.textContent = String(entry.tier);
      row.append(player, score, ping, tier);
      this.scoreboardBody.appendChild(row);
    }
  }

  addKillfeed(text: string, emphasized = false): void {
    const item = document.createElement("li");
    item.textContent = text.toLowerCase();
    item.classList.toggle("self", emphasized);
    this.killfeed.prepend(item);
    while (this.killfeed.children.length > 6) this.killfeed.lastElementChild?.remove();
    setTimeout(() => item.remove(), 5_000);
  }

  showInvite(roomId: string): void {
    if (roomId === "") return;
    this.invite.classList.add("visible");
    this.invite.textContent = "copy invite link";
    // Assigning onclick keeps the action re-armed after every copy and also
    // replaces a prior room's closure when a new invite is shown.
    armInviteCopy(
      this.invite,
      location.href,
      roomId,
      (url) => navigator.clipboard.writeText(url),
    );
    const boardInvite = this.root.querySelector<HTMLButtonElement>(".scoreboard-invite")!;
    boardInvite.onclick = () => this.invite.click();
  }

  setInviteRoom(roomId: string): void {
    if (roomId === "") return;
    const boardInvite = this.root.querySelector<HTMLButtonElement>(".scoreboard-invite")!;
    armInviteCopy(
      boardInvite,
      location.href,
      roomId,
      (url) => navigator.clipboard.writeText(url),
    );
  }
}
