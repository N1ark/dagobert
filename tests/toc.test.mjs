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
####### too many`;

assert.deepEqual(headings(body), [
  { level: 1, text: "Title", block: 0 },
  { level: 2, text: "Section *one*", block: 2 },
  { level: 3, text: "Deep", block: 4 },
]);
assert.deepEqual(headings(""), []);
console.log("toc ok");
