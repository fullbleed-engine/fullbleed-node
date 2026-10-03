// SPDX-License-Identifier: MIT
import { cp } from 'node:fs/promises';
// Next's standalone output does not copy public files or browser chunks itself.
await cp('public', '.next/standalone/public', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
