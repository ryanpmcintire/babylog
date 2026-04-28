import { readFileSync } from "node:fs";

function flatten(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return;
  }
  if (node.kind === "Listing" && node.data?.children) {
    for (const c of node.data.children) flatten(c, out);
    return;
  }
  if (node.kind === "t1") {
    const d = node.data;
    if (d.body && d.body !== "[deleted]" && d.body !== "[removed]") {
      out.push({
        ups: d.ups ?? 0,
        author: d.author,
        body: d.body,
      });
    }
    if (d.replies) flatten(d.replies, out);
  }
  if (node.kind === "t3") {
    const d = node.data;
    out.unshift({
      _post: true,
      title: d.title,
      selftext: d.selftext,
      ups: d.ups,
      url: d.url,
    });
  }
}

for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const out = [];
  flatten(raw, out);
  const post = out.find((x) => x._post);
  console.log("===", file, "===");
  if (post) {
    console.log("TITLE:", post.title);
    console.log("UPS:", post.ups);
    if (post.selftext) console.log("BODY:\n" + post.selftext);
    console.log("");
  }
  const comments = out.filter((x) => !x._post).sort((a, b) => b.ups - a.ups);
  for (const c of comments.slice(0, 25)) {
    console.log(`--- [${c.ups}↑] ${c.author} ---`);
    console.log(c.body);
    console.log("");
  }
  console.log("\n");
}
