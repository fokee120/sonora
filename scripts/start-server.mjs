// `npm start` serves the installable, precached build; `npm run dev` is the editor preview.
process.env.NODE_ENV = 'production';
await import('../dist/server.cjs');
