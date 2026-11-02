import assert from "node:assert/strict";
import { headings } from "../src/lib/toc.ts";

const body = `# Title

intro

## Section *one* ##
text right after

\`\`\`md
# not a heading
\`\`\`

### Deep
#nospace
####### too many

~~~~
# in a tilde fence
~~~
# still in it
~~~~
  ## Indented`;

const at = (s) => body.indexOf(s);
assert.deepEqual(headings(body), [
  { level: 1, text: "Title", from: 0 },
  { level: 2, text: "Section *one*", from: at("## Section") },
  { level: 3, text: "Deep", from: at("### Deep") },
  { level: 2, text: "Indented", from: at("  ## Indented") },
]);
assert.deepEqual(headings(""), []);
console.log("toc ok");
