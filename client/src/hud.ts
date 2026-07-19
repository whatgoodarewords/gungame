import { RoundState, type ScoreboardEntry } from "../../packages/protocol/src/index.js";
import type { HudState } from "./hud-state.js";

export interface HudStatus {
  readonly health: number;
  readonly tier: number;
  readonly ladderLength: number;
  readonly weapon: string;
  readonly ammo?: readonly [number, number];
  readonly speed: number;
}

export class MatchHud {
  readonly root: HTMLElement;
  readonly hitmarker: HTMLElement;
  readonly damageNumber: HTMLElement;
  readonly damageDirection: HTMLElement;
  readonly zoomOverlay: HTMLElement;
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

  constructor(parent: HTMLElement) {
    const root = document.createElement("section");
    root.className = "combat-hud";
    root.innerHTML = `
      <div class="hud-readout hud-health"><span>HEALTH</span><strong>100</strong></div>
      <div class="hud-readout hud-ladder"><span>TIER</span><strong>1/6</strong><small></small></div>
      <div class="hud-readout hud-ammo"><span>AMMO</span><strong>—</strong></div>
      <div class="hud-readout hud-speed"><span>SPEED</span><strong>0.0 m/s</strong></div>
      <div class="crosshair" aria-hidden="true">+</div>
      <div class="hitmarker" aria-hidden="true">×</div>
      <div class="damage-number"></div>
      <div class="damage-direction" aria-hidden="true">▲</div>
      <div class="zoom-overlay"><span class="scope-reticle"></span></div>
      <div class="death-overlay">ELIMINATED<br><small>respawning…</small></div>
      <div class="win-overlay"><strong>ROUND COMPLETE</strong><small>scoreboard frozen</small></div>
      <ol class="killfeed" aria-label="Kill feed"></ol>
      <div class="scoreboard"><h2>SCOREBOARD</h2><div class="scoreboard-body"></div></div>
      <div class="system-overlay"><strong></strong><button type="button">Reload client</button></div>
      <button type="button" class="invite-copy">Copy invite link</button>`;
    parent.appendChild(root);
    this.root = root;
    this.health = root.querySelector(".hud-health strong")!;
    this.ladder = root.querySelector(".hud-ladder")!;
    this.ammo = root.querySelector(".hud-ammo strong")!;
    this.speed = root.querySelector(".hud-speed strong")!;
    this.hitmarker = root.querySelector(".hitmarker")!;
    this.damageNumber = root.querySelector(".damage-number")!;
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
    this.reloadButton.onclick = () => location.reload();
  }

  setStatus(status: HudStatus): void {
    this.health.textContent = String(status.health);
    this.ladder.querySelector("strong")!.textContent = `${status.tier}/${status.ladderLength}`;
    this.ladder.querySelector("small")!.textContent = status.weapon;
    this.ammo.textContent = status.ammo === undefined ? "—" : `${status.ammo[0]}/${status.ammo[1]}`;
    this.speed.textContent = `${status.speed.toFixed(1)} m/s`;
  }

  setState(state: HudState): void {
    this.death.classList.toggle("visible", state === "dead");
    this.win.classList.toggle("visible", state === "win");
    const system = state === "server-restarting" || state === "connection-lost" || state === "version-mismatch";
    this.system.classList.toggle("visible", system);
    this.reloadButton.hidden = state !== "version-mismatch";
    this.systemText.textContent = state === "server-restarting"
      ? "SERVER RESTARTING — RECONNECTING…"
      : state === "connection-lost"
        ? "CONNECTION LOST"
        : state === "version-mismatch"
          ? "CLIENT UPDATE REQUIRED"
          : "";
  }

  setScoreboard(
    entries: readonly ScoreboardEntry[],
    held: boolean,
    roundState: number,
    heading: string,
  ): void {
    this.scoreboard.classList.toggle("visible", held || roundState === RoundState.ScoreboardFreeze);
    this.scoreboardBody.replaceChildren();
    if (heading !== "") {
      const title = document.createElement("strong");
      title.textContent = heading;
      this.scoreboardBody.appendChild(title);
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      const player = document.createElement("span");
      player.textContent = `P${entry.playerId}${entry.team === 0 ? "" : ` · T${entry.team}`}`;
      const score = document.createElement("span");
      score.textContent = `${entry.kills}/${entry.deaths} · tier ${entry.tier}`;
      row.append(player, score);
      this.scoreboardBody.appendChild(row);
    }
  }

  addKillfeed(text: string): void {
    const item = document.createElement("li");
    item.textContent = text;
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
      this.invite.textContent = "Invite copied";
    }, { once: true });
  }
}
