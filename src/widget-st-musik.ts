import markup from "./widget-st-musik.html?raw";

const themeModules = import.meta.glob<string>("./themes/*.css", {
  eager: true,
  query: "?inline",
  import: "default",
});

const themes = Object.fromEntries(
  Object.entries(themeModules).map(([path, css]) => [
    path.match(/\/([^/]+)\.css$/)![1],
    css,
  ]),
);

let tracks: string[] = [];
let currentTrackIndex = -1;
let player: ShadowRoot | null = null;
const audio = document.createElement("audio");
let trackEl: HTMLSpanElement | null = null;
let durationEl: HTMLSpanElement | null = null;
let listEl: HTMLDivElement | null = null;

function setTrack() {
  const track = tracks[currentTrackIndex];
  audio.src = `tracks/${track}`;
  trackEl!.textContent = track;
  audio.play();
}

function switchTrackToIndex(index: number) {
  currentTrackIndex = index;
  setTrack();
}

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

  setTrack();
}

function initialize() {
  try {
    const container = document.querySelector("#widget_st_musik")!;
    const shadow = container.attachShadow({ mode: "open" });

    const style = document.createElement("style");

    const builtInTheme = container.getAttribute("data-theme") ?? "win95";

    if (builtInTheme) {
      style.textContent = themes[builtInTheme];
    }

    shadow.appendChild(style);

    const root = document.createElement("div");
    root.innerHTML = markup;
    shadow.appendChild(root);

    shadow.appendChild(audio);

    player = container.shadowRoot;
    listEl = player!.querySelector("#widget_st_musik_list");
  } catch {
    console.error(
      'Could not initialize Musik. Ensure a <div> with id "widget_st_musik" exists on your site.',
    );
  }
}

function initializePlayer() {
  trackEl = player!.querySelector("#widget_st_musik_track")!;
  durationEl = player!.querySelector("#widget_st_musik_duration")!;
  trackEl.textContent = "No track selected";
}

async function getTracks() {
  try {
    const res = await fetch("/tracks/manifest.txt");
    const raw = await res.text();

    tracks = raw.split("\n");

    tracks.forEach((track, index) => {
      const btn = document.createElement("button");
      btn.textContent = track;
      btn.setAttribute("data-idx", String(index));

      listEl!.appendChild(btn);
    });
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
    btnList,
  ]: HTMLButtonElement[] = [
    player!.querySelector("#widget_st_musik_btn_previous_track")!,
    player!.querySelector("#widget_st_musik_btn_rewind")!,
    player!.querySelector("#widget_st_musik_btn_play")!,
    player!.querySelector("#widget_st_musik_btn_forward")!,
    player!.querySelector("#widget_st_musik_btn_next_track")!,
    player!.querySelector("#widget_st_musik_list_btn")!,
  ];

  btnList.addEventListener("click", () => {
    listEl!.classList.toggle("list_hidden");
  });

  listEl!.addEventListener("click", (event) => {
    const target = event.target as HTMLButtonElement;

    if (target.tagName === "BUTTON") {
      const index = target.getAttribute("data-idx");
      switchTrackToIndex(Number(index));
    }
  });

  btnPrevTrack.addEventListener("click", () => {
    switchTrack("prev");
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

  audio.addEventListener("ended", () => {
    switchTrack("next");
  });
}

(async () => {
  initialize();
  initializePlayer();
  await getTracks();
  attachEvents();
})();
