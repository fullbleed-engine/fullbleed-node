// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';

export const generatedQuotesSource = JSON.parse(readFileSync(new URL('./fixtures/generated-quotes-2.5.38.json', import.meta.url), 'utf8'));
export const generatedQuotesFixtures = generatedQuotesSource.cases;
