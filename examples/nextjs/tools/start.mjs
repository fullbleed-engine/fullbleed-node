// SPDX-License-Identifier: MIT
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.HOSTNAME = process.env.FULLBLEED_HOST || '127.0.0.1';
process.env.NODE_ENV = 'production';
await import(pathToFileURL(resolve('.next/standalone/server.js')).href);
