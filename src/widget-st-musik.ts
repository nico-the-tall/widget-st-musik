import css from "./style.css?inline";
import win95 from "./win95.css?inline";
import markup from "./widget-st-musik.html?raw";

let tracks: string[] = [];
let currentTrackIndex = -1;
let player: ShadowRoot | null = null;
const audio = document.createElement("audio");
let trackEl: HTMLSpanElement | null = null;
let durationEl: HTMLSpanElement | null = null;

function switchTrack(direction: "prev" | "next") {
  if (direction === "prev") {
    if (currentTrackIndex < 0) {
      currentTrackIndex = tracks.length - 1;
    } else {
      currentTrackIndex =
        (currentTrackIndex - 1 + tracks.length) % tracks.length;
    }
  } else {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  }

  const track = tracks[currentTrackIndex];
  audio.src = `tracks/${track}`;
  trackEl!.textContent = track;
}

function initialize() {
  try {
    const container = document.querySelector("#widget_st_musik")!;
    const shadow = container.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = css + win95;

    shadow.appendChild(style);

    const root = document.createElement("div");
    root.innerHTML = markup;
    shadow.appendChild(root);

    shadow.appendChild(audio);

    player = container.shadowRoot;
  } catch {
    console.error(
      'Could not initialize Musik. Ensure a <div> with id "widget_st_musik" exists on your site.',
    );
  }
}

function initializePlayer() {
  trackEl = player!.querySelector("#track")!;
  durationEl = player!.querySelector("#duration")!;
  trackEl.textContent = "No track selected";
}

async function getTracks() {
  try {
    const res = await fetch("/tracks/manifest.txt");
    const raw = await res.text();

    tracks = raw.split("\n");
  } catch {
    console.error("Could not fetch or process manifest.txt");
  }
}

function formatTime(time: number) {
  if (Number.isNaN(time)) {
    return "00:00";
  }
  const min = String(Math.floor(time / 60)).padStart(2, "0");
  const sec = String(Math.floor(time % 60)).padStart(2, "0");

  return `${min}:${sec}`;
}

function attachEvents() {
  const [
    btnPrevTrack,
    btnRewind,
    btnPlay,
    btnForward,
    btnNextTrack,
  ]: HTMLButtonElement[] = [
    player!.querySelector("#btn_previous_track")!,
    player!.querySelector("#btn_rewind")!,
    player!.querySelector("#btn_play")!,
    player!.querySelector("#btn_forward")!,
    player!.querySelector("#btn_next_track")!,
  ];

  btnPrevTrack.addEventListener("click", () => {
    switchTrack("prev");
    audio.play();
  });

  btnRewind.addEventListener("click", () => {
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  });

  btnPlay.addEventListener("click", () => {
    if (audio.paused) {
      if (currentTrackIndex === -1) {
        switchTrack("next");
      }
      audio.play();
    } else {
      audio.pause();
    }
  });

  btnForward.addEventListener("click", () => {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
  });

  btnNextTrack.addEventListener("click", () => {
    switchTrack("next");
    audio.play();
  });

  audio.addEventListener("play", () => {
    btnPlay.classList.add("btn_controlled");
    btnForward.disabled = false;
    btnRewind.disabled = false;
  });

  audio.addEventListener("pause", () => {
    btnPlay.classList.remove("btn_controlled");
    btnForward.disabled = true;
    btnRewind.disabled = true;
  });

  audio.addEventListener("timeupdate", () => {
    durationEl!.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

  audio.addEventListener("loadedmetadata", () => {
    durationEl!.textContent = `00:00 / ${formatTime(audio.duration)}`;
  });
}

(async () => {
  initialize();
  initializePlayer();
  await getTracks();
  attachEvents();
})();
