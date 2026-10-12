import './bootstrap';
import { buildApp } from './app';

const PORT = Number(process.env.PORT) || 3010;

const app = buildApp();
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`🎮 GameKeeper server running at http://localhost:${PORT}`);
