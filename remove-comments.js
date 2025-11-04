const fs = require("fs");
const path = require("path");
const glob = require("glob");
const strip = require("strip-comments");

const files = glob.sync("./dashboard/**/*.js");

files.forEach((file) => {
  const code = fs.readFileSync(file, "utf8");
  const noComments = strip(code);
  fs.writeFileSync(file, noComments, "utf8");
  console.log(`Stripped comments from: ${file}`);
});
