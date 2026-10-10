import markup from "./widget-st-musik.html?raw";

interface Settings {
  theme?: string;
  stylesheet_href?: string;
  autoplay?: boolean;
  randomize?: boolean;
}

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

const currentScript = document.currentScript as HTMLScriptElement | null;

const tracksBaseUrl = new URL("/tracks/", document.baseURI);

let tracks: string[] = [];
let currentTrackIndex = -1;
let playOrder: number[] = [];
let playOrderPos = -1;
let player: ShadowRoot | null = null;
const audio = document.createElement("audio");
let trackEl: HTMLSpanElement | null = null;
let durationEl: HTMLSpanElement | null = null;
let listEl: HTMLDivElement | null = null;
let settings: Settings = {};

function shufflePlayOrder() {
  playOrder = tracks.map((_, index) => index);

  for (let i = playOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playOrder[i], playOrder[j]] = [playOrder[j], playOrder[i]];
  }

  playOrderPos = -1;
}

function playAudio() {
  return audio.play().then(
    () => true,
    (error) => {
      console.error("Could not play track:", error);
      return false;
    },
  );
}

function setTrack() {
  const track = tracks[currentTrackIndex];
  audio.src = new URL(track, tracksBaseUrl).href;
  trackEl!.textContent = track;

  player!
    .querySelector("#widget_st_musik_top")
    ?.setAttribute("title", tracks[currentTrackIndex]);

  return playAudio();
}

function switchTrackToIndex(index: number) {
  currentTrackIndex = index;

  if (settings.randomize) {
    playOrderPos = playOrder.indexOf(index);
  }

  return setTrack();
}

function switchTrack(direction: "prev" | "next") {
  if (tracks.length === 0) {
    return;
  }

  if (settings.randomize) {
    if (playOrder.length !== tracks.length) {
      shufflePlayOrder();
    }

    if (direction === "prev") {
      playOrderPos =
        playOrderPos <= 0 ? playOrder.length - 1 : playOrderPos - 1;
    } else {
      if (playOrderPos >= playOrder.length - 1) {
        shufflePlayOrder();
      }
      playOrderPos += 1;
    }

    currentTrackIndex = playOrder[playOrderPos];
  } else if (direction === "prev") {
    if (currentTrackIndex < 0) {
      currentTrackIndex = tracks.length - 1;
    } else {
      currentTrackIndex =
        (currentTrackIndex - 1 + tracks.length) % tracks.length;
    }
  } else {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  }

  return setTrack();
}

function initialize() {
  try {
    const container = currentScript!.parentElement!;
    const shadow = container.attachShadow({ mode: "open" });

    try {
      if (currentScript!.dataset.settings) {
        settings = JSON.parse(
          decodeURIComponent(currentScript!.dataset.settings),
        );
      }
    } catch {
      console.error("Could not parse widget settings. Using defaults.");
    }

    const style = document.createElement("style");

    const builtInThemeName = settings.theme ?? "win95";

    if (builtInThemeName !== "none") {
      const builtInTheme = themes[builtInThemeName as string];

      if (builtInTheme) {
        style.textContent = builtInTheme;
      } else {
        console.error(
          "The selected theme for widget_st_musik does not exist. Please verify the name.",
        );
      }
    }

    shadow.appendChild(style);

    const customStylesheetHref = settings["stylesheet_href"];

    if (typeof customStylesheetHref === "string" && customStylesheetHref) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = customStylesheetHref;

      shadow.appendChild(link);
    }

    const root = document.createElement("div");
    root.innerHTML = markup;
    shadow.appendChild(root);

    shadow.appendChild(audio);

    player = container.shadowRoot;
    listEl = player!.querySelector("#widget_st_musik_list");

    return true;
  } catch {
    console.error(
      "Could not initialize Musik. Ensure the widget script tag is embedded correctly.",
    );

    return false;
  }
}

function initializePlayer() {
  trackEl = player!.querySelector("#widget_st_musik_track")!;
  durationEl = player!.querySelector("#widget_st_musik_duration")!;
  trackEl.textContent = "No track selected";
}

async function getTracks() {
  try {
    const res = await fetch(new URL("manifest.txt", tracksBaseUrl));

    if (!res.ok) {
      throw new Error(`manifest.txt responded with ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";

    if (/html|json/i.test(contentType)) {
      throw new Error(`manifest.txt responded with ${contentType}`);
    }

    const raw = await res.text();

    tracks = raw
      .split("\n")
      .map((track) => track.trim())
      .filter(Boolean);

    tracks.forEach((track, index) => {
      const btn = document.createElement("button");
      btn.textContent = track;
      btn.setAttribute("data-idx", String(index));

      listEl!.appendChild(btn);
    });

    return true;
  } catch {
    console.error("Could not fetch or process manifest.txt");

    return false;
  }
}

function disablePlayer() {
  trackEl!.textContent = "Manifest missing!";

  player!.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;
  });
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
      playAudio();
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
  if (!initialize()) {
    return;
  }

  initializePlayer();

  if (!(await getTracks())) {
    disablePlayer();
    return;
  }

  attachEvents();

  if (settings.randomize && tracks.length > 0) {
    shufflePlayOrder();
  }

  if (settings.autoplay) {
    const startIndex = settings.randomize ? playOrder[0] : 0;

    switchTrackToIndex(startIndex).then((played) => {
      if (played) {
        return;
      }

      function retryAutoplay() {
        document.removeEventListener("click", retryAutoplay);
        document.removeEventListener("keydown", retryAutoplay);

        if (audio.paused) {
          playAudio();
        }
      }

      document.addEventListener("click", retryAutoplay);
      document.addEventListener("keydown", retryAutoplay);
    });
  }
})();
