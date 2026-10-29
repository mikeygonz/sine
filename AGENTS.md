# Agents

- Static page, no build step, no external requests (no CDNs, remote fonts, or analytics).
- One dependency: `botid`, for bot protection on `api/draw.js`. Its client file is vendored as `botid.js` (`npm run vendor:botid`), so the page still loads nothing from outside.
- Short, plain copy. No em dashes.

## No code comments

Don't write code comments. Make code explain itself with names, types, and structure. When you touch a file, delete comments that justify hacks or echo the conversation ("we don't do Y"). Put decisions and their reasons in the Linear issue, not in the code. Exceptions: license headers and tool directives (eslint-disable, @ts-expect-error, shebangs).
