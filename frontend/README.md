# SecureVote frontend

The frontend uses React, JavaScript, JSX, and Vite. React components live in
`src/*.jsx`; shared utilities and the Vite configuration use `.js`. No TypeScript
source or TypeScript compilation step is required. `jsconfig.json` provides editor
navigation and JSX support.

From the repository root:

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run dev
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

The frontend forwards `/api` requests to `http://127.0.0.1:5000`. Set
`API_PROXY_TARGET` when the backend uses another address. Use `npm.cmd run dev`
from the repository root to start the database setup, local ledger, backend, and
frontend together.

ESLint checks JavaScript and JSX, including React hooks, undefined variables,
unused imports, and Fast Refresh exports. It uses JavaScript tooling instead of
the previous native Oxlint binary, which Windows Application Control blocked.
The React Compiler remains enabled in Vite.

The current workflow includes commission enrollment, voter account activation,
approval, party registration and symbol selection, nominations, elections,
blockchain voting, and results. AI facial liveness is deferred.

See [DEVELOPMENT.md](../DEVELOPMENT.md) for setup, verification results, and the
complete demonstration.
