// escape-cart.js / escape-cart-multi.js を圧縮してブックマークレットにし、index.html に埋め込む
//   npm i -D terser && node build.js
const fs = require("fs");
const path = require("path");
const { minify } = require("terser");

async function toBookmarklet(file) {
  const src = fs.readFileSync(path.join(__dirname, file), "utf8");
  const { code } = await minify(src, { ecma: 2017, compress: true, mangle: true, format: { comments: false } });
  // javascript: URL の中で意味を持つ文字だけエスケープする
  return "javascript:" + code.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\n/g, " ");
}

const embed = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

(async () => {
  const single = await toBookmarklet("escape-cart.js");
  const multi = await toBookmarklet("escape-cart-multi.js");
  const version = new Date().toISOString().slice(0, 10);

  const html = fs
    .readFileSync(path.join(__dirname, "index.template.html"), "utf8")
    .replace("__VERSION__", version)
    .replace("__BOOKMARKLET__", () => embed(single))
    .replace("__BOOKMARKLET_MULTI__", () => embed(multi));

  fs.writeFileSync(path.join(__dirname, "index.html"), html);
  fs.writeFileSync(path.join(__dirname, "bookmarklet.txt"), single + "\n");
  fs.writeFileSync(path.join(__dirname, "bookmarklet-multi.txt"), multi + "\n");
  console.log(`single: ${single.length} chars / multi: ${multi.length} chars`);
})();
