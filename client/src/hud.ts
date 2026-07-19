import { RoundState, type ScoreboardEntry } from "../../packages/protocol/src/index.js";
import type { HudState } from "./hud-state.js";
import type { CrosshairSettings } from "./settings.js";

export interface HudStatus {
  readonly health: number;
  readonly tier: number;
  readonly ladderLength: number;
  readonly weapon: string;
  readonly ammo?: readonly [number, number];
  readonly speed: number;
  readonly typeIcon: string;
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
  private readonly system: HTMLElement;
  private readonly systemText: HTMLElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly invite: HTMLElement;
  private readonly pointerOverlay: HTMLButtonElement;
  private readonly toast: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly ping: HTMLElement;
  private readonly afk: HTMLElement;
  private readonly damageNumbers: HTMLElement;
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
      <div class="win-overlay"><strong>round complete</strong><small>scoreboard frozen</small></div>
      <div class="tier-banner"></div>
      <div class="how-to-toast"></div>
      <div class="afk-warning"></div>
      <ol class="killfeed" aria-label="kill feed"></ol>
      <div class="scoreboard"><header><h2>scoreboard</h2><button type="button" class="scoreboard-invite">copy invite</button></header><div class="scoreboard-meta"></div><div class="scoreboard-head"><span>player</span><span>k / d</span><span>ping</span><span>tier</span></div><div class="scoreboard-body"></div></div>
      <button type="button" class="resume-overlay">click to re-enter</button>
      <div class="system-overlay"><strong></strong><button type="button">reload client</button><button type="button" class="rejoin-button">rejoin</button></div>
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
    this.damageDirection = root.querySelector(".damage-direction")!;
    this.zoomOverlay = root.querySelector(".zoom-overlay")!;
    this.killfeed = root.querySelector(".killfeed")!;
    this.scoreboard = root.querySelector(".scoreboard")!;
    this.scoreboardBody = root.querySelector(".scoreboard-body")!;
    this.death = root.querySelector(".death-overlay")!;
    this.win = root.querySelector(".win-overlay")!;
    this.system = root.querySelector(".system-overlay")!;
    this.systemText = root.querySelector(".system-overlay strong")!;
    this.reloadButton = root.querySelector(".system-overlay button")!;
    this.invite = root.querySelector(".invite-copy")!;
    this.pointerOverlay = root.querySelector(".resume-overlay")!;
    this.toast = root.querySelector(".how-to-toast")!;
    this.banner = root.querySelector(".tier-banner")!;
    this.ping = root.querySelector(".hud-ping")!;
    this.afk = root.querySelector(".afk-warning")!;
    this.reloadButton.onclick = () => location.reload();
    root.querySelector<HTMLButtonElement>(".rejoin-button")!.onclick = () => this.rejoin?.();
    this.pointerOverlay.onclick = () => this.resume?.();
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

  setAfkWarning(visible: boolean): void {
    this.afk.textContent = "move or be kicked in 10 s";
    this.afk.classList.toggle("visible", visible);
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
    this.systemText.textContent = `reconnecting… ${seconds}`;
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
      player.textContent = `P${entry.playerId}${entry.team === 0 ? "" : ` · T${entry.team}`}`;
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
    this.invite.addEventListener("click", () => {
      const url = new URL(location.href);
      url.search = "";
      url.pathname = `${url.pathname.replace(/\/$/, "")}/r/${roomId}`;
      url.searchParams.set("room", roomId);
      void navigator.clipboard.writeText(url.toString());
      this.invite.textContent = "invite copied";
    }, { once: true });
    const boardInvite = this.root.querySelector<HTMLButtonElement>(".scoreboard-invite")!;
    boardInvite.onclick = () => this.invite.click();
  }
}
