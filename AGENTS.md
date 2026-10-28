# Agents

- Static page, no build step, no external requests (no CDNs, remote fonts, or analytics).
- One dependency: `botid`, for bot protection on `api/draw.js`. Its client file is vendored as `botid.js` (`npm run vendor:botid`), so the page still loads nothing from outside.
- Short, plain copy. No em dashes.
