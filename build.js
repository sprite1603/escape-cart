// escape-cart.js を圧縮してブックマークレットにし、index.html に埋め込む
//   npm i -D terser && node build.js
const fs = require("fs");
const path = require("path");
const { minify } = require("terser");

(async () => {
  const dir = __dirname;
  const src = fs.readFileSync(path.join(dir, "escape-cart.js"), "utf8");
  const { code } = await minify(src, { ecma: 2017, compress: true, mangle: true, format: { comments: false } });

  // javascript: URL の中で意味を持つ文字だけエスケープする
  const bookmarklet = "javascript:" + code.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\n/g, " ");

  const version = new Date().toISOString().slice(0, 10);
  const html = fs
    .readFileSync(path.join(dir, "index.template.html"), "utf8")
    .replace("__VERSION__", version)
    .replace("__BOOKMARKLET__", () => JSON.stringify(bookmarklet).replace(/</g, "\\u003c"));

  fs.writeFileSync(path.join(dir, "index.html"), html);
  fs.writeFileSync(path.join(dir, "bookmarklet.txt"), bookmarklet + "\n");
  console.log(`bookmarklet: ${bookmarklet.length} chars`);
})();
