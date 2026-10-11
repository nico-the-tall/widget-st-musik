import markup from "./widget-st-musik.html?raw";
import scrollTitleCss from "./scroll-title.css?inline";

interface Settings {
  theme?: string;
  stylesheet_href?: string;
  autoplay?: boolean;
  randomize?: boolean;
  secondary_bar?: boolean;
  scrollable_title?: boolean;
  manifest?: string;
}

interface Track {
  src: string;
  title: string;
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

const currentScript = (document.currentScript ??
  document.querySelector(
    'script[src*="widget-st-musik"]',
  )) as HTMLScriptElement | null;

const tracksBaseUrl = new URL("/tracks/", document.baseURI);

let tracks: Track[] = [];
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

const TITLE_SCROLL_SPEED = 30;
const TITLE_SCROLL_PAUSE = 2000;

let titleAnimation: Animation | null = null;

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function updateTitleScroll() {
  titleAnimation?.cancel();
  titleAnimation = null;
  trackEl!.classList.remove("widget_st_musik_track_scrolling");

  const overflow = trackEl!.scrollWidth - trackEl!.clientWidth;

  if (overflow <= 0) {
    return;
  }

  trackEl!.classList.add("widget_st_musik_track_scrolling");

  const textEl = trackEl!.firstElementChild as HTMLElement | null;

  if (
    !textEl ||
    // check for animations API
    typeof textEl.animate !== "function" ||
    prefersReducedMotion()
  ) {
    return;
  }

  const move = (overflow / TITLE_SCROLL_SPEED) * 1000;
  const duration = 2 * (TITLE_SCROLL_PAUSE + move);
  const start = "translateX(0)";
  const end = `translateX(-${overflow}px)`;

  titleAnimation = textEl.animate(
    [
      { transform: start, offset: 0 },
      { transform: start, offset: TITLE_SCROLL_PAUSE / duration },
      { transform: end, offset: (TITLE_SCROLL_PAUSE + move) / duration },
      { transform: end, offset: (2 * TITLE_SCROLL_PAUSE + move) / duration },
      { transform: start, offset: 1 },
    ],
    { duration, iterations: Infinity, easing: "linear" },
  );
}

function setTrackText(text: string) {
  if (!settings.scrollable_title) {
    trackEl!.textContent = text;
    return;
  }

  const textEl = document.createElement("span");
  textEl.className = "widget_st_musik_track_text";
  textEl.textContent = text;
  trackEl!.replaceChildren(textEl);

  updateTitleScroll();
}

function updateMediaSessionMetadata(track: Track) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") {
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({ title: track.title });
}

function setMediaSessionHandlers(handlers: [MediaSessionAction, () => void][]) {
  if (!("mediaSession" in navigator)) {
    return;
  }

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      continue;
    }
  }
}

function setTrack() {
  const track = tracks[currentTrackIndex];
  audio.src = new URL(track.src, tracksBaseUrl).href;
  setTrackText(track.title);

  player!
    .querySelector("#widget_st_musik_top")
    ?.setAttribute("title", track.title);

  listEl!.querySelectorAll("button").forEach((btn) => {
    if (btn.dataset.idx === String(currentTrackIndex)) {
      btn.setAttribute("aria-current", "true");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  updateMediaSessionMetadata(track);

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

const STYLESHEET_TIMEOUT = 3000;

function hideUntilLoaded(root: HTMLElement, link: HTMLLinkElement) {
  root.style.display = "none";

  const reveal = () => {
    clearTimeout(timeout);
    root.style.removeProperty("display");
  };

  const timeout = setTimeout(reveal, STYLESHEET_TIMEOUT);

  link.addEventListener("load", reveal, { once: true });
  link.addEventListener("error", reveal, { once: true });
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

    if (settings.scrollable_title) {
      const scrollStyle = document.createElement("style");
      scrollStyle.textContent = scrollTitleCss;
      shadow.appendChild(scrollStyle);
    }

    const root = document.createElement("div");
    root.innerHTML = markup;

    if (!settings.secondary_bar) {
      root.querySelector("#widget_st_musik_secondary")?.remove();
    }

    const customStylesheetHref = settings["stylesheet_href"];

    if (typeof customStylesheetHref === "string" && customStylesheetHref) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = customStylesheetHref;

      hideUntilLoaded(root, link);
      shadow.appendChild(link);
    }

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
  setTrackText("No track selected");

  if (settings.scrollable_title && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(updateTitleScroll).observe(trackEl);
  }
}

function parseTextManifest(raw: string): Track[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ src: line, title: line }));
}

function parseJsonManifest(raw: string): Track[] {
  const data = JSON.parse(raw);

  if (!data || typeof data !== "object" || !Array.isArray(data.tracks)) {
    throw new Error("manifest.json must be an object with a tracks array");
  }

  const parsed: Track[] = [];

  for (const entry of data.tracks) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const src = typeof entry.src === "string" ? entry.src.trim() : "";

    if (!src) {
      continue;
    }

    const title = typeof entry.title === "string" ? entry.title.trim() : "";

    parsed.push({ src, title: title || src });
  }

  if (parsed.length === 0) {
    throw new Error("manifest.json has no playable tracks");
  }

  return parsed;
}

function getManifestFormat() {
  const format = settings.manifest ?? "txt";

  if (format === "txt" || format === "json") {
    return format;
  }

  console.error(
    'The selected manifest for widget_st_musik does not exist. Use "txt" or "json". Falling back to "txt".',
  );

  return "txt";
}

async function getTracks() {
  const format = getManifestFormat();
  const fileName = `manifest.${format}`;

  try {
    const res = await fetch(new URL(fileName, tracksBaseUrl));

    if (!res.ok) {
      throw new Error(`${fileName} responded with ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const rejectedType = format === "json" ? /html/i : /html|json/i;

    if (rejectedType.test(contentType)) {
      throw new Error(`${fileName} responded with ${contentType}`);
    }

    const raw = await res.text();

    tracks =
      format === "json" ? parseJsonManifest(raw) : parseTextManifest(raw);

    tracks.forEach((track, index) => {
      const btn = document.createElement("button");
      btn.textContent = track.title;
      btn.setAttribute("data-idx", String(index));

      listEl!.appendChild(btn);
    });

    return true;
  } catch {
    console.error(`Could not fetch or process ${fileName}`);

    return false;
  }
}

function disablePlayer() {
  setTrackText("Manifest missing!");

  player!.querySelectorAll("button, input").forEach((el) => {
    (el as HTMLButtonElement | HTMLInputElement).disabled = true;
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
    const hidden = listEl!.classList.toggle("list_hidden");
    btnList.setAttribute("aria-expanded", String(!hidden));
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

  function play() {
    if (currentTrackIndex === -1) {
      switchTrack("next");
    }
    playAudio();
  }

  function rewind() {
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  }

  function forward() {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
  }

  btnPlay.addEventListener("click", () => {
    if (audio.paused) {
      play();
    } else {
      audio.pause();
    }
  });

  btnRewind.addEventListener("click", rewind);

  btnForward.addEventListener("click", forward);

  btnNextTrack.addEventListener("click", () => {
    switchTrack("next");
  });

  const btnRepeat = player!.querySelector<HTMLButtonElement>(
    "#widget_st_musik_btn_repeat",
  );

  btnRepeat?.addEventListener("click", () => {
    audio.loop = !audio.loop;
    btnRepeat.classList.toggle("btn_controlled", audio.loop);
    btnRepeat.setAttribute("aria-pressed", String(audio.loop));
  });

  const btnShuffle = player!.querySelector<HTMLButtonElement>(
    "#widget_st_musik_btn_shuffle",
  );

  function updateShuffleButton() {
    const randomize = Boolean(settings.randomize);
    btnShuffle!.classList.toggle("btn_controlled", randomize);
    btnShuffle!.setAttribute("aria-pressed", String(randomize));
  }

  if (btnShuffle) {
    updateShuffleButton();

    btnShuffle.addEventListener("click", () => {
      settings.randomize = !settings.randomize;

      if (settings.randomize) {
        shufflePlayOrder();
      }

      updateShuffleButton();
    });
  }

  const volumeSlider = player!.querySelector<HTMLInputElement>(
    "#widget_st_musik_volume_slider",
  );

  volumeSlider?.addEventListener("input", () => {
    audio.volume = Number(volumeSlider.value);
    volumeSlider.setAttribute(
      "aria-valuetext",
      `${Math.round(audio.volume * 100)}%`,
    );
  });

  setMediaSessionHandlers([
    ["play", play],
    ["pause", () => audio.pause()],
    ["previoustrack", () => switchTrack("prev")],
    ["nexttrack", () => switchTrack("next")],
    ["seekbackward", rewind],
    ["seekforward", forward],
  ]);

  audio.addEventListener("play", () => {
    btnPlay.classList.add("btn_controlled");
    btnPlay.setAttribute("aria-label", "Pause");
    btnForward.disabled = false;
    btnRewind.disabled = false;
  });

  audio.addEventListener("pause", () => {
    btnPlay.classList.remove("btn_controlled");
    btnPlay.setAttribute("aria-label", "Play");
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
