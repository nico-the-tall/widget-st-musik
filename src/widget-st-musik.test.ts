import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import aeroCss from "./themes/aero.css?inline";
import brutalistCss from "./themes/brutalist.css?inline";
import win95Css from "./themes/win95.css?inline";
import scrollTitleCss from "./scroll-title.css?inline";

interface MountOptions {
  settings?: Record<string, unknown>;
  rawSettings?: string;
  manifest?: string;
  status?: number;
  contentType?: string;
  fetchError?: boolean;
  playRejects?: boolean;
  withoutScript?: boolean;
  scriptSrc?: string;
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
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
    scriptSrc,
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

  if (scriptSrc) {
    script.setAttribute("src", scriptSrc);
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

  it("finds its script tag by src when there is no current script", async () => {
    const { shadow, listButtons } = await mountWidget({
      withoutScript: true,
      scriptSrc: "/src/widget-st-musik.ts",
      settings: { secondary_bar: true },
    });

    expect(shadow).not.toBeNull();
    expect(shadow.querySelector("#widget_st_musik_secondary")).not.toBeNull();
    expect(listButtons()).toHaveLength(3);
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

describe("custom stylesheet loading", () => {
  const href = "https://example.com/custom.css";

  afterEach(() => {
    vi.useRealTimers();
  });

  const widgetRoot = (shadow: ShadowRoot) =>
    shadow.querySelector<HTMLElement>("#widget_st_musik")!.parentElement!;

  const isHidden = (shadow: ShadowRoot) =>
    widgetRoot(shadow).style.display === "none";

  it("does not hide the player without a custom stylesheet", async () => {
    const { shadow } = await mountWidget();

    expect(isHidden(shadow)).toBe(false);
    expect(widgetRoot(shadow).getAttribute("style")).toBeNull();
  });

  it("does not hide the player for an empty stylesheet_href", async () => {
    const { shadow } = await mountWidget({ settings: { stylesheet_href: "" } });

    expect(isHidden(shadow)).toBe(false);
  });

  it("hides the player while the stylesheet loads", async () => {
    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href },
    });

    expect(isHidden(shadow)).toBe(true);
  });

  it("hides with display none so styles apply without transitions", async () => {
    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href },
    });

    expect(widgetRoot(shadow).style.display).toBe("none");
    expect(widgetRoot(shadow).style.visibility).toBe("");
  });

  it("leaves no inline styles behind once shown", async () => {
    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href },
    });

    shadow.querySelector("link")!.dispatchEvent(new Event("load"));

    expect(widgetRoot(shadow).style.cssText).toBe("");
  });

  it.each(["load", "error"])(
    "shows the player when the stylesheet fires %s",
    async (eventType) => {
      const { shadow } = await mountWidget({
        settings: { stylesheet_href: href },
      });

      shadow.querySelector("link")!.dispatchEvent(new Event(eventType));

      expect(isHidden(shadow)).toBe(false);
    },
  );

  it("shows the player after 3 seconds if the stylesheet never loads", async () => {
    vi.useFakeTimers();

    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href },
    });

    await vi.advanceTimersByTimeAsync(2900);
    expect(isHidden(shadow)).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(isHidden(shadow)).toBe(false);
  });

  it("cancels the timeout once the stylesheet loads", async () => {
    vi.useFakeTimers();

    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href },
    });
    expect(vi.getTimerCount()).toBe(1);

    shadow.querySelector("link")!.dispatchEvent(new Event("load"));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the stylesheet after the theme styles", async () => {
    const { shadow } = await mountWidget({
      settings: { stylesheet_href: href, scrollable_title: true },
    });

    const tags = Array.from(shadow.children).map((el) => el.tagName);
    expect(tags).toEqual(["STYLE", "STYLE", "LINK", "DIV", "AUDIO"]);
  });

  it("loads the manifest while the stylesheet is loading", async () => {
    const { shadow, fetchMock, listButtons } = await mountWidget({
      settings: { stylesheet_href: href },
    });

    expect(isHidden(shadow)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listButtons()).toHaveLength(3);
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
      settings: { secondary_bar: true },
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

describe("json manifest", () => {
  const json = (data: unknown) => ({
    manifest: JSON.stringify(data),
    contentType: "application/json",
    settings: { manifest: "json" },
  });

  const album = {
    tracks: [
      { src: "a.mp3", title: "Song A" },
      { src: "b.mp3", title: "Song B" },
      { src: "https://cdn.example.com/c.mp3", title: "Song C" },
    ],
  };

  const fetchedUrl = (fetchMock: ReturnType<typeof vi.fn>) =>
    String((fetchMock.mock.calls[0] as unknown[])[0]);

  it("fetches manifest.json from the tracks folder", async () => {
    const { fetchMock } = await mountWidget(json(album));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchedUrl(fetchMock)).toBe(trackUrl("manifest.json"));
  });

  it.each([{}, { manifest: "txt" }])(
    "fetches manifest.txt with settings %j",
    async (settings) => {
      const { fetchMock } = await mountWidget({ settings });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchedUrl(fetchMock)).toBe(trackUrl("manifest.txt"));
    },
  );

  it("falls back to manifest.txt for an unknown manifest setting", async () => {
    const { fetchMock, listButtons } = await mountWidget({
      settings: { manifest: "xml" },
    });

    expect(fetchedUrl(fetchMock)).toBe(trackUrl("manifest.txt"));
    expect(listButtons()).toHaveLength(3);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("The selected manifest"),
    );
  });

  it("lists tracks by title", async () => {
    const { listButtons } = await mountWidget(json(album));

    expect(listButtons().map((btn) => btn.textContent)).toEqual([
      "Song A",
      "Song B",
      "Song C",
    ]);
    expect(listButtons().map((btn) => btn.dataset.idx)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  it("shows the title and plays the src", async () => {
    const { button, audio, trackText, $ } = await mountWidget(json(album));

    button("play").click();

    expect(audio.src).toBe(trackUrl("a.mp3"));
    expect(trackText()).toBe("Song A");
    expect($("#widget_st_musik_top")!.getAttribute("title")).toBe("Song A");
  });

  it("plays remote sources as-is", async () => {
    const { listButtons, audio, trackText } = await mountWidget(json(album));

    listButtons()[2].click();

    expect(audio.src).toBe("https://cdn.example.com/c.mp3");
    expect(trackText()).toBe("Song C");
  });

  it("resolves sources like manifest.txt lines", async () => {
    const { listButtons, audio } = await mountWidget(
      json({
        tracks: [
          { src: "My Song.mp3" },
          { src: "live\\set.mp3" },
          { src: "a.mp3?v=2" },
          { src: "/other/a.mp3" },
        ],
      }),
    );
    const origin = new URL(document.baseURI).origin;
    const urls = [];

    for (const btn of listButtons()) {
      btn.click();
      urls.push(audio.src);
    }

    expect(urls).toEqual([
      `${origin}/tracks/My%20Song.mp3`,
      `${origin}/tracks/live/set.mp3`,
      `${origin}/tracks/a.mp3?v=2`,
      `${origin}/other/a.mp3`,
    ]);
  });

  it.each([
    ["missing", { src: "a.mp3" }],
    ["empty", { src: "a.mp3", title: "" }],
    ["blank", { src: "a.mp3", title: "   " }],
    ["not a string", { src: "a.mp3", title: 42 }],
    ["null", { src: "a.mp3", title: null }],
  ])("uses the src as title when the title is %s", async (_, entry) => {
    const { listButtons, trackText } = await mountWidget(
      json({ tracks: [entry] }),
    );

    listButtons()[0].click();

    expect(listButtons()[0].textContent).toBe("a.mp3");
    expect(trackText()).toBe("a.mp3");
  });

  it("trims src and title", async () => {
    const { listButtons, audio } = await mountWidget(
      json({ tracks: [{ src: "  a.mp3 ", title: "  Song A  " }] }),
    );

    listButtons()[0].click();

    expect(listButtons()[0].textContent).toBe("Song A");
    expect(audio.src).toBe(trackUrl("a.mp3"));
  });

  it("skips entries without a usable src and keeps the rest", async () => {
    const { listButtons } = await mountWidget(
      json({
        tracks: [
          null,
          "a.mp3",
          42,
          [],
          {},
          { title: "No source" },
          { src: "" },
          { src: "   " },
          { src: 7, title: "Numeric source" },
          { src: "ok.mp3", title: "Kept" },
        ],
      }),
    );

    expect(listButtons().map((btn) => btn.textContent)).toEqual(["Kept"]);
  });

  it("ignores unknown fields", async () => {
    const { listButtons } = await mountWidget(
      json({
        name: "My album",
        tracks: [{ src: "a.mp3", title: "Song A", artist: "Someone" }],
      }),
    );

    expect(listButtons().map((btn) => btn.textContent)).toEqual(["Song A"]);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["no content type", ""],
    ["application/json with charset", "application/json; charset=utf-8"],
  ])("accepts a manifest served as %s", async (_, contentType) => {
    const { listButtons } = await mountWidget({
      ...json(album),
      contentType,
    });

    expect(listButtons()).toHaveLength(3);
  });

  it.each([
    ["invalid JSON", { manifest: "{ tracks: [" }],
    ["a top-level array", json([{ src: "a.mp3" }])],
    ["a missing tracks field", json({ songs: [] })],
    ["tracks that is not an array", json({ tracks: { src: "a.mp3" } })],
    ["an empty tracks array", json({ tracks: [] })],
    ["no usable entries", json({ tracks: [{ title: "x" }, null] })],
    ["null", json(null)],
    ["a 404 response", { status: 404 }],
    ["an HTML response", { contentType: "text/html" }],
    ["a network error", { fetchError: true }],
  ])("shows Manifest missing! for %s", async (_, options) => {
    const { trackText, listButtons, button } = await mountWidget({
      ...json(album),
      ...options,
    });

    expect(trackText()).toBe("Manifest missing!");
    expect(listButtons()).toHaveLength(0);
    expect(button("play").disabled).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "Could not fetch or process manifest.json",
    );
  });

  it("still rejects JSON responses for manifest.txt", async () => {
    const { trackText } = await mountWidget({
      manifest: JSON.stringify(album),
      contentType: "application/json",
    });

    expect(trackText()).toBe("Manifest missing!");
  });

  it("autoplays the first track by title", async () => {
    const { audio, trackText } = await mountWidget({
      ...json(album),
      settings: { manifest: "json", autoplay: true },
    });

    expect(audio.src).toBe(trackUrl("a.mp3"));
    expect(trackText()).toBe("Song A");
  });

  it("shuffles json tracks", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { button, trackText } = await mountWidget({
      ...json(album),
      settings: { manifest: "json", randomize: true },
    });

    const seen = [];
    for (let i = 0; i < 3; i++) {
      button("next_track").click();
      seen.push(trackText());
    }

    expect(seen).toEqual(["Song B", "Song C", "Song A"]);
  });

  it("scrolls long titles rather than long sources", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return (this.textContent ?? "").length * 10;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(145);

    const { listButtons, shadow } = await mountWidget({
      ...json({
        tracks: [
          { src: "a-very-long-file-name-that-would-overflow.mp3", title: "A" },
        ],
      }),
      settings: { manifest: "json", scrollable_title: true },
    });

    listButtons()[0].click();

    expect(
      shadow
        .querySelector("#widget_st_musik_track")!
        .classList.contains("widget_st_musik_track_scrolling"),
    ).toBe(false);
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

describe("track URLs", () => {
  const origin = () => new URL(document.baseURI).origin;

  async function resolve(line: string) {
    const { listButtons, audio, trackText } = await mountWidget({
      manifest: `${line}\n`,
    });

    listButtons()[0].click();
    expect(trackText()).toBe(line);

    return audio.src;
  }

  it.each([
    ["plain.mp3", "/tracks/plain.mp3"],
    ["My Song.mp3", "/tracks/My%20Song.mp3"],
    [
      "café ♪ 日本.mp3",
      "/tracks/caf%C3%A9%20%E2%99%AA%20%E6%97%A5%E6%9C%AC.mp3",
    ],
    ["Don't Stop!.mp3", "/tracks/Don't%20Stop!.mp3"],
    [
      "(feat. X) [Remix] {v2}.mp3",
      "/tracks/(feat.%20X)%20[Remix]%20%7Bv2%7D.mp3",
    ],
    ["a+b=c&d.mp3", "/tracks/a+b=c&d.mp3"],
    ["a,b;c@d$e.mp3", "/tracks/a,b;c@d$e.mp3"],
    ["tilde~star*caret^pipe|.mp3", "/tracks/tilde~star*caret%5Epipe|.mp3"],
    ['quote"lt<gt>.mp3', "/tracks/quote%22lt%3Cgt%3E.mp3"],
    ["back`tick.mp3", "/tracks/back%60tick.mp3"],
    ["Track 1: Intro.mp3", "/tracks/Track%201:%20Intro.mp3"],
    [".hidden.mp3", "/tracks/.hidden.mp3"],
    ["trailing dot..mp3", "/tracks/trailing%20dot..mp3"],
  ])("supports the filename %s", async (line, path) => {
    expect(await resolve(line)).toBe(origin() + path);
  });

  it.each([
    ["pre-encoded names", "My%20Song.mp3", "/tracks/My%20Song.mp3"],
    ["subfolders", "live/set.mp3", "/tracks/live/set.mp3"],
    ["backslash subfolders", "live\\set.mp3", "/tracks/live/set.mp3"],
    ["dot segments", "./a.mp3", "/tracks/a.mp3"],
    ["parent folders", "../a.mp3", "/a.mp3"],
    ["root-relative paths", "/other/a.mp3", "/other/a.mp3"],
    ["query strings", "a.mp3?v=2", "/tracks/a.mp3?v=2"],
    ["media fragments", "a.mp3#t=30", "/tracks/a.mp3#t=30"],
  ])("supports %s", async (_, line, path) => {
    expect(await resolve(line)).toBe(origin() + path);
  });

  it.each([
    ["a CDN URL", "https://cdn.example.com/music/a.mp3"],
    [
      "a signed CDN URL",
      "https://cdn.example.com/a.mp3?token=abc%2F123&expires=1700000000",
    ],
    ["an http URL", "http://cdn.example.com/a.mp3"],
    ["a data URL", "data:audio/mpeg;base64,SUQz"],
  ])("plays %s as-is", async (_, url) => {
    expect(await resolve(url)).toBe(url);
  });

  it("resolves protocol-relative URLs against the page protocol", async () => {
    const protocol = new URL(document.baseURI).protocol;

    expect(await resolve("//cdn.example.com/a.mp3")).toBe(
      `${protocol}//cdn.example.com/a.mp3`,
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
    const { $ } = await mountWidget({ settings: { secondary_bar: true } });
    const bar = $("#widget_st_musik_secondary");

    expect(bar).not.toBeNull();
    expect(bar!.previousElementSibling!.id).toBe("widget_st_musik_middle");
    expect(bar!.nextElementSibling!.id).toBe("widget_st_musik_bottom");
  });

  describe("repeat", () => {
    it("shows an icon with an accessible label", async () => {
      const { button } = await mountWidget({
        settings: { secondary_bar: true },
      });
      const repeat = button("repeat");

      expect(repeat.getAttribute("aria-label")).toBe("Repeat");
      expect(repeat.querySelector("svg")).not.toBeNull();
      expect(repeat.querySelector("img")).toBeNull();
    });

    it("toggles looping of the current track", async () => {
      const { button, audio } = await mountWidget({
        settings: { secondary_bar: true },
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
        settings: { secondary_bar: true },
      });

      button("repeat").click();
      button("next_track").click();
      button("next_track").click();

      expect(audio.loop).toBe(true);
    });
  });

  describe("shuffle", () => {
    const manifest = "a.mp3\nb.mp3\nc.mp3\nd.mp3\n";
    const shuffled = ["b.mp3", "c.mp3", "d.mp3", "a.mp3"];

    beforeEach(() => {
      vi.spyOn(Math, "random").mockReturnValue(0);
    });

    function isPressed(btn: HTMLButtonElement) {
      return (
        btn.classList.contains("btn_controlled") &&
        btn.getAttribute("aria-pressed") === "true"
      );
    }

    it("shows an icon with an accessible label", async () => {
      const { button } = await mountWidget({
        settings: { secondary_bar: true },
      });
      const shuffle = button("shuffle");

      expect(shuffle.getAttribute("aria-label")).toBe("Shuffle");
      expect(shuffle.querySelector("svg")).not.toBeNull();
    });

    it("is not pressed when randomize is off", async () => {
      const { button } = await mountWidget({
        settings: { secondary_bar: true },
      });

      expect(isPressed(button("shuffle"))).toBe(false);
      expect(button("shuffle").getAttribute("aria-pressed")).toBe("false");
    });

    it("is pressed when randomize is on", async () => {
      const { button } = await mountWidget({
        settings: { secondary_bar: true, randomize: true },
      });

      expect(isPressed(button("shuffle"))).toBe(true);
    });

    it("toggles its pressed state", async () => {
      const { button } = await mountWidget({
        settings: { secondary_bar: true },
      });

      button("shuffle").click();
      expect(isPressed(button("shuffle"))).toBe(true);

      button("shuffle").click();
      expect(isPressed(button("shuffle"))).toBe(false);
    });

    it("plays in shuffled order after turning it on", async () => {
      const { button, currentTrack } = await mountWidget({
        manifest,
        settings: { secondary_bar: true },
      });

      button("shuffle").click();

      const seen = [];
      for (let i = 0; i < 4; i++) {
        button("next_track").click();
        seen.push(currentTrack());
      }

      expect(seen).toEqual(shuffled);
    });

    it("keeps the current track playing when turned on", async () => {
      const { button, audio, currentTrack } = await mountWidget({
        manifest,
        settings: { secondary_bar: true },
      });

      button("next_track").click();
      button("next_track").click();
      button("shuffle").click();

      expect(currentTrack()).toBe("b.mp3");
      expect(audio.paused).toBe(false);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    });

    it("starts a fresh shuffled order each time it is turned on", async () => {
      const { button, currentTrack } = await mountWidget({
        manifest,
        settings: { secondary_bar: true, randomize: true },
      });

      button("next_track").click();
      button("next_track").click();
      expect(currentTrack()).toBe(shuffled[1]);

      button("shuffle").click();
      button("shuffle").click();
      button("next_track").click();

      expect(currentTrack()).toBe(shuffled[0]);
    });

    it("returns to list order from the current track when turned off", async () => {
      const { button, currentTrack } = await mountWidget({
        manifest,
        settings: { secondary_bar: true, randomize: true },
      });

      button("next_track").click();
      expect(currentTrack()).toBe("b.mp3");

      button("shuffle").click();
      button("next_track").click();
      expect(currentTrack()).toBe("c.mp3");

      button("previous_track").click();
      button("previous_track").click();
      expect(currentTrack()).toBe("a.mp3");
    });

    it("plays the first track of the new order when play is pressed", async () => {
      const { button, currentTrack } = await mountWidget({
        manifest,
        settings: { secondary_bar: true },
      });

      button("shuffle").click();
      button("play").click();

      expect(currentTrack()).toBe(shuffled[0]);
    });
  });

  describe("volume", () => {
    function setVolume(slider: HTMLInputElement, value: string) {
      slider.value = value;
      slider.dispatchEvent(new Event("input"));
    }

    it("starts at full volume", async () => {
      const { $, audio } = await mountWidget({
        settings: { secondary_bar: true },
      });

      expect($<HTMLInputElement>("#widget_st_musik_volume_slider")!.value).toBe(
        "1",
      );
      expect(audio.volume).toBe(1);
    });

    it("sets the audio volume from the slider", async () => {
      const { $, audio } = await mountWidget({
        settings: { secondary_bar: true },
      });
      const slider = $<HTMLInputElement>("#widget_st_musik_volume_slider")!;

      setVolume(slider, "0.35");
      expect(audio.volume).toBe(0.35);

      setVolume(slider, "0");
      expect(audio.volume).toBe(0);
    });

    it("keeps the volume when switching tracks", async () => {
      const { $, audio, button } = await mountWidget({
        settings: { secondary_bar: true },
      });

      setVolume($<HTMLInputElement>("#widget_st_musik_volume_slider")!, "0.4");
      button("next_track").click();
      button("next_track").click();

      expect(audio.volume).toBe(0.4);
    });
  });
});

describe("scrollable title", () => {
  const LONG = "A Very Long Song Title That Does Not Fit.mp3";
  let titleWidth = 145;

  beforeEach(() => {
    titleWidth = 145;

    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return (this.textContent ?? "").length * 10;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => titleWidth,
    );
  });

  const track = (shadow: ShadowRoot) =>
    shadow.querySelector<HTMLElement>("#widget_st_musik_track")!;

  const isScrolling = (shadow: ShadowRoot) =>
    track(shadow).classList.contains("widget_st_musik_track_scrolling");

  describe("when off", () => {
    it("is off by default and keeps the title as plain text", async () => {
      const { shadow, listButtons, trackText } = await mountWidget({
        manifest: `${LONG}\n`,
      });

      listButtons()[0].click();

      expect(trackText()).toBe(LONG);
      expect(track(shadow).children).toHaveLength(0);
      expect(isScrolling(shadow)).toBe(false);
      expect(track(shadow).getAttribute("style")).toBeNull();
    });

    it("adds no extra styles", async () => {
      const { shadow } = await mountWidget();

      expect(shadow.querySelectorAll("style")).toHaveLength(1);
    });

    it("keeps the title as plain text when set to false", async () => {
      const { shadow, listButtons } = await mountWidget({
        manifest: `${LONG}\n`,
        settings: { scrollable_title: false },
      });

      listButtons()[0].click();

      expect(track(shadow).children).toHaveLength(0);
      expect(isScrolling(shadow)).toBe(false);
    });
  });

  describe("when on", () => {
    it("adds the scrolling styles after the theme", async () => {
      const { shadow } = await mountWidget({
        settings: { scrollable_title: true },
      });
      const styles = shadow.querySelectorAll("style");

      expect(styles).toHaveLength(2);
      expect(styles[0].textContent).toBe(win95Css);
      expect(styles[1].textContent).toBe(scrollTitleCss);
    });

    it("adds the scrolling styles before a custom stylesheet", async () => {
      const { shadow } = await mountWidget({
        settings: {
          scrollable_title: true,
          stylesheet_href: "https://example.com/custom.css",
        },
      });

      const scrollStyle = shadow.querySelectorAll("style")[1];
      expect(scrollStyle.nextElementSibling!.tagName).toBe("LINK");
    });

    it("adds the scrolling styles with the 'none' theme", async () => {
      const { shadow } = await mountWidget({
        settings: { scrollable_title: true, theme: "none" },
      });

      expect(shadow.querySelectorAll("style")[1].textContent).toBe(
        scrollTitleCss,
      );
    });

    it("wraps the title in a text span", async () => {
      const { shadow, listButtons, trackText } = await mountWidget({
        manifest: `${LONG}\n`,
        settings: { scrollable_title: true },
      });

      listButtons()[0].click();

      const text = track(shadow).querySelector(".widget_st_musik_track_text");
      expect(text?.textContent).toBe(LONG);
      expect(trackText()).toBe(LONG);
    });

    it("scrolls a title that does not fit", async () => {
      const { shadow, listButtons } = await mountWidget({
        manifest: `${LONG}\n`,
        settings: { scrollable_title: true },
      });

      listButtons()[0].click();

      const overflow = LONG.length * 10 - 145;
      const el = track(shadow);
      expect(isScrolling(shadow)).toBe(true);
      expect(
        el.style.getPropertyValue("--widget-st-musik-scroll-distance"),
      ).toBe(`-${overflow}px`);
      expect(
        el.style.getPropertyValue("--widget-st-musik-scroll-duration"),
      ).toBe(`${(overflow / 30 / 0.7).toFixed(2)}s`);
    });

    it("does not scroll a title that fits", async () => {
      const { shadow, listButtons } = await mountWidget({
        settings: { scrollable_title: true },
      });

      listButtons()[0].click();

      expect(isScrolling(shadow)).toBe(false);
    });

    it("does not scroll a title that fits exactly", async () => {
      const { shadow, listButtons } = await mountWidget({
        manifest: "x".repeat(10) + ".mp3\n",
        settings: { scrollable_title: true },
      });
      titleWidth = 140;

      listButtons()[0].click();

      expect(isScrolling(shadow)).toBe(false);
    });

    it("stops scrolling when switching to a title that fits", async () => {
      const { shadow, button } = await mountWidget({
        manifest: `${LONG}\nshort.mp3\n`,
        settings: { scrollable_title: true },
      });

      button("next_track").click();
      expect(isScrolling(shadow)).toBe(true);

      button("next_track").click();
      expect(isScrolling(shadow)).toBe(false);
    });

    it("restarts the scroll on a new text element for each track", async () => {
      const { shadow, button } = await mountWidget({
        manifest: `${LONG}\n${LONG} 2\n`,
        settings: { scrollable_title: true },
      });

      button("next_track").click();
      const first = track(shadow).firstElementChild;

      button("next_track").click();
      const second = track(shadow).firstElementChild;

      expect(second).not.toBe(first);
      expect(track(shadow).children).toHaveLength(1);
    });

    it("wraps the status messages too", async () => {
      const { shadow, trackText } = await mountWidget({
        status: 404,
        settings: { scrollable_title: true },
      });

      expect(trackText()).toBe("Manifest missing!");
      expect(
        track(shadow).querySelector(".widget_st_musik_track_text"),
      ).not.toBeNull();
    });

    it("re-checks the title when its size changes", async () => {
      const observers: { cb: () => void; target: Element }[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          cb: () => void;
          constructor(cb: () => void) {
            this.cb = cb;
          }
          observe(target: Element) {
            observers.push({ cb: this.cb, target });
          }
          disconnect() {}
          unobserve() {}
        },
      );

      const { shadow, listButtons } = await mountWidget({
        manifest: "medium length.mp3\n",
        settings: { scrollable_title: true },
      });
      titleWidth = 300;
      listButtons()[0].click();
      expect(isScrolling(shadow)).toBe(false);

      expect(observers).toHaveLength(1);
      expect(observers[0].target).toBe(track(shadow));

      titleWidth = 100;
      observers[0].cb();

      expect(isScrolling(shadow)).toBe(true);
    });

    it("does not observe size changes when off", async () => {
      const observe = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe = observe;
          disconnect() {}
          unobserve() {}
        },
      );

      await mountWidget();

      expect(observe).not.toHaveBeenCalled();
    });
  });
});
