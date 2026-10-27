// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';

export const textDecorationsSource = JSON.parse(readFileSync(new URL('./fixtures/text-decorations-2.5.40.json', import.meta.url), 'utf8'));
export const textDecorationsFixtures = textDecorationsSource.cases;
