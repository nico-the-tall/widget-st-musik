import css from "./style.css?inline";
import win95 from "./win95.css?inline";
import markup from "./widget-st-musik.html?raw";

(() => {
  const container = document.querySelector("#widget_st_musik")!;
  const shadow = container.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = css + win95;

  shadow.appendChild(style);

  const root = document.createElement("div");
  root.innerHTML = markup;
  shadow.appendChild(root);
})();
