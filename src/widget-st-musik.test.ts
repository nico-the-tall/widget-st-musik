import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import aeroCss from "./themes/aero.css?inline";
import brutalistCss from "./themes/brutalist.css?inline";
import win95Css from "./themes/win95.css?inline";

interface MountOptions {
  settings?: Record<string, unknown>;
  rawSettings?: string;
  manifest?: string;
  status?: number;
  contentType?: string;
  fetchError?: boolean;
  playRejects?: boolean;
  withoutScript?: boolean;
}

interface MediaState {
  paused: boolean;
  duration: number;
  currentTime: number;
}

const DEFAULT_MANIFEST = "a.mp3\nb.mp3\nc.mp3\n";

const mediaStates = new WeakMap<HTMLMediaElement, MediaState>();
let playShouldReject = false;

function mediaState(el: HTMLMediaElement) {
  let state = mediaStates.get(el);

  if (!state) {
    state = { paused: true, duration: NaN, currentTime: 0 };
    mediaStates.set(el, state);
  }

  return state;
}

function stubMediaElement() {
  const proto = HTMLMediaElement.prototype;

  vi.spyOn(proto, "paused", "get").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return mediaState(this).paused;
  });
  vi.spyOn(proto, "duration", "get").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return mediaState(this).duration;
  });
  vi.spyOn(proto, "currentTime", "get").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return mediaState(this).currentTime;
  });
  vi.spyOn(proto, "currentTime", "set").mockImplementation(function (
    this: HTMLMediaElement,
    value: number,
  ) {
    mediaState(this).currentTime = value;
  });
  vi.spyOn(proto, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (playShouldReject) {
      return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    }

    mediaState(this).paused = false;
    this.dispatchEvent(new Event("play"));

    return Promise.resolve();
  });
  vi.spyOn(proto, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    mediaState(this).paused = true;
    this.dispatchEvent(new Event("pause"));
  });
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mountWidget(options: MountOptions = {}) {
  const {
    settings,
    rawSettings,
    manifest = DEFAULT_MANIFEST,
    status = 200,
    contentType = "text/plain",
    fetchError = false,
    playRejects = false,
    withoutScript = false,
  } = options;

  playShouldReject = playRejects;

  const fetchMock = vi.fn(async () => {
    if (fetchError) {
      throw new TypeError("Failed to fetch");
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": contentType }),
      text: async () => manifest,
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  const script = document.createElement("script");

  if (rawSettings !== undefined) {
    script.dataset.settings = rawSettings;
  } else if (settings) {
    script.dataset.settings = encodeURIComponent(JSON.stringify(settings));
  }

  container.appendChild(script);
  document.body.appendChild(container);

  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => (withoutScript ? null : script),
  });

  await import("./widget-st-musik.ts");
  await flush();

  const shadow = container.shadowRoot!;

  const $ = <T extends Element = HTMLElement>(selector: string) =>
    shadow?.querySelector<T>(selector) ?? null;

  const button = (name: string) =>
    $<HTMLButtonElement>(`#widget_st_musik_btn_${name}`)!;

  const listButtons = () =>
    Array.from(
      shadow.querySelectorAll<HTMLButtonElement>(
        "#widget_st_musik_list button",
      ),
    );

  return {
    container,
    shadow,
    fetchMock,
    $,
    button,
    listButtons,
    audio: shadow?.querySelector("audio") as HTMLAudioElement,
    trackText: () => $("#widget_st_musik_track")!.textContent,
    durationText: () => $("#widget_st_musik_duration")!.textContent,
    currentTrack: (audio = shadow.querySelector("audio")!) =>
      decodeURIComponent(new URL(audio.src).pathname.replace("/tracks/", "")),
  };
}

const trackUrl = (name: string) =>
  new URL(`/tracks/${name}`, document.baseURI).href;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  stubMediaElement();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (document as { currentScript?: unknown }).currentScript;
  playShouldReject = false;
});

describe("initialization", () => {
  it("renders the player into a shadow root on the script's parent", async () => {
    const { shadow, $, trackText } = await mountWidget();

    expect(shadow).not.toBeNull();
    expect($("#widget_st_musik")).not.toBeNull();
    expect(shadow.querySelector("audio")).not.toBeNull();
    expect(trackText()).toBe("No track selected");
  });

  it("logs an error and renders nothing without a current script", async () => {
    const { shadow, fetchMock } = await mountWidget({ withoutScript: true });

    expect(shadow).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Could not initialize Musik"),
    );
  });

  it("falls back to defaults when settings are not valid JSON", async () => {
    const { shadow } = await mountWidget({ rawSettings: "%7Bnot-json" });

    expect(consoleError).toHaveBeenCalledWith(
      "Could not parse widget settings. Using defaults.",
    );
    expect(shadow.querySelector("style")!.textContent).toBe(win95Css);
  });
});

describe("themes", () => {
  it("uses the win95 theme by default", async () => {
    const { shadow } = await mountWidget();

    expect(shadow.querySelector("style")!.textContent).toBe(win95Css);
  });

  it.each([
    ["aero", aeroCss],
    ["brutalist", brutalistCss],
    ["win95", win95Css],
  ])("applies the %s theme", async (theme, css) => {
    const { shadow } = await mountWidget({ settings: { theme } });

    expect(shadow.querySelector("style")!.textContent).toBe(css);
  });

  it("applies no built-in styles for the 'none' theme", async () => {
    const { shadow } = await mountWidget({ settings: { theme: "none" } });

    expect(shadow.querySelector("style")!.textContent).toBe("");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs an error for an unknown theme and applies no styles", async () => {
    const { shadow } = await mountWidget({ settings: { theme: "nope" } });

    expect(shadow.querySelector("style")!.textContent).toBe("");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("The selected theme"),
    );
  });

  it("adds a custom stylesheet link from stylesheet_href", async () => {
    const href = "https://example.com/custom.css";
    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href },
    });

    const link = shadow.querySelector<HTMLLinkElement>("link");
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toBe(href);
  });

  it("ignores an empty stylesheet_href", async () => {
    const { shadow } = await mountWidget({ settings: { stylesheet_href: "" } });

    expect(shadow.querySelector("link")).toBeNull();
  });
});

describe("manifest loading", () => {
  it("fetches manifest.txt from the tracks folder", async () => {
    const { fetchMock } = await mountWidget();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      trackUrl("manifest.txt"),
    );
  });

  it("lists every track, trimming whitespace and skipping blank lines", async () => {
    const { listButtons } = await mountWidget({
      manifest: "  one.mp3 \r\n\n two.mp3\n\n   \nthree.mp3",
    });

    expect(listButtons().map((btn) => btn.textContent)).toEqual([
      "one.mp3",
      "two.mp3",
      "three.mp3",
    ]);
    expect(listButtons().map((btn) => btn.dataset.idx)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  it.each([
    ["a 404 response", { status: 404 }],
    ["a 500 response", { status: 500 }],
    ["an HTML response", { contentType: "text/html; charset=utf-8" }],
    ["a JSON response", { contentType: "application/json" }],
    ["a +json response", { contentType: "application/problem+json" }],
    ["a network error", { fetchError: true }],
  ])("disables the player on %s", async (_, options) => {
    const { shadow, trackText } = await mountWidget({
      ...options,
      settings: { secondaryBar: true },
    });

    expect(trackText()).toBe("Manifest missing!");
    expect(consoleError).toHaveBeenCalledWith(
      "Could not fetch or process manifest.txt",
    );

    const controls = shadow.querySelectorAll<
      HTMLButtonElement | HTMLInputElement
    >("button, input");
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach((control) => expect(control.disabled).toBe(true));
  });

  it("accepts a manifest served without a content type", async () => {
    const { trackText, listButtons } = await mountWidget({ contentType: "" });

    expect(trackText()).toBe("No track selected");
    expect(listButtons()).toHaveLength(3);
  });

  it("does not start playback when the manifest is missing, even with autoplay", async () => {
    await mountWidget({ status: 404, settings: { autoplay: true } });

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

describe("playback controls", () => {
  it("starts the first track when play is pressed with nothing selected", async () => {
    const { button, audio, trackText, $ } = await mountWidget();

    button("play").click();

    expect(audio.src).toBe(trackUrl("a.mp3"));
    expect(trackText()).toBe("a.mp3");
    expect($("#widget_st_musik_top")!.getAttribute("title")).toBe("a.mp3");
    expect(audio.paused).toBe(false);
  });

  it("pauses when play is pressed while playing", async () => {
    const { button, audio } = await mountWidget();

    button("play").click();
    button("play").click();

    expect(audio.paused).toBe(true);
  });

  it("resumes the current track instead of switching", async () => {
    const { button, audio } = await mountWidget();

    button("next_track").click();
    button("next_track").click();
    button("play").click();
    button("play").click();

    expect(audio.src).toBe(trackUrl("b.mp3"));
    expect(audio.paused).toBe(false);
  });

  it("toggles the play button state and seek buttons with playback", async () => {
    const { button } = await mountWidget();

    expect(button("rewind").disabled).toBe(true);
    expect(button("forward").disabled).toBe(true);

    button("play").click();

    expect(button("play").classList.contains("btn_controlled")).toBe(true);
    expect(button("rewind").disabled).toBe(false);
    expect(button("forward").disabled).toBe(false);

    button("play").click();

    expect(button("play").classList.contains("btn_controlled")).toBe(false);
    expect(button("rewind").disabled).toBe(true);
    expect(button("forward").disabled).toBe(true);
  });

  it("moves to the next track and wraps around at the end", async () => {
    const { button, currentTrack } = await mountWidget();

    const seen = [];
    for (let i = 0; i < 4; i++) {
      button("next_track").click();
      seen.push(currentTrack());
    }

    expect(seen).toEqual(["a.mp3", "b.mp3", "c.mp3", "a.mp3"]);
  });

  it("starts from the last track when previous is pressed first", async () => {
    const { button, currentTrack } = await mountWidget();

    button("previous_track").click();

    expect(currentTrack()).toBe("c.mp3");
  });

  it("moves to the previous track and wraps around at the start", async () => {
    const { button, currentTrack } = await mountWidget();

    button("next_track").click();
    button("next_track").click();
    button("previous_track").click();
    expect(currentTrack()).toBe("a.mp3");

    button("previous_track").click();
    expect(currentTrack()).toBe("c.mp3");
  });

  it("advances to the next track when a track ends", async () => {
    const { button, audio, currentTrack } = await mountWidget();

    button("play").click();
    audio.dispatchEvent(new Event("ended"));

    expect(currentTrack()).toBe("b.mp3");
  });

  it("encodes track names into the audio URL", async () => {
    const { button, audio, trackText } = await mountWidget({
      manifest: "My Song #1.mp3\n",
    });

    button("play").click();

    expect(trackText()).toBe("My Song #1.mp3");
    expect(audio.src).toBe(trackUrl("My%20Song%20%231.mp3"));
  });

  it("does nothing on next or previous when the manifest has no tracks", async () => {
    const { button, audio, trackText } = await mountWidget({
      manifest: "\n  \n",
    });

    button("next_track").click();
    button("previous_track").click();

    expect(audio.getAttribute("src")).toBeNull();
    expect(trackText()).toBe("No track selected");
  });

  it("logs an error when the browser refuses to play", async () => {
    const { button, audio } = await mountWidget({ playRejects: true });

    button("play").click();
    await flush();

    expect(audio.paused).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "Could not play track:",
      expect.any(DOMException),
    );
  });
});

describe("seeking", () => {
  it("rewinds 10 seconds, not past the start", async () => {
    const { button, audio } = await mountWidget();
    button("play").click();

    audio.currentTime = 25;
    button("rewind").click();
    expect(audio.currentTime).toBe(15);

    audio.currentTime = 4;
    button("rewind").click();
    expect(audio.currentTime).toBe(0);
  });

  it("skips forward 10 seconds, not past the end", async () => {
    const { button, audio } = await mountWidget();
    button("play").click();
    mediaState(audio).duration = 30;

    audio.currentTime = 5;
    button("forward").click();
    expect(audio.currentTime).toBe(15);

    audio.currentTime = 25;
    button("forward").click();
    expect(audio.currentTime).toBe(30);
  });
});

describe("time display", () => {
  it("shows a placeholder before anything is loaded", async () => {
    const { durationText } = await mountWidget();

    expect(durationText()).toBe("--:-- / --:--");
  });

  it("shows the duration once metadata has loaded", async () => {
    const { audio, durationText } = await mountWidget();

    mediaState(audio).duration = 185;
    audio.dispatchEvent(new Event("loadedmetadata"));

    expect(durationText()).toBe("00:00 / 03:05");
  });

  it("shows elapsed and total time on timeupdate", async () => {
    const { audio, durationText } = await mountWidget();

    mediaState(audio).duration = 3725;
    audio.currentTime = 61.9;
    audio.dispatchEvent(new Event("timeupdate"));

    expect(durationText()).toBe("01:01 / 62:05");
  });

  it("shows 00:00 when the duration is unknown", async () => {
    const { audio, durationText } = await mountWidget();

    audio.currentTime = 7;
    audio.dispatchEvent(new Event("timeupdate"));

    expect(durationText()).toBe("00:07 / 00:00");
  });
});

describe("track list", () => {
  it("is hidden until the list button is pressed, and toggles", async () => {
    const { $ } = await mountWidget();
    const list = $("#widget_st_musik_list")!;
    const toggle = $<HTMLButtonElement>("#widget_st_musik_list_btn")!;

    expect(list.classList.contains("list_hidden")).toBe(true);

    toggle.click();
    expect(list.classList.contains("list_hidden")).toBe(false);

    toggle.click();
    expect(list.classList.contains("list_hidden")).toBe(true);
  });

  it("plays the clicked track", async () => {
    const { listButtons, currentTrack, trackText } = await mountWidget();

    listButtons()[2].click();

    expect(currentTrack()).toBe("c.mp3");
    expect(trackText()).toBe("c.mp3");
  });

  it("continues from the clicked track when pressing next", async () => {
    const { listButtons, button, currentTrack } = await mountWidget();

    listButtons()[1].click();
    button("next_track").click();

    expect(currentTrack()).toBe("c.mp3");
  });

  it("ignores clicks on the list that miss a track button", async () => {
    const { $, audio } = await mountWidget();

    $("#widget_st_musik_list")!.click();

    expect(audio.getAttribute("src")).toBeNull();
  });
});

describe("randomize", () => {
  const manifest = "a.mp3\nb.mp3\nc.mp3\nd.mp3\n";
  const shuffled = ["b.mp3", "c.mp3", "d.mp3", "a.mp3"];

  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("plays tracks in shuffled order", async () => {
    const { button, currentTrack } = await mountWidget({
      manifest,
      settings: { randomize: true },
    });

    const seen = [];
    for (let i = 0; i < 4; i++) {
      button("next_track").click();
      seen.push(currentTrack());
    }

    expect(seen).toEqual(shuffled);
  });

  it("plays every track once before reshuffling", async () => {
    const { button, currentTrack } = await mountWidget({
      manifest,
      settings: { randomize: true },
    });

    const seen = [];
    for (let i = 0; i < 8; i++) {
      button("next_track").click();
      seen.push(currentTrack());
    }

    expect(new Set(seen.slice(0, 4)).size).toBe(4);
    expect(new Set(seen.slice(4)).size).toBe(4);
  });

  it("goes back through the shuffled order and wraps around", async () => {
    const { button, currentTrack } = await mountWidget({
      manifest,
      settings: { randomize: true },
    });

    button("next_track").click();
    button("next_track").click();
    button("previous_track").click();
    expect(currentTrack()).toBe(shuffled[0]);

    button("previous_track").click();
    expect(currentTrack()).toBe(shuffled[3]);
  });

  it("continues the shuffled order from a track picked in the list", async () => {
    const { listButtons, button, currentTrack } = await mountWidget({
      manifest,
      settings: { randomize: true },
    });

    listButtons()[2].click();
    button("next_track").click();

    expect(currentTrack()).toBe("d.mp3");
  });
});

describe("autoplay", () => {
  it("does not play anything by default", async () => {
    await mountWidget();

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("starts the first track", async () => {
    const { audio, trackText } = await mountWidget({
      settings: { autoplay: true },
    });

    expect(audio.src).toBe(trackUrl("a.mp3"));
    expect(trackText()).toBe("a.mp3");
    expect(audio.paused).toBe(false);
  });

  it("starts the first track of the shuffled order when randomized", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { audio, button, currentTrack } = await mountWidget({
      manifest: "a.mp3\nb.mp3\nc.mp3\nd.mp3\n",
      settings: { autoplay: true, randomize: true },
    });

    expect(currentTrack(audio)).toBe("b.mp3");

    button("next_track").click();
    expect(currentTrack(audio)).toBe("c.mp3");
  });

  it.each(["click", "keydown"])(
    "retries once on the first %s when the browser blocks autoplay",
    async (eventType) => {
      const { audio } = await mountWidget({
        settings: { autoplay: true },
        playRejects: true,
      });
      const play = vi.mocked(HTMLMediaElement.prototype.play);

      expect(audio.paused).toBe(true);
      expect(play).toHaveBeenCalledTimes(1);

      playShouldReject = false;
      document.dispatchEvent(new Event(eventType));
      await flush();

      expect(play).toHaveBeenCalledTimes(2);
      expect(audio.paused).toBe(false);

      document.dispatchEvent(new Event("click"));
      document.dispatchEvent(new Event("keydown"));
      await flush();

      expect(play).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry if playback already started another way", async () => {
    const { audio, button } = await mountWidget({
      settings: { autoplay: true },
      playRejects: true,
    });
    const play = vi.mocked(HTMLMediaElement.prototype.play);

    playShouldReject = false;
    button("play").click();
    expect(audio.paused).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new Event("keydown"));
    await flush();

    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe("secondary bar", () => {
  it("is not rendered by default", async () => {
    const { $ } = await mountWidget();

    expect($("#widget_st_musik_secondary")).toBeNull();
    expect($("#widget_st_musik_btn_repeat")).toBeNull();
    expect($("#widget_st_musik_volume_slider")).toBeNull();
  });

  it("is rendered between the controls and the track list", async () => {
    const { $ } = await mountWidget({ settings: { secondaryBar: true } });
    const bar = $("#widget_st_musik_secondary");

    expect(bar).not.toBeNull();
    expect(bar!.previousElementSibling!.id).toBe("widget_st_musik_middle");
    expect(bar!.nextElementSibling!.id).toBe("widget_st_musik_bottom");
  });

  describe("repeat", () => {
    it("toggles looping of the current track", async () => {
      const { button, audio } = await mountWidget({
        settings: { secondaryBar: true },
      });
      const repeat = button("repeat");

      expect(audio.loop).toBe(false);

      repeat.click();
      expect(audio.loop).toBe(true);
      expect(repeat.classList.contains("btn_controlled")).toBe(true);
      expect(repeat.getAttribute("aria-pressed")).toBe("true");

      repeat.click();
      expect(audio.loop).toBe(false);
      expect(repeat.classList.contains("btn_controlled")).toBe(false);
      expect(repeat.getAttribute("aria-pressed")).toBe("false");
    });

    it("stays on when switching tracks", async () => {
      const { button, audio } = await mountWidget({
        settings: { secondaryBar: true },
      });

      button("repeat").click();
      button("next_track").click();
      button("next_track").click();

      expect(audio.loop).toBe(true);
    });
  });

  describe("volume", () => {
    function setVolume(slider: HTMLInputElement, value: string) {
      slider.value = value;
      slider.dispatchEvent(new Event("input"));
    }

    it("starts at full volume", async () => {
      const { $, audio } = await mountWidget({
        settings: { secondaryBar: true },
      });

      expect($<HTMLInputElement>("#widget_st_musik_volume_slider")!.value).toBe(
        "1",
      );
      expect(audio.volume).toBe(1);
    });

    it("sets the audio volume from the slider", async () => {
      const { $, audio } = await mountWidget({
        settings: { secondaryBar: true },
      });
      const slider = $<HTMLInputElement>("#widget_st_musik_volume_slider")!;

      setVolume(slider, "0.35");
      expect(audio.volume).toBe(0.35);

      setVolume(slider, "0");
      expect(audio.volume).toBe(0);
    });

    it("keeps the volume when switching tracks", async () => {
      const { $, audio, button } = await mountWidget({
        settings: { secondaryBar: true },
      });

      setVolume($<HTMLInputElement>("#widget_st_musik_volume_slider")!, "0.4");
      button("next_track").click();
      button("next_track").click();

      expect(audio.volume).toBe(0.4);
    });
  });
});
