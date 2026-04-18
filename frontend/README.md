# Frontend

React + TypeScript + Vite + Tailwind, deployed to Vercel.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle into dist/
```

The API base URL is read from `VITE_API_URL` in `.env` (or `.env.local`). Defaults to the deployed EC2 backend in production builds.

For project context, setup, and architecture, see the [root README](../README.md).
