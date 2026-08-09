import css from "./style.css?inline";

const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

document.querySelector<HTMLDivElement>("#widget_st_musik")!.innerHTML = `
<div class="widget_st_musik">
  <h1>Hello World!</h1>
</div>`;
