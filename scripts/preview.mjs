import path from 'node:path';
import { preview } from 'vite';

const root = path.resolve(process.cwd(), 'dist');
const server = await preview({
	configFile: false,
	root,
	preview: { host: '127.0.0.1', port: 4173 },
});
server.printUrls();
