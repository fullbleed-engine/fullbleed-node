// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';

export const tableWrappingSource = JSON.parse(readFileSync(new URL('./fixtures/table-wrapping-2.5.37.json', import.meta.url), 'utf8'));
export const tableWrappingFixtures = tableWrappingSource.cases;
