// SPDX-License-Identifier: MIT
export { Fragment, JSX } from './ui.js';
import type { Renderable, Props } from './ui.js';
export function jsx(type: string | ((props: never) => Renderable), props: Props | null, key?: string | number | bigint): Renderable;
export const jsxs: typeof jsx;
export function jsxDEV(type: string | ((props: never) => Renderable), props: Props | null, key?: string | number | bigint,
  isStaticChildren?: boolean, source?: unknown, self?: unknown): Renderable;
